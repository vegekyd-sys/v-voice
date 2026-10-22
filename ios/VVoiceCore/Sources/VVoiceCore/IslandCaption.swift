import Foundation

/// A bounded trailing window of the current exchange, never a previous reply.
public struct IslandCaption: Equatable, Sendable {
    public let text: String
    public let speaker: String
    public static func current(_ conversation: ConversationPresentation, phase: VoicePhase) -> Self {
        let turn = conversation.current.last { !$0.text.isEmpty && (phase != .speaking || $0.role == "assistant") }
        guard let turn else { return Self(text: "", speaker: "V") }
        // Sanitize complete URLs before taking the tail, so their fragments cannot leak.
        let clean = CallDocument.plain(turn.text, limit: 8_000)
        return Self(text: (clean.count > 84 ? "…" : "") + String(clean.suffix(84)),
                    speaker: CallDocument.plain(turn.label, limit: 32))
    }
}
