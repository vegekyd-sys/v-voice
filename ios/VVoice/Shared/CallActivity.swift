import ActivityKit
import Foundation
import VVoiceCore

struct CallAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: VoicePhase
        var muted: Bool
        var startedAt: Date
        var detail: String
        var caption: String
        var captionSpeaker: String
        var documentTitle: String?
        var documentID: String?
        var taskLabel: String?
        var island: IslandSnapshot
        init(phase: VoicePhase, muted: Bool, startedAt: Date, detail: String, caption: String = "", captionSpeaker: String = "V", documentTitle: String? = nil, documentID: String? = nil, taskLabel: String? = nil, island: IslandSnapshot = .init()) {
            self.phase = phase; self.muted = muted; self.startedAt = startedAt; self.detail = detail
            self.caption = caption; self.captionSpeaker = captionSpeaker; self.documentTitle = documentTitle
            self.documentID = documentID; self.taskLabel = taskLabel; self.island = island
        }
        private enum CodingKeys: String, CodingKey { case phase, muted, startedAt, detail, caption, captionSpeaker, documentTitle, documentID, taskLabel, island }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            phase = try c.decode(VoicePhase.self, forKey: .phase); muted = try c.decode(Bool.self, forKey: .muted)
            startedAt = try c.decode(Date.self, forKey: .startedAt); detail = try c.decode(String.self, forKey: .detail)
            caption = try c.decodeIfPresent(String.self, forKey: .caption) ?? ""
            captionSpeaker = try c.decodeIfPresent(String.self, forKey: .captionSpeaker) ?? "V"
            documentTitle = try c.decodeIfPresent(String.self, forKey: .documentTitle)
            documentID = try c.decodeIfPresent(String.self, forKey: .documentID)
            taskLabel = try c.decodeIfPresent(String.self, forKey: .taskLabel)
            island = try c.decodeIfPresent(IslandSnapshot.self, forKey: .island) ?? .init()
        }
    }
    var callID: String
}
