import ActivityKit
import Foundation
import VVoiceCore

struct CallAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: VoicePhase
        var muted: Bool
        var startedAt: Date
        var detail: String
        var caption: String = ""
        var captionSpeaker: String = "V"
        var documentTitle: String? = nil
        var documentID: String? = nil
        var taskLabel: String? = nil
    }
    var callID: String
}
