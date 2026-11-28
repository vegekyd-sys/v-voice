import Foundation

/// Messages typed but not yet confirmed by V. Each keeps its client message id
/// for life, so a resend after a lost reply is recognised by V instead of
/// starting a second turn. Kept on disk (attachments as files), so a message
/// written in a tunnel survives the app being closed.
struct OutboxEntry: Codable, Identifiable, Sendable {
    struct File: Codable, Sendable {
        var id: UUID
        var mimeType: String
        var fileName: String
        /// Set once V has the whole file; a resend then only names it.
        var uploadId: String?
    }

    /// The client message id; the chat item is `send:<id>`.
    var id: String
    var session: String
    var text: String
    var quote: String?
    var files: [File]
    var created: Date
    /// V refused it (not a network problem); waits for the user to retry or delete.
    var refused: String?

    var itemId: String { "send:\(id)" }
}

/// How one attempt went.
enum SendOutcome: Sendable {
    case sent
    /// Not connected, timed out or the connection dropped: try again on the next connection.
    case later
    /// V said no; trying again unchanged will not help.
    case refused(String)
}

enum OutboxStore {
    private static var folder: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appending(path: "outbox")
    }

    private static var index: URL? { folder?.appending(path: "outbox.json") }

    static func fileURL(_ id: UUID) -> URL? { folder?.appending(path: id.uuidString) }

    /// `local:<id>`, or V's path for a file this phone sent: the copy kept here for a
    /// day, so a picture just sent never has to come back over the network.
    static func localURL(_ source: String) -> URL? {
        let id: UUID?
        if source.hasPrefix("local:") {
            id = UUID(uuidString: String(source.dropFirst("local:".count)))
        } else {
            id = (UserDefaults.standard.dictionary(forKey: aliasKey)?[source] as? String).flatMap(UUID.init(uuidString:))
        }
        guard let id, let url = fileURL(id), FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    private static let aliasKey = "sentMediaOnV"

    /// V echoed a sent message with its own paths: remember which local copy each one is.
    static func remember(sent local: [MediaRef], asOnV remote: [MediaRef]) {
        guard local.count == remote.count, local.allSatisfy({ $0.source.hasPrefix("local:") }) else { return }
        var aliases = UserDefaults.standard.dictionary(forKey: aliasKey) as? [String: String] ?? [:]
        for (mine, theirs) in zip(local, remote) { aliases[theirs.source] = String(mine.source.dropFirst("local:".count)) }
        UserDefaults.standard.set(aliases, forKey: aliasKey)
    }

    /// Files of messages sent more than a day ago.
    static func sweep(keeping entries: [OutboxEntry]) {
        guard let folder, let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return }
        let kept = Set(entries.flatMap { $0.files.map(\.id.uuidString) })
        let cutoff = Date.now.addingTimeInterval(-86_400)
        for name in names where name != "outbox.json" && !kept.contains(name) {
            let url = folder.appending(path: name)
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if modified < cutoff { try? FileManager.default.removeItem(at: url) }
        }
        // Names for files that are gone.
        if var aliases = UserDefaults.standard.dictionary(forKey: aliasKey) as? [String: String] {
            aliases = aliases.filter { _, id in UUID(uuidString: id).flatMap(fileURL).map { FileManager.default.fileExists(atPath: $0.path) } ?? false }
            UserDefaults.standard.set(aliases, forKey: aliasKey)
        }
    }

    static func load() -> [OutboxEntry] {
        guard let index, let data = try? Data(contentsOf: index) else { return [] }
        return (try? JSONDecoder().decode([OutboxEntry].self, from: data)) ?? []
    }

    static func save(_ entries: [OutboxEntry]) {
        guard let folder, let index else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: index, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func write(_ attachment: Attachment) {
        guard let folder, let url = fileURL(attachment.id) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? attachment.data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func attachment(_ file: OutboxEntry.File) -> Attachment? {
        guard let url = fileURL(file.id), let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return Attachment(id: file.id, data: data, mimeType: file.mimeType, fileName: file.fileName)
    }

}
