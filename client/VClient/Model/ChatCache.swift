import Foundation

/// The last chats on disk, so the app opens with content before it has
/// connected. One file per V; removed when the device is unpaired. Only
/// finished recent items: the Gateway stays the truth once connected.
enum ChatCache {
    private static let version = 3
    private static let sessionLimit = 40
    private static let itemLimit = 60

    private struct Snapshot: Codable {
        var version: Int
        var sessions: [ChatSession]
    }

    private static func file(_ host: String) -> URL? {
        guard let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let safe = host.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "v"
        return folder.appending(path: "chats-\(safe).json")
    }

    static func load(host: String) async -> [ChatSession] {
        guard let url = file(host) else { return [] }
        return await Task.detached(priority: .userInitiated) {
            guard let data = try? Data(contentsOf: url),
                  let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
                  snapshot.version == version
            else { return [] }
            return snapshot.sessions
        }.value
    }

    static func save(_ sessions: [ChatSession], host: String) {
        guard let url = file(host) else { return }
        Task.detached(priority: .utility) {
            let kept = sessions
                .sorted { $0.displayActivity > $1.displayActivity }
                .prefix(sessionLimit)
                .map { session -> ChatSession in
                    var session = session
                    session.items = session.items.filter { !$0.pending && !$0.failed }.suffix(itemLimit)
                    session.historyLoaded = false
                    return session
                }
            guard let data = try? JSONEncoder().encode(Snapshot(version: version, sessions: kept)) else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    static func forget(host: String) {
        if let url = file(host) { try? FileManager.default.removeItem(at: url) }
    }
}
