import Foundation
import os

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
    private var loaded: [String: Date] = [:]
    /// When this phone last got a live event of a run; the transport knows.
    var lastHeard: @MainActor (_ runId: String) -> Date? = { _ in nil }

    init(fetch: @escaping Fetch) {
        self.fetch = fetch
    }

    /// When the chat's newest page was last read here.
    func lastRead(_ key: String) -> Date? { loaded[key] }

    /// The newest page, and more while what it shows would not fill a screen:
    /// thirty stored messages can be one long run, which is one reply.
    /// - Parameter ended: runs known to be over from elsewhere (V had nothing to stop).
    func loadNewest(_ key: String, model: AppModel, ended: Set<String> = []) async {
        guard await load(key, earlier: false, model: model, ended: ended) else { return }
        for _ in 0..<3 {
            guard model.selectedSessionID == key, let session = model.session(key), session.hasMoreHistory,
                  session.items.count < Self.fullScreen, await load(key, earlier: true, model: model)
            else { break }
        }
    }

    /// The newest page read once more, to bring open replies in step with V:
    /// one request, and a failure says nothing on screen.
    /// - Returns: false when the page could not be read.
    @discardableResult
    func reconcile(_ key: String, model: AppModel, ended: Set<String> = []) async -> Bool {
        await load(key, earlier: false, model: model, ended: ended, silent: true)
    }

    /// - Returns: false when the page could not be read.
    func loadEarlier(_ key: String, model: AppModel) async -> Bool {
        await load(key, earlier: true, model: model)
    }

    /// The transcript's copy of a message sent from here names its pictures as V
    /// stored them. The copy kept for sending goes on being shown under that
    /// name, so the picture neither blinks nor comes back over the network.
    static func keepSentCopies(of local: [ChatItem], as sent: [String: [MediaRef]]) {
        guard !sent.isEmpty else { return }
        for item in local {
            guard let theirs = sent[item.id], item.media.contains(where: { $0.source.hasPrefix("local:") }) else { continue }
            // Only pictures go through `chat.send`; a video picked with them stayed here.
            let mine = item.media.count == theirs.count ? item.media : item.media.filter { $0.kind == .image }
            guard mine.count == theirs.count else { continue }
            OutboxStore.remember(sent: mine, asOnV: theirs)
            for (kept, stored) in zip(mine, theirs) { MediaThumbnails.alias(kept.source, as: stored.source) }
        }
    }

    /// Reads one page into the chat's window and maps the whole window.
    private func load(_ key: String, earlier: Bool, model: AppModel, ended: Set<String> = [], silent: Bool = false) async -> Bool {
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
            let info = result["sessionInfo"]
            let (history, sent, read) = await Task.detached(priority: .userInitiated) {
                (HistoryMapper.items(from: messages, sessionKind: kind), HistoryMapper.sentAttachments(in: messages),
                 HistoryMapper.runEvidence(in: messages, sessionInfo: info))
            }.value
            // A later page is being mapped; it covers this one.
            guard versions[key] == version else { return true }
            let modelName = result["defaults"]?["model"]?.string.map(HistoryMapper.modelLabel)
            let hasMore = window.hasMore
            // V had nothing to stop for these: that outweighs a list that still names them.
            var runs = read
            runs.ended.formUnion(ended)
            runs.active.subtract(ended)
            let open = (model.session(key)?.items ?? []).compactMap { item -> String? in
                if case .reply(let work) = item.content, work.isActive { work.runId } else { nil }
            }
            let heard = Dictionary(open.compactMap { run in lastHeard(run).map { (run, $0) } }, uniquingKeysWith: { first, _ in first })
            if !open.isEmpty {
                Log.transport.info("history read: open=\(open.count) ended=\(runs.ended.count) active=\(runs.active.count) idle=\(runs.idle)")
            }
            if !earlier { loaded[key] = .now }
            model.update(key) { session in
                Self.keepSentCopies(of: session.items, as: sent)
                session.items = LiveTransport.merge(history: history, local: session.items, keepEarlier: hasMore, runs: runs, lastHeard: heard)
                session.historyLoaded = true
                session.hasMoreHistory = hasMore
                if let modelName { session.model = modelName }
            }
            model.saveCache()
            return true
        } catch {
            if !earlier, !silent { model.showNotice("聊天记录加载失败：\(error.localizedDescription)") }
            return false
        }
    }
}
