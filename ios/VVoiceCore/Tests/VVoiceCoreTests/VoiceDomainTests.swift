import Testing
import Foundation
@testable import VVoiceCore

@Test func bindingNeverAcceptsClientIdentityOrLeaksCapabilityIntoURLs() throws {
    let secret = String(repeating: "x", count: 40)
    let b = try VoiceBinding(link: "https://voice.example/voice/?phone=phone-123&sessionKey=evil&callerId=other#access=\(secret)")
    #expect(b.endpoint("session").absoluteString == "https://voice.example/voice/api/session?phone=phone-123")
    #expect(!b.baseURL.absoluteString.contains(secret))
    #expect(throws: VoiceError.invalidBinding) { try VoiceBinding(link: "http://voice.example/voice/#access=\(secret)") }
    #expect(throws: VoiceError.invalidBinding) { try VoiceBinding(link: "https://user:pass@voice.example/voice/#access=\(secret)") }
    #expect(throws: VoiceError.invalidBinding) { try VoiceBinding(link: "https://voice.example/voice/#access=short") }
}
@Test func duplicateTriggersAndLateCallbacksDoNotCreateOrResurrectCalls() {
    var s = CallState(); let first = s.begin()!
    #expect(s.begin() == nil)
    s.transition(.listening, owner: first); s.finish()
    let second = s.begin()!
    s.transition(.speaking, owner: first); #expect(s.phase == .connecting)
    s.transition(.listening, owner: second); s.setMuted(true)
    s.transition(.speaking, owner: second); #expect(s.phase == .muted)
    s.setMuted(false); #expect(s.phase == .listening)
}
@Test func clearedPlaybackCannotDrainOrDuplicateNewSpeech() throws {
    var p = PlaybackLedger(limitFrames: 1000)
    #expect(try p.accept(frames: 480, sequence: 1))
    let stale = p.epoch; p.clear()
    #expect(try p.accept(frames: 480, sequence: 2))
    let staleDrained = p.consumed(480, epoch: stale); #expect(!staleDrained); #expect(p.queuedFrames == 480)
    #expect(try !p.accept(frames: 480, sequence: 2))
    #expect(throws: VoiceError.bufferOverflow) { try p.accept(frames: 600, sequence: 3) }
    let drained = p.consumed(480, epoch: p.epoch); #expect(drained)
}
