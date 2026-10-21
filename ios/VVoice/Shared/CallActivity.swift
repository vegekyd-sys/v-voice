import ActivityKit
import Foundation
import VVoiceCore

struct CallAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: VoicePhase
        var muted: Bool
        var startedAt: Date
        var detail: String
    }
    var callID: String
}
