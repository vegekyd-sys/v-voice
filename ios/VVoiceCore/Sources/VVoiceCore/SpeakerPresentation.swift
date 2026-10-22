import Foundation

public struct ConversationSpeaker: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var name: String?
    public var certainty: String?
    public init(id: String, label: String, name: String? = nil, certainty: String? = nil) {
        self.id = Self.normalized(id); self.label = String(label.prefix(80)); self.name = name.map { String($0.prefix(80)) }; self.certainty = certainty
    }
    public static func normalized(_ id: String) -> String { String((id.hasPrefix("speaker:") ? id : "speaker:" + id).prefix(160)) }
    public var displayLabel: String {
        guard let name, !name.isEmpty else { return label }
        return (certainty == "suggested" ? "可能是 " : "") + name + " · " + label
    }
}

/// Decodes only presentation data. Speaker decisions never grant tool rights.
public struct SpeakerTranscriptEvent: Sendable {
    public struct Utterance: Sendable {
        public var speakerID: String
        public var text: String
        public var startMs: Double
        public var endMs: Double
    }
    public let type: String
    public let turn: Utterance?
    public let participants: [ConversationSpeaker]
    public let shouldRespond: Bool?
    public init?(_ value: [String: Any]) {
        guard let type = value["type"] as? String, ["speaker.utterance", "speaker.decision"].contains(type) else { return nil }
        self.type = type; shouldRespond = value["shouldRespond"] as? Bool
        participants = (value["participants"] as? [[String: Any]] ?? []).prefix(32).compactMap { p in
            guard let id = p["id"] as? String, !id.isEmpty else { return nil }
            return .init(id: id, label: p["label"] as? String ?? "说话人", name: p["name"] as? String, certainty: p["certainty"] as? String)
        }
        if let input = value["turn"] as? [String: Any], let text = input["text"] as? String,
           let id = (input["speakerId"] as? String) ?? (input["speakerId"] as? NSNumber)?.stringValue,
           let start = (input["startMs"] as? NSNumber)?.doubleValue, let end = (input["endMs"] as? NSNumber)?.doubleValue {
            turn = .init(speakerID: ConversationSpeaker.normalized(id), text: text, startMs: start, endMs: end)
        } else { turn = nil }
    }
}
