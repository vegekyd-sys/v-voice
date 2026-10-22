import Foundation

/// GPT Live caption fragments are not turns. Deduplicate by event/item identity,
/// replace fragment finals, and keep late terminals attached to their own turn.
public struct GPTLiveTranscript {
    public struct Update: Equatable, Sendable {
        public let id: String
        public let role: String
        public let text: String
        public let final: Bool
    }
    private struct Row {
        var id: String
        var role: String
        var pieces: [String] = []
        var fragments: [String: Int] = [:]
        var final = false
        var text: String { String(pieces.joined().prefix(8_000)) }
    }
    private var rows: [String: Row] = [:]
    private var order: [String] = []
    private var open: [String: String] = [:]
    private var seen: [String] = []
    public init() {}
    public mutating func consume(_ event: [String: Any]) -> Update? {
        if let id = event["event_id"] as? String {
            guard !seen.contains(id) else { return nil }; seen.append(id)
            if seen.count > 512 { seen.removeFirst() }
        }
        let type = event["type"] as? String ?? ""
        let turn = event["turn"] as? [String: Any] ?? [:]
        let role: String
        if ["turn.created", "turn.done"].contains(type) { role = turn["role"] as? String ?? "" }
        else if type.hasPrefix("input_transcript.") || type.hasPrefix("session.input_transcript.") { role = "user" }
        else if type.hasPrefix("output_transcript.") || type.hasPrefix("session.output_transcript.") { role = "assistant" }
        else { return nil } // turn.delta is reasoning, not displayable speech.
        guard ["user", "assistant"].contains(role) else { return nil }
        let nativeID = turn["id"] as? String ?? event["turn_id"] as? String
        let id = nativeID.map { role + ":" + $0 } ?? open[role] ?? role + ":" + UUID().uuidString
        if rows[id] == nil {
            rows[id] = Row(id: id, role: role); order.append(id)
            if type != "turn.done" { open[role] = id }
        }
        while order.count > 80 { rows.removeValue(forKey: order.removeFirst()) }
        guard var row = rows[id] else { return nil }
        if type == "turn.created" { open[role] = id; return nil }
        guard !row.final else { return nil }
        if type == "turn.done" {
            if let text = turn["transcript"] as? String { row.pieces = [String(text.prefix(8_000))] }
            row.final = true
            if open[role] == id { open.removeValue(forKey: role) }
        } else {
            let item = event["item"] as? [String: Any] ?? [:]
            let value = event["delta"] ?? event["item"] ?? event
            let arrayText = (value as? [[String: Any]])?.compactMap { $0["text"] as? String }.joined()
            let text = arrayText ?? (value as? String) ?? (value as? [String: Any])?["text"] as? String
                ?? (value as? [String: Any])?["transcript"] as? String ?? event["text"] as? String ?? ""
            guard !text.isEmpty else { return nil }
            let fragment = event["item_id"] as? String ?? item["id"] as? String
            if let fragment, let index = row.fragments[fragment], type.hasSuffix(".added") || type.hasSuffix(".done") {
                row.pieces[index] = String(text.prefix(8_000))
            } else {
                guard row.pieces.count < 512, row.text.count < 8_000 else { return nil }
                if let fragment, type.hasSuffix(".added") || type.hasSuffix(".done") { row.fragments[fragment] = row.pieces.count }
                row.pieces.append(String(text.prefix(8_000)))
            }
        }
        rows[id] = row
        return .init(id: id, role: role, text: row.text, final: row.final)
    }
}
