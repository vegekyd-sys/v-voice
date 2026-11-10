import Foundation

/// Reads chats' transcripts page by page and keeps each chat's items in step
/// with what has been read. The Gateway and the demo both read through it, so
/// the demo pages, fails and joins onto the cache the way a real chat does.
@MainActor
final class HistoryPager {
    /// One `chat.history` call: `sessionKey`, `limit` and, for older pages, `offset`.
    typealias Fetch = @MainActor ([String: JSONValue]) async throws -> JSONValue

    /// Stored messages per page. V's link carries 25 to 50 KB/s and thirty of them
    /// are about 60 KB, so the first page stays small and the cache covers the wait.
    /// `VCLIENT_HISTORY_LIMIT` (launch environment) loads a deeper first page for testing.
    static let firstPage = ProcessInfo.processInfo.environment["VCLIENT_HISTORY_LIMIT"].flatMap(Int.init) ?? 30
    static let earlierPage = 60
    /// Fewer messages than this on screen after a page, and the next page is read as well.
    static let fullScreen = 12

    private let fetch: Fetch
    private var windows: [String: HistoryWindow] = [:]
    private var versions: [String: Int] = [:]
    private var readingEarlier: Set<String> = []

    init(fetch: @escaping Fetch) {
        self.fetch = fetch
    }

    /// The newest page, and more while what it shows would not fill a screen:
    /// thirty stored messages can be one long run, which is one reply.
    func loadNewest(_ key: String, model: AppModel) async {
        guard await load(key, earlier: false, model: model) else { return }
        for _ in 0..<3 {
            guard model.selectedSessionID == key, let session = model.session(key), session.hasMoreHistory,
                  session.items.count < Self.fullScreen, await load(key, earlier: true, model: model)
            else { break }
        }
    }

    /// - Returns: false when the page could not be read.
    func loadEarlier(_ key: String, model: AppModel) async -> Bool {
        await load(key, earlier: true, model: model)
    }

    /// Reads one page into the chat's window and maps the whole window.
    private func load(_ key: String, earlier: Bool, model: AppModel) async -> Bool {
        guard let session = model.session(key) else { return false }
        var params: [String: JSONValue] = ["sessionKey": .string(key), "limit": .number(Double(Self.firstPage))]
        var paged = false
        if earlier {
            // One older page at a time; the list asks again while its top is still near.
            guard !readingEarlier.contains(key) else { return true }
            let window = windows[key] ?? HistoryWindow()
            if let offset = window.nextOffset {
                params["limit"] = .number(Double(Self.earlierPage))
                params["offset"] = .number(Double(offset))
                paged = true
            } else {
                // A Gateway without offsets: read a longer tail instead.
                params["limit"] = .number(Double(min(window.messages.count + Self.earlierPage, 1000)))
            }
            readingEarlier.insert(key)
        }
        defer { if earlier { readingEarlier.remove(key) } }
        do {
            let result = try await fetch(params)
            let page = HistoryWindow.Page(result: result)
            // Read the window again: another page may have landed while this one was on its way.
            var window = windows[key] ?? HistoryWindow()
            if paged {
                window.prepend(page)
            } else if earlier {
                window = HistoryWindow()
                window.refresh(with: page)
            } else {
                window.refresh(with: page)
            }
            windows[key] = window
            let version = (versions[key] ?? 0) + 1
            versions[key] = version
            let kind = session.kind
            let messages = window.messages
            let history = await Task.detached(priority: .userInitiated) {
                HistoryMapper.items(from: messages, sessionKind: kind)
            }.value
            // A later page is being mapped; it covers this one.
            guard versions[key] == version else { return true }
            let modelName = result["defaults"]?["model"]?.string.map(HistoryMapper.modelLabel)
            let hasMore = window.hasMore
            model.update(key) { session in
                session.items = LiveTransport.merge(history: history, local: session.items, keepEarlier: hasMore)
                session.historyLoaded = true
                session.hasMoreHistory = hasMore
                if let modelName { session.model = modelName }
            }
            model.saveCache()
            return true
        } catch {
            if !earlier { model.showNotice("聊天记录加载失败：\(error.localizedDescription)") }
            return false
        }
    }
}
