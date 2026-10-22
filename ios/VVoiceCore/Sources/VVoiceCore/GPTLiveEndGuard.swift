import Foundation

/// Host authorization and provider playback are independent evidence. Neither a
/// farewell phrase, a delegation, nor silent time alone may end a native call.
public struct GPTLiveEndGuard {
    public private(set) var userTurn = ""
    public private(set) var userText = ""
    private var userFinal = false
    private var textAt = 0.0
    private var inputQuiet: Double?
    private var proposal: [String: Any]?
    private var confirming: String?
    private var seenRequests: Set<String> = []
    private var delegations: [String: String] = [:]
    private struct End {
        let request: String
        let user: String
        let requiresFarewell: Bool
        var turn: String?
        var terminal = false
        var audible = false
        var quiet: Double?
    }
    private var ending: End?
    private var assistantTurn: String?
    private var lastSample: Double?
    public init() {}
    public mutating func provider(_ event: [String: Any], now: Double) {
        let type = event["type"] as? String ?? ""
        let turn = event["turn"] as? [String: Any] ?? [:]
        if type == "turn.created", turn["role"] as? String == "user" {
            userTurn = turn["id"] as? String ?? ""; userText = ""; userFinal = false
            ending = nil; proposal = nil; confirming = nil; inputQuiet = nil
            assistantTurn = nil; delegations.removeAll(); seenRequests.removeAll()
        }
        if type == "turn.done", turn["role"] as? String == "user", turn["id"] as? String == userTurn { userFinal = true }
        if type == "turn.created", turn["role"] as? String == "assistant", let id = turn["id"] as? String {
            assistantTurn = id
            if ending != nil { ending?.turn = id; ending?.terminal = false; ending?.audible = false; ending?.quiet = nil }
        }
        if type == "turn.done", turn["role"] as? String == "assistant", let id = turn["id"] as? String, ending?.turn == id {
            let text = (turn["transcript"] as? String ?? "").filter { !$0.isWhitespace && !$0.isPunctuation }
            if ending?.requiresFarewell == false || text.contains("再见下次聊") || text.contains("再见下次再聊") { ending?.terminal = true }
        }
        if type == "delegation.created", let item = event["item"] as? [String: Any],
           item["type"] as? String == "delegation", item["target"] as? String == "client",
           let id = item["id"] as? String, item["user_bidi_turn_id"] as? String == userTurn,
           let content = item["content"] as? [[String: Any]], content.count == 1,
           content[0]["type"] as? String == "input_text", content[0]["text"] is String, delegations.count < 64 {
            delegations[id] = userTurn
        }
    }
    public mutating func transcript(_ update: GPTLiveTranscript.Update, now: Double) {
        guard update.role == "user", update.id == "user:" + userTurn else { return }
        let text = String(update.text.suffix(2400))
        if text != userText {
            userText = text; textAt = now
            if ending?.requiresFarewell == true { ending = nil }
            if proposal?["userText"] as? String != text { proposal = nil; confirming = nil }
        }
        if update.final { userFinal = true }
    }
    /// Only authenticated host messages enter this method, never data-channel events.
    public mutating func host(_ value: [String: Any]) {
        let type = value["type"] as? String
        guard let id = value["requestId"] as? String, !id.isEmpty, id.count <= 200, !seenRequests.contains(id) else { return }
        if type == "voice.end.proposed", value["source"] as? String == "voice_host_control", value["closeAfterPlayback"] as? Bool == true,
           value["userText"] as? String == userText, !userText.isEmpty {
            proposal = value
        } else if type == "tool.result", value["name"] as? String == "openclaw_end_call", value["source"] as? String == "backend_model_client_tool",
                  value["status"] as? String == "accepted", value["closeAfterPlayback"] as? Bool == true,
                  value["originUserTurnId"] as? String == userTurn, userFinal, delegations[id] == userTurn,
                  value["nativeDelegationId"] as? String == id,
                  let callID = value["callId"] as? String, callID.hasPrefix("call_"), value["backendToolCallId"] as? String == callID,
                  let run = value["backendRunId"] as? String, !run.isEmpty,
                  let generation = value["delegationGeneration"] as? Int, generation > 0 {
            seenRequests.insert(id)
            // Only the authenticated host can identify an already open farewell.
            let turn = value["nativeAssistantTurnIdAtAcceptance"] as? String
            ending = End(request: id, user: userTurn, requiresFarewell: false, turn: turn == assistantTurn ? turn : nil)
        }
    }
    public mutating func confirmation(now: Double) -> [String: Any]? {
        guard let value = proposal, let id = value["requestId"] as? String, confirming != id,
              value["userText"] as? String == userText, !userTurn.isEmpty, userFinal,
              let quiet = inputQuiet, now - quiet >= 0.6, now - textAt >= 1.2 else { return nil }
        confirming = id; return value
    }
    public mutating func confirmed(_ value: [String: Any]) -> Bool {
        guard value["type"] as? String == "voice.end.accepted", value["source"] as? String == "voice_host_control",
              value["closeAfterPlayback"] as? Bool == true, let id = value["requestId"] as? String,
              id == confirming, id == proposal?["requestId"] as? String,
              value["userText"] as? String == userText, inputQuiet != nil, userFinal else { return false }
        seenRequests.insert(id); proposal = nil; confirming = nil
        ending = End(request: id, user: userTurn, requiresFarewell: true, turn: assistantTurn)
        return true
    }
    public mutating func confirmationFailed() { confirming = nil; proposal = nil }
    /// Called only with fresh progressing decoded audio statistics and active I/O.
    public mutating func levels(input: Double, output: Double, now: Double, outputProgressed: Bool) -> Bool {
        if input > 0.01 { inputQuiet = nil } else if inputQuiet == nil { inputQuiet = now }
        let continuous = lastSample.map { now - $0 < 0.4 } ?? false; lastSample = now
        guard outputProgressed, continuous else { ending?.quiet = nil; return false }
        guard var end = ending, end.user == userTurn, end.turn != nil else { return false }
        if output > 0.003 { end.audible = true; end.quiet = nil }
        else if end.audible && end.terminal { if end.quiet == nil { end.quiet = now } }
        else { end.quiet = nil }
        ending = end
        // One second covers jitter/output buffering; absent statistics never drain.
        guard let inputQuiet, now - inputQuiet >= 0.6 else { return false }
        return end.quiet.map { now - $0 >= 1.0 } ?? false
    }
}
