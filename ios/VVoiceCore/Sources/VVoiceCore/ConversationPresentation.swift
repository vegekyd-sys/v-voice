import Foundation

public struct ConversationTurn: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let role: String
    public var text: String
    public var complete: Bool
    public var documentID: String? = nil
    public var speakerID: String? = nil
    public var speakerLabel = ""
    public var speakerTone = 0
    public var listenOnly = false
    public var sourceKey: String? = nil
    public var label: String { speakerLabel.isEmpty ? (role == "user" ? "你" : "V") : speakerLabel }
    public init(role: String, text: String, complete: Bool) {
        id = UUID(); self.role = role; self.text = text; self.complete = complete
    }
}

/// Ephemeral, bounded captions. Relay assistant partials are deltas; finals
/// replace the accumulated text. GPT uses explicit turn ownership below.
public struct ConversationPresentation: Sendable {
    public private(set) var turns: [ConversationTurn] = []
    public private(set) var people: [ConversationSpeaker] = []
    public private(set) var lastSpeakerID: String?
    public private(set) var listenOnly = false
    private var speakerStream = UUID().uuidString
    public init() {}
    public mutating func receive(role: String, text: String, final: Bool, delta: Bool = false) {
        guard ["user", "assistant"].contains(role), !text.isEmpty else { return }
        let text = String(text.prefix(8_000))
        if let last = turns.indices.last, turns[last].role == role, !turns[last].complete {
            turns[last].text = delta && !final ? String((turns[last].text + text).prefix(8_000)) : text
            turns[last].complete = final
        } else { turns.append(.init(role: role, text: text, complete: final)) }
        trim()
    }
    /// Explicit provider turn ownership prevents a late terminal from replacing a newer turn.
    public mutating func receiveNative(_ update: GPTLiveTranscript.Update) {
        let key = "gpt:" + update.key
        if let index = turns.firstIndex(where: { $0.sourceKey == key }) {
            turns[index].text = update.text; turns[index].complete = update.final
        } else if !update.text.isEmpty {
            var row = ConversationTurn(role: update.role, text: update.text, complete: update.final)
            row.sourceKey = key; turns.append(row)
        }
        trim()
    }
    /// ASR utterances, not provider captions, own human text in speaker calls.
    /// Decisions may arrive late or be replayed; they update their exact row.
    @discardableResult public mutating func receiveSpeaker(_ event: SpeakerTranscriptEvent) -> Bool {
        for person in event.participants {
            if let i = people.firstIndex(where: { $0.id == person.id }) { people[i] = person }
            else if people.count < 32 { people.append(person) }
        }
        for i in turns.indices where turns[i].sourceKey?.hasPrefix(speakerStream + ":") == true {
            if let person = people.first(where: { $0.id == turns[i].speakerID }) { turns[i].speakerLabel = person.displayLabel }
        }
        guard let input = event.turn, !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              input.startMs.isFinite, input.endMs.isFinite, input.startMs >= 0, input.endMs >= input.startMs else { return false }
        if !people.contains(where: { $0.id == input.speakerID }), people.count < 32 {
            people.append(.init(id: input.speakerID, label: "Speaker " + String(UnicodeScalar(65 + people.count)!)))
        }
        let key = "\(speakerStream):\(input.startMs):\(input.endMs)"
        let existing = turns.firstIndex { $0.sourceKey == key }
        let index: Int
        if let existing { index = existing }
        else {
            var row = ConversationTurn(role: "user", text: "", complete: true); row.sourceKey = key
            turns.append(row); index = turns.count - 1
        }
        turns[index].text = String(input.text.prefix(8_000)); turns[index].speakerID = input.speakerID
        turns[index].speakerLabel = people.first(where: { $0.id == input.speakerID })?.displayLabel ?? "说话人"
        turns[index].speakerTone = (people.firstIndex(where: { $0.id == input.speakerID }) ?? 0) % 5
        if event.type == "speaker.decision" { turns[index].listenOnly = event.shouldRespond == false }
        // An older decision must not change who owns the current status line.
        if turns.last(where: { $0.role == "user" })?.id == turns[index].id {
            lastSpeakerID = input.speakerID; listenOnly = turns[index].listenOnly
        }
        trim(); return true
    }
    public func isLatestSpeakerEvent(_ event: SpeakerTranscriptEvent) -> Bool {
        guard let input = event.turn else { return false }
        return turns.last(where: { $0.role == "user" })?.sourceKey == "\(speakerStream):\(input.startMs):\(input.endMs)"
    }
    public mutating func beginSpeakerStream() { people.removeAll(); lastSpeakerID = nil; listenOnly = false; speakerStream = UUID().uuidString }
    public mutating func assistantSpeaking() { listenOnly = false }
    private mutating func trim() {
        while turns.count > 80 || turns.reduce(0, { $0 + $1.text.count }) > 64_000 { turns.removeFirst() }
    }
    public mutating func attachDocument(id: String, to turnID: UUID) {
        if let index = turns.firstIndex(where: { $0.id == turnID }) { turns[index].documentID = id }
    }
    public mutating func receiveDocument(id: String) {
        guard !turns.contains(where: { $0.documentID == id }) else { return }
        var turn = ConversationTurn(role: "assistant", text: "", complete: true)
        turn.documentID = id; turns.append(turn)
        if turns.count > 80 { turns.removeFirst() }
    }
    public mutating func reset() { turns.removeAll(); beginSpeakerStream() }
    public var current: [ConversationTurn] {
        guard var start = turns.lastIndex(where: { $0.role == "user" }) else { return Array(turns.suffix(1)) }
        while start > 0, turns[start - 1].role == "user" { start -= 1 }
        return Array(turns[start...])
    }
}

public struct CallDocument: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let title: String
    public let preview: String
    public let serverOwned: Bool
    public var shouldAutoOpen: Bool { text.count > 450 || text.range(of: #"(?m)^#{1,3}\s"#, options: .regularExpression) != nil || Self.hasMedia(text) }
    public static func hasMedia(_ text: String) -> Bool {
        text.range(of: #"!\[[^\]]*\]\([^)]*\)|https?://[^\s<>]+\.(?:mp4|webm|mov|png|jpe?g|webp|gif|avif)(?:[?#][^\s<>]*)?"#, options: [.regularExpression, .caseInsensitive]) != nil
    }
    public static func isDeliverable(_ text: String) -> Bool {
        hasMedia(text) || text.count > 1100 || (text.count > 450 && text.range(of: #"(?m)^#{1,3}\s"#, options: .regularExpression) != nil)
    }
    public init(id: String, text: String, serverOwned: Bool = true) {
        self.serverOwned = serverOwned
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
    public var step: Int = 0
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
