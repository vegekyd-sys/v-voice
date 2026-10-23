import Foundation

/// Data-only service contract. It cannot execute code, fetch a URL, change a
/// binding or grant permissions. The authenticated call owns every frame.
public struct NativeRuntimePolicy: Codable, Sendable {
    public let version: Int
    public let playback: Playback
    public let timing: Timing
    public let copy: Copy
    public let pause: Pause
    public let bargeIn: BargeIn
    public struct Playback: Codable, Sendable { public let replaceResponse: Bool; public let localPause: Bool }
    public struct Timing: Codable, Sendable { public let thinkingMS: Double; public let providerRecoveryMS: Double; public let endDrainMS: Double }
    public struct Copy: Codable, Sendable { public let connected: String; public let reconnected: String; public let recovering: String; public let recovered: String }
    public struct BargeIn: Codable, Sendable { public let rms: Double; public let frames: Int }
    public struct Pause: Codable, Sendable {
        public let rms: Double, noiseMultiplier: Double, zcrMin: Double, zcrMax: Double
        public let onsetMS: Double, quietMS: Double, holdMS: Double, maxHoldMS: Double
        public let nativeHoldMS: Double, generationGraceMS: Double, doneGraceMS: Double
        public let confirmationMS: Double?
        public let speechConfidence: Double?
    }
    public static func decode(_ value: [String: Any]) throws -> Self {
        let p = try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: value))
        guard p.version == 1,
              (0...30_000).contains(p.timing.thinkingMS), (1000...60_000).contains(p.timing.providerRecoveryMS), (0...3000).contains(p.timing.endDrainMS),
              [p.copy.connected,p.copy.reconnected,p.copy.recovering,p.copy.recovered].allSatisfy({ $0.count <= 200 }),
              (0.001...0.5).contains(p.bargeIn.rms), (1...50).contains(p.bargeIn.frames),
              (0.001...0.5).contains(p.pause.rms), (1...10).contains(p.pause.noiseMultiplier),
              (0...1).contains(p.pause.zcrMin), (p.pause.zcrMin...1).contains(p.pause.zcrMax),
              (20...2000).contains(p.pause.onsetMS), (20...3000).contains(p.pause.quietMS),
              (100...5000).contains(p.pause.holdMS), (p.pause.holdMS...30_000).contains(p.pause.maxHoldMS),
              (100...5000).contains(p.pause.confirmationMS ?? 2000),
              (0.8...1).contains(p.pause.speechConfidence ?? 0.9),
              (100...30_000).contains(p.pause.nativeHoldMS), (0...2000).contains(p.pause.generationGraceMS), (0...2000).contains(p.pause.doneGraceMS)
        else { throw VoiceError.protocolMismatch }
        return p
    }
}

public struct NativeRuntimeRow: Decodable, Sendable {
    public let id: UUID
    public let role: String
    public let text: String
    public let complete: Bool
    public let speakerId: String?
    public let speakerLabel: String?
    public let speakerTone: Int?
    public let listenOnly: Bool?
    public let documentId: String?
}
public struct NativeRuntimeDocument: Decodable, Sendable {
    public let id: String, text: String, title: String, preview: String
    public let serverOwned: Bool, autoOpen: Bool
}
public struct NativeRuntimeEffect: Decodable, Sendable {
    public let op: String
    public let audio: String?
    public let sampleRate: Int?
    public let sequence: Int?
    public let responseId: String?
    public let retiredResponseId: String?
    public let localBargeIn: Bool?
    public let complete: Bool?
    public let recognized: Bool?
    public let row: NativeRuntimeRow?
    public let people: [ConversationSpeaker]?
    public let lastSpeakerId: String?
    public let listenOnly: Bool?
    public let text: String?
    public let kind: String?
    public let action: String?
    public let actionLabel: String?
    public let ttlMS: Double?
    public let phase: String?
    public let id: String?
    public let activity: String?
    public let stage: String?
    public let step: Int?
    public let outcome: String?
    public let document: NativeRuntimeDocument?
    public let expression: String?
    public static let operations: Set<String> = ["audio.append","audio.clear","audio.complete","playback.hold","playback.release","conversation.row","conversation.speakers","conversation.mode","surface.notice","surface.phase","task.upsert","task.remove","document.present","call.endWhenDrained","call.cancelEnd","connection.wait","connection.ready","avatar.expression"]
    fileprivate var valid: Bool {
        guard Self.operations.contains(op), [responseId,retiredResponseId,id,lastSpeakerId].allSatisfy({ ($0?.count ?? 0) <= 160 }) else { return false }
        switch op {
        case "audio.append": return sampleRate == 24000 && (sequence == nil || sequence! > 0) && audio.flatMap { Data(base64Encoded: $0) }.map { !$0.isEmpty && $0.count % 2 == 0 && $0.count <= 480_000 } == true
        case "conversation.row": return row.map { ["user","assistant"].contains($0.role) && $0.text.count <= 8000 && ($0.speakerLabel?.count ?? 0) <= 200 && ($0.documentId?.count ?? 0) <= 160 && ($0.speakerId?.count ?? 0) <= 160 && (0...4).contains($0.speakerTone ?? 0) } == true
        case "conversation.speakers": return people.map { $0.count <= 32 && $0.allSatisfy { !$0.id.isEmpty && $0.id.count <= 160 && $0.label.count <= 80 && ($0.name?.count ?? 0) <= 80 } } == true
        case "conversation.mode": return listenOnly != nil
        case "surface.notice": return text != nil && text!.count <= 500 && ["", "redial", "hangup"].contains(action ?? "") && (0...30_000).contains(ttlMS ?? 0) && (actionLabel?.count ?? 0) <= 80 && ["notice","warn","error","ending","action"].contains(kind ?? "notice")
        case "surface.phase": return ["thinking","listening"].contains(phase ?? "")
        case "task.upsert": return id?.isEmpty == false && (activity?.count ?? 0) <= 80 && (stage?.count ?? 0) <= 80 && (0...1_000_000).contains(step ?? 0)
        case "task.remove", "call.endWhenDrained": return id?.isEmpty == false
        case "document.present": return document.map { !$0.id.isEmpty && $0.id.count <= 160 && !$0.text.isEmpty && $0.text.count <= 60_000 && $0.title.count <= 100 && $0.preview.count <= 200 } == true
        case "connection.wait", "connection.ready": return text != nil && text!.count <= 200
        case "avatar.expression": return (expression?.count ?? 0) <= 80
        default: return true
        }
    }
}

public struct NativeRuntimeFrame: Decodable, Sendable {
    public let version: Int, revision: Int
    public let voiceSessionId: String
    public let effects: [NativeRuntimeEffect]
    public static func decode(_ value: [String: Any], owner: String, after revision: Int) throws -> Self {
        let data = try JSONSerialization.data(withJSONObject: value)
        guard data.count <= 1_000_000 else { throw VoiceError.bufferOverflow }
        let frame = try JSONDecoder().decode(Self.self, from: data)
        guard value["type"] as? String == "native.runtime", frame.version == 1, frame.voiceSessionId == owner,
              frame.revision == revision + 1, frame.effects.count <= 128, frame.effects.allSatisfy(\.valid)
        else { throw VoiceError.protocolMismatch }
        return frame
    }
}
