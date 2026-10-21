import Foundation

public struct ConversationTurn: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let role: String
    public var text: String
    public var complete: Bool
    public var documentID: String? = nil
    public init(role: String, text: String, complete: Bool) {
        id = UUID(); self.role = role; self.text = text; self.complete = complete
    }
}

/// Ephemeral, bounded captions. Provider partials replace their own unfinished
/// segment; a completed segment never gets overwritten by the next one.
public struct ConversationPresentation: Sendable {
    public private(set) var turns: [ConversationTurn] = []
    public init() {}
    public mutating func receive(role: String, text: String, final: Bool) {
        guard ["user", "assistant"].contains(role), !text.isEmpty else { return }
        let text = String(text.prefix(8_000))
        if let last = turns.indices.last, turns[last].role == role, !turns[last].complete {
            turns[last].text = text; turns[last].complete = final
        } else { turns.append(.init(role: role, text: text, complete: final)) }
        while turns.count > 80 || turns.reduce(0, { $0 + $1.text.count }) > 64_000 { turns.removeFirst() }
    }
    public mutating func receiveDocument(id: String) {
        guard !turns.contains(where: { $0.documentID == id }) else { return }
        var turn = ConversationTurn(role: "assistant", text: "", complete: true)
        turn.documentID = id; turns.append(turn)
        if turns.count > 80 { turns.removeFirst() }
    }
    public mutating func reset() { turns.removeAll() }
    public var current: [ConversationTurn] {
        guard let start = turns.lastIndex(where: { $0.role == "user" }) else { return Array(turns.suffix(1)) }
        return Array(turns[start...])
    }
}

public struct CallDocument: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let title: String
    public let preview: String
    public init(id: String, text: String) {
        self.id = String(id.prefix(160)); self.text = String(text.prefix(60_000))
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
        let heading = lines.first(where: { $0.hasPrefix("#") }) ?? "完整方案"
        title = Self.plain(heading, limit: 32)
        let summary = lines.first(where: { !$0.isEmpty && !$0.hasPrefix("#") && !$0.hasPrefix("|") && !$0.hasPrefix("```") }) ?? "完整内容已送达"
        preview = Self.plain(summary, limit: 90)
    }
    /// Never put access-bearing URLs or Markdown syntax in system previews.
    public static func plain(_ value: String, limit: Int) -> String {
        let clean = value.replacingOccurrences(of: #"https?://\S+"#, with: "链接", options: .regularExpression)
            .replacingOccurrences(of: #"[#*_`\[\]<>]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(clean.prefix(limit)) + (clean.count > limit ? "…" : "")
    }
}

public struct CallTask: Identifiable, Equatable, Sendable {
    public let id: String
    public var activity: String
    public var stage: String?
    public let startedAt: Date
    public var title: String {
        if let stage, !stage.isEmpty { return stage }
        return ["web":"查资料中", "memory":"查记忆中", "calendar":"查日程中"][activity] ?? "后台处理中"
    }
    public init(id: String, activity: String, stage: String? = nil, startedAt: Date = Date()) {
        self.id = id; self.activity = activity; self.stage = stage.map { CallDocument.plain($0, limit: 28) }; self.startedAt = startedAt
    }
}

public enum CallDestination: Equatable {
    case call, document(String)
    public static func url(callID: String, documentID: String? = nil) -> URL {
        var c = URLComponents(); c.scheme = "vvoice"; c.host = documentID == nil ? "call" : "result"
        c.path = "/" + callID
        c.queryItems = documentID.map { [URLQueryItem(name: "id", value: $0)] }
        return c.url!
    }
    public static func parse(_ url: URL, callID: String, documentIDs: Set<String>) -> CallDestination? {
        guard url.scheme == "vvoice", url.user == nil, url.password == nil, url.port == nil,
              let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        if c.host == "call", c.path.isEmpty || c.path == "/" + callID { return .call }
        guard c.host == "result", c.path == "/" + callID,
              let id = c.queryItems?.first(where: { $0.name == "id" })?.value, documentIDs.contains(id) else { return nil }
        return .document(id)
    }
}
