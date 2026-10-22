import Foundation

/// Caption fragments may precede turn.created. A presentation key stays stable
/// while the provider turn identity is bound later; these identities are distinct.
public struct GPTLiveTranscript {
    public struct Update: Equatable, Sendable {
        public let id: String
        public let key: String
        public let role: String
        public let text: String
        public let final: Bool
    }
    private struct Row {
        var key: String
        var nativeID: String?
        var role: String
        var pieces: [String] = []
        var fragments: [String: Int] = [:]
        var final = false
        var text: String { String(pieces.joined().prefix(8_000)) }
    }
    private var rows: [String: Row] = [:]
    private var order: [String] = []
    private var nativeRows: [String: String] = [:]
    private var fragmentRows: [String: String] = [:]
    private var open: [String: String] = [:]
    private var seen: [String] = []
    public init() {}
    private mutating func resolve(role: String, nativeID: String?, activate: Bool) -> String {
        let identity = nativeID.map { role + ":" + $0 }
        if let identity, let key = nativeRows[identity] { return key }
        if let key = open[role], var row = rows[key], !row.final,
           nativeID == nil || row.nativeID == nil || row.nativeID == nativeID {
            if let identity { row.nativeID = nativeID; nativeRows[identity] = key; rows[key] = row }
            return key
        }
        let key = identity ?? role + ":" + UUID().uuidString
        rows[key] = Row(key: key, nativeID: nativeID, role: role); order.append(key)
        if let identity { nativeRows[identity] = key }
        if activate { open[role] = key }
        while order.count > 80 {
            let expired = order.removeFirst(); rows.removeValue(forKey: expired)
            nativeRows = nativeRows.filter { $0.value != expired }
            fragmentRows = fragmentRows.filter { $0.value != expired }
            open = open.filter { $0.value != expired }
        }
        return key
    }
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
        let nativeID = (turn["id"] as? String ?? event["turn_id"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let item = event["item"] as? [String: Any] ?? [:]
        let fragment = event["item_id"] as? String ?? item["id"] as? String
        let fragmentKey = fragment.map { role + ":" + $0 }
        let knownFragment = fragmentKey.flatMap { fragmentRows[$0] }
        let key: String
        if let knownFragment, !["turn.created", "turn.done"].contains(type) {
            // A late final for a known fragment cannot migrate into a newer turn.
            if let nativeID, let bound = rows[knownFragment]?.nativeID, nativeID != bound { return nil }
            key = knownFragment
        } else { key = resolve(role: role, nativeID: nativeID, activate: type != "turn.done") }
        guard var row = rows[key] else { return nil }
        if type == "turn.created" { if !row.final { open[role] = key }; return nil }
        guard !row.final else { return nil }
        if type == "turn.done" {
            if let text = turn["transcript"] as? String { row.pieces = [String(text.prefix(8_000))] }
            row.final = true
            if open[role] == key { open.removeValue(forKey: role) }
        } else {
            let value = event["delta"] ?? event["item"] ?? event
            let arrayText = (value as? [[String: Any]])?.compactMap { $0["text"] as? String }.joined()
            let text = arrayText ?? (value as? String) ?? (value as? [String: Any])?["text"] as? String
                ?? (value as? [String: Any])?["transcript"] as? String ?? event["text"] as? String ?? ""
            guard !text.isEmpty else { return nil }
            let atomic = type.hasSuffix(".added") || type.hasSuffix(".done")
            if let fragment, let index = row.fragments[fragment] {
                row.pieces[index] = String((atomic ? text : row.pieces[index] + text).prefix(8_000))
            } else {
                guard row.pieces.count < 512, row.text.count < 8_000 else { return nil }
                if let fragment, let fragmentKey {
                    row.fragments[fragment] = row.pieces.count; fragmentRows[fragmentKey] = key
                }
                row.pieces.append(String(text.prefix(8_000)))
            }
        }
        rows[key] = row
        return .init(id: row.nativeID.map { role + ":" + $0 } ?? key, key: key, role: role, text: row.text, final: row.final)
    }
}
