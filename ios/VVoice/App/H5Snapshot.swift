import Foundation
import VVoiceCore

@MainActor enum H5Snapshot {
    static func make(_ call: CallCoordinator, visible: Bool) -> [String: Any] {
        let rows: [[String: Any]] = call.conversation.turns.enumerated().map { index, turn in
            let document = turn.documentID.flatMap { id in call.documents.first { $0.id == id } }
            var row: [String: Any] = ["key":turn.id.uuidString,"role":turn.role,"speaker":document?.serverOwned == true ? "V · 完整方案" : turn.label,
                                    "text":document?.text ?? turn.text,"complete":turn.complete,"at":call.startedAt.timeIntervalSince1970 * 1000 + Double(index)]
            if let document, document.serverOwned { row["document"] = true; row["callId"] = document.id }
            if let id = turn.speakerID { row["speakerId"] = id; row["speakerTone"] = turn.speakerTone; row["listenOnly"] = turn.listenOnly }
            return row
        }
        let models: [[String: Any]] = call.modelOptions.isEmpty ? VoiceModel.allCases.map { ["id":$0.rawValue,"label":$0.title,"available":true] } : call.modelOptions.map {
            ["id":$0.id,"label":$0.title + ($0.nativeModel == nil ? "（原生待接入）" : ""),"available":$0.available && $0.nativeModel != nil]
        }
        var notice: [String: Any]? = nil
        if call.phase == .reconnecting { notice = ["kind":"warn","text":call.detail,"spinner":true,"full":call.detail] }
        else if call.phase == .interrupted { notice = ["kind":"action","text":"声音暂停","action":"resume","actionLabel":"轻点恢复","full":call.detail] }
        else if !call.speakerNotice.isEmpty {
            notice = ["kind":call.nativeRuntimeVersion != nil ? call.speakerNoticeKind : call.speakerAction == "重拨" ? "error" : call.speakerNotice == "识别恢复中" ? "warn" : "notice","text":call.speakerNotice,"full":call.speakerNotice]
            if !call.speakerAction.isEmpty { notice?["action"] = call.nativeRuntimeVersion != nil ? call.speakerActionID : call.speakerAction == "重拨" ? "redial" : "hangup"; notice?["actionLabel"] = call.speakerAction }
        }
        let people = call.conversation.people.enumerated().map { i, p -> [String: Any] in ["id":p.id,"label":p.name ?? p.label,"tone":i % 5] }
        return ["capabilities":["bridgeVersion":1,"runtimeVersion":1,"activeRuntimeVersion":call.nativeRuntimeVersion as Any? ?? NSNull(),"transports":["gateway-relay","webrtc"],"operations":NativeRuntimeEffect.operations.sorted()],"callID":call.presentationID,"active":call.active,"visible":visible,"bound":call.bound,"phase":call.phase.rawValue,
                "voice":call.phase == .speaking ? "speaking" : "listening","thinking":call.thinkingVisible,"muted":call.muted,
                "startedAt":call.startedAt.timeIntervalSince1970 * 1000,"model":call.model.rawValue,"models":models,
                "grok":["voice":call.grokVoice,"voices":call.grokVoices.map { ["id":$0.id,"label":$0.title] },"hint":call.grokHint,"listenAvailable":call.comparisonAvailable,"listenHref":"./compare"],
                "transcript":["history":rows.filter { $0["complete"] as? Bool == true },"current":rows.filter { $0["complete"] as? Bool != true }],
                "people":people,"lastSpeakerID":call.conversation.lastSpeakerID as Any? ?? NSNull(),"listenOnly":call.conversation.listenOnly,
                "tasks":call.tasks.map { task -> [String: Any] in ["callId":task.id,"activity":task.activity,"stage":task.stage as Any? ?? NSNull(),"step":task.step,"startedAt":task.startedAt.timeIntervalSince1970 * 1000] },
                "outcome":call.h5Outcome,"notice":notice as Any? ?? NSNull(),"baseURL":call.api.record?.binding.baseURL.absoluteString ?? "https://voice.invalid/voice/",
                "canControl":call.active && ![.connecting,.reconnecting,.ending,.interrupted].contains(call.phase),
                "badge":call.phase == .connecting ? "正在连接 V…" : call.bound ? "就绪" : "未绑定",
                "homeNote":[.failed,.interrupted].contains(call.phase) ? call.detail : ""]
    }
}
