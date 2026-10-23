import Foundation
import Testing
@testable import VVoiceCore

private func fixture() throws -> [String: Any] {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { root.deleteLastPathComponent() }
    return try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("Fixtures/native-runtime-v1.json"))) as! [String: Any]
}
@Test func javascriptWireFixtureDecodesAllCapabilitiesAndProjectsStableCaptions() throws {
    let f = try fixture(), policy = try NativeRuntimePolicy.decode(f["policy"] as! [String: Any])
    #expect(policy.playback.localPause && policy.playback.replaceResponse)
    var conversation = ConversationPresentation(), ops = Set<String>(), revision = 0
    let frames = f["frames"] as! [[String: Any]]
    for value in frames {
        let frame = try NativeRuntimeFrame.decode(value, owner: "native-contract-fixture", after: revision)
        revision = frame.revision
        for e in frame.effects {
            ops.insert(e.op)
            if let row = e.row { conversation.project(row) }
            if let people = e.people { conversation.projectPeople(people) }
            if e.op == "conversation.mode" { conversation.projectMode(lastSpeakerID: e.lastSpeakerId, listenOnly: e.listenOnly!) }
        }
    }
    #expect(ops == NativeRuntimeEffect.operations)
    #expect(conversation.turns.filter { $0.role == "assistant" && $0.documentID == nil }.map(\.text) == ["先自然接话，再查询。"])
    #expect(conversation.turns.filter { $0.role == "user" }.count == 1)
    #expect(conversation.people.first?.name == "甲")
    #expect(conversation.turns.last?.documentID == "report")
}
@Test func runtimeRejectsForeignReplayedAndUnrecognizedOrPartlyInvalidBatches() throws {
    let value = (try fixture()["frames"] as! [[String: Any]])[0]
    #expect(throws: (any Error).self) { try NativeRuntimeFrame.decode(value, owner: "other-call", after: 0) }
    #expect(throws: (any Error).self) { try NativeRuntimeFrame.decode(value, owner: "native-contract-fixture", after: 1) }
    for effect: [String: Any] in [
        ["op":"eval","text":"alert(1)"], ["op":"binding.replace","text":"secret"],
        ["op":"surface.notice","text":"unsafe action","action":"pay"],
        ["op":"audio.append","audio":"AA==","sampleRate":24000],
        ["op":"conversation.row","row":["id":UUID().uuidString,"role":"system","text":"fake","complete":true]],
    ] {
        var invalid = value; invalid["effects"] = (value["effects"] as! [[String: Any]]) + [effect]
        #expect(throws: (any Error).self) { try NativeRuntimeFrame.decode(invalid, owner: "native-contract-fixture", after: 0) }
    }
}
@Test func servicePolicyChangesWithinNativeSafetyBoundsAndCannotSupplyCode() throws {
    var raw = try fixture()["policy"] as! [String: Any]
    var pause = raw["pause"] as! [String: Any]; pause["onsetMS"] = 220; raw["pause"] = pause
    let p = try NativeRuntimePolicy.decode(raw)
    #expect(p.pause.onsetMS == 220)
    for threshold in [0.5, 1.1] {
        var invalidPause = pause; invalidPause["speechConfidence"] = threshold
        var invalid = raw; invalid["pause"] = invalidPause
        #expect(throws: (any Error).self) { try NativeRuntimePolicy.decode(invalid) }
    }
    for (key, value) in [("speechRMS", 0.0), ("speechRMS", 0.5), ("speechOnsetMS", 0.0), ("speechOnsetMS", 501.0)] {
        var invalidPause = pause; invalidPause[key] = value
        var invalid = raw; invalid["pause"] = invalidPause
        #expect(throws: (any Error).self) { try NativeRuntimePolicy.decode(invalid) }
    }
    pause["maxHoldMS"] = 1_000_000; raw["pause"] = pause
    #expect(throws: (any Error).self) { try NativeRuntimePolicy.decode(raw) }
    #expect(VoiceModel(rawValue: "future-relay-model")?.rawValue == "future-relay-model")
    #expect(VoiceModel(rawValue: "../../credentials") == nil)
    let model = try JSONDecoder().decode(VoiceModel.self, from: Data("\"future-relay-model\"".utf8))
    #expect(String(decoding: try JSONEncoder().encode(model), as: UTF8.self) == "\"future-relay-model\"")
}
