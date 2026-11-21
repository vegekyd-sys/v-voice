import Foundation
import Testing
@testable import VVoiceCore

@Test func aStalledUplinkShedsFramesAndKeepsTheCall() {
    var b = UploadBackpressure()
    #expect(b.decide(waiting: 90_000, nowMS: 0) == .send)
    #expect(b.decide(waiting: 96_001, nowMS: 20) == .shed(first: true))
    // Twenty seconds without draining (11/21): still shedding, not ending the call.
    var t = 20.0
    while t < 20_020 { t += 20; #expect(b.decide(waiting: 120_000, nowMS: t) == .shed(first: false)) }
    // Draining but not yet below the resume mark: keep shedding.
    #expect(b.decide(waiting: 30_000, nowMS: t + 20) == .shed(first: false))
    #expect(b.decide(waiting: 20_000, nowMS: t + 40) == .resumed(shedMS: Int(t + 20), frames: 1_002))
    #expect(b.decide(waiting: 20_000, nowMS: t + 60) == .send)
}

@Test func anUplinkThatNeverDrainsEndsTheCallAfterThePolicysWait() {
    var b = UploadBackpressure(policy: .init(shedBytes: 48_000, resumeBytes: 10_000, stallMS: 5_000))
    #expect(b.decide(waiting: 48_001, nowMS: 1_000) == .shed(first: true))
    #expect(b.decide(waiting: 60_000, nowMS: 6_000) == .shed(first: false))
    #expect(b.decide(waiting: 60_000, nowMS: 6_001) == .fail)
}

@Test func theUploadPolicyIsOptionalAndBounded() throws {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { root.deleteLastPathComponent() }
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("Fixtures/native-runtime-v1.json"))) as! [String: Any]
    var policy = fixture["policy"] as! [String: Any]
    // The service's current policy carries the web page's numbers.
    #expect(try NativeRuntimePolicy.decode(policy).upload == .standard)
    // An older service sends none: the App falls back to the same numbers.
    policy["upload"] = nil
    #expect(try NativeRuntimePolicy.decode(policy).upload == nil)
    for bad: [String: Any] in [["shedBytes": 1_000, "resumeBytes": 0, "stallMS": 30_000],
                               ["shedBytes": 96_000, "resumeBytes": 96_000, "stallMS": 30_000],
                               ["shedBytes": 96_000, "resumeBytes": 24_000, "stallMS": 600_000]] {
        policy["upload"] = bad
        #expect(throws: (any Error).self) { try NativeRuntimePolicy.decode(policy) }
    }
}
