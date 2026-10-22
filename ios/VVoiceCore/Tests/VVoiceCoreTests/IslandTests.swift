import Foundation
import Testing
@testable import VVoiceCore

@Test func resultOpensConversationOnceButManualFoldAndNewCallAreRespected() {
    var display = IslandPresentation()
    display.synchronize(owner: "a", documentID: nil)
    #expect(display.layout == .audio)
    display.synchronize(owner: "a", documentID: "plan")
    #expect(display.layout == .conversation)
    let action1 = display.select(.audio, owner: "old")
    #expect(!action1)
    let action2 = display.select(.audio, owner: "a")
    #expect(action2)
    display.synchronize(owner: "a", documentID: "plan")
    #expect(display.layout == .audio)
    display.synchronize(owner: "a", documentID: "another-plan")
    #expect(display.layout == .conversation)
    display.synchronize(owner: "b", documentID: nil)
    #expect(display.layout == .audio)
    let action3 = display.select(.conversation, owner: "a")
    #expect(!action3)
}
@Test func reactionsCannotLeakAcrossCallsOrUtterancesOrRemainSemanticForever() {
    let now = Date(timeIntervalSince1970: 100)
    var display = IslandPresentation()
    display.synchronize(owner: "a", documentID: nil, utterance: "u1")
    let action4 = display.displayedReaction("arbitrary-path", owner: "a", now: now)
    #expect(!action4)
    let action5 = display.displayedReaction("reaction-10", owner: "old", now: now)
    #expect(!action5)
    let action6 = display.displayedReaction("reaction-10", owner: "a", now: now)
    #expect(action6)
    #expect(display.snapshot(phase: .listening, muted: false, now: now).reactionID == "reaction-10")
    _ = display.displayedReaction("reaction-10", owner: "a", now: now.addingTimeInterval(4))
    #expect(display.snapshot(phase: .listening, muted: false, now: now.addingTimeInterval(6)).reactionID == "listen-5")
    _ = display.displayedReaction("reaction-11", owner: "a", now: now)
    display.synchronize(owner: "a", documentID: nil, utterance: "u2")
    #expect(display.snapshot(phase: .thinking, muted: false, now: now).reactionID == "reaction-6")
}
@Test func mutedAndExpiredEnergyNeverPretendToBeLiveInput() {
    let now = Date(timeIntervalSince1970: 100)
    var display = IslandPresentation()
    display.synchronize(owner: "a", documentID: nil)
    let action7 = display.observeAudio(inputRMS: 0.2, outputRMS: nil, muted: false, now: now)
    #expect(action7)
    #expect(display.snapshot(phase: .listening, muted: false, now: now).audioSource == .input)
    let muted = display.snapshot(phase: .muted, muted: true, now: now)
    #expect(muted.levels.isEmpty && muted.audioSource == .none)
    #expect(display.snapshot(phase: .listening, muted: false, now: now.addingTimeInterval(3)).levels.isEmpty)
    #expect(display.snapshot(phase: .reconnecting, muted: false, now: now).levels.isEmpty)
    _ = display.observeAudio(inputRMS: .infinity, outputRMS: .nan, muted: false, now: now.addingTimeInterval(2))
    display.clearAudio()
    #expect(display.snapshot(phase: .speaking, muted: false, now: now).audioSource == .none)
}
@Test func audioUpdatesAreBoundedWhileMutedOutputRemainsVisible() {
    let now = Date(timeIntervalSince1970: 100)
    var display = IslandPresentation(); display.synchronize(owner: "a", documentID: nil)
    var updates = 0
    for i in 0..<100 {
        if display.observeAudio(inputRMS: 0.8, outputRMS: i % 2 == 0 ? 0.1 : 0.2, muted: true, now: now.addingTimeInterval(Double(i) * 0.02)) { updates += 1 }
    }
    #expect(updates <= 8)
    let snapshot = display.snapshot(phase: .muted, muted: true, now: now.addingTimeInterval(1.99))
    #expect(snapshot.audioSource == .output)
    #expect(snapshot.levels.count <= 24)
    #expect(snapshot.levels.allSatisfy { $0 <= 100 })
}
@Test func outputEnergyUsesPlaybackPositionAndHonorsCueAndClearing() {
    var meter = PlaybackEnvelope()
    meter.skip(frames: 3360) // Ready cue is not assistant speech.
    let data = (0..<960).reduce(into: Data()) { data, index in
        var sample = Int16(index < 480 ? 3276 : 16384).littleEndian
        withUnsafeBytes(of: &sample) { data.append(contentsOf: $0) }
    }
    meter.appendPCM16(data)
    #expect(meter.rms(at: 0) == nil)
    #expect(meter.rms(at: 3359) == nil)
    #expect(abs((meter.rms(at: 3360) ?? 0) - 0.1) < 0.001)
    #expect(abs((meter.rms(at: 3840) ?? 0) - 0.5) < 0.001)
    #expect(meter.rms(at: 4320) == nil)
    meter.reset()
    #expect(meter.rms(at: 3840) == nil)
    meter.appendPCM16(Data([0])) // A malformed observation cannot shift the clock.
    meter.appendPCM16(Data(repeating: 0, count: 960))
    #expect(meter.rms(at: 0) == 0)
}
@Test func connectionAttentionIsOncePerCallAndNeverReplaysAfterForegroundOrRecovery() {
    var display = IslandPresentation()
    display.synchronize(owner: "a", documentID: nil)
    let oldOwner = display.announceConnection(owner: "old", foreground: false)
    #expect(!oldOwner)
    let first = display.announceConnection(owner: "a", foreground: false)
    #expect(first)
    #expect(display.layout == .audio)
    display.synchronize(owner: "a", documentID: "early-plan")
    let repeated = display.announceConnection(owner: "a", foreground: false)
    #expect(!repeated)
    #expect(display.layout == .conversation)
    display.synchronize(owner: "b", documentID: nil)
    let foreground = display.announceConnection(owner: "b", foreground: true)
    #expect(!foreground)
    let backgroundLater = display.announceConnection(owner: "b", foreground: false)
    #expect(!backgroundLater)
    display.synchronize(owner: "c", documentID: nil)
    let nextCall = display.announceConnection(owner: "c", foreground: false)
    #expect(nextCall)
}

@Test func speechWindowsPreserveDynamicsAndSettleToSilence() {
    var display = IslandPresentation()
    let now = Date(timeIntervalSince1970: 100)
    display.synchronize(owner: "a", documentID: nil)
    let levels = [0.0, 0.0, 0.012, 0.05, 0.18, 0.03, 0.0, 0.0, 0.0, 0.0, 0.0]
    for (i, rms) in levels.enumerated() {
        _ = display.observeAudio(inputRMS: 0, outputRMS: rms, muted: false, now: now.addingTimeInterval(Double(i) * 0.1))
    }
    let snapshot = display.snapshot(phase: .speaking, muted: false, now: now.addingTimeInterval(1))
    #expect(snapshot.levels.count == levels.count)
    #expect(snapshot.levels[2] < snapshot.levels[3])
    #expect(snapshot.levels[3] < snapshot.levels[4])
    #expect(snapshot.levels[5] < snapshot.levels[4])
    #expect(snapshot.levels.suffix(3).allSatisfy { $0 == 0 })
    for i in 11...40 {
        _ = display.observeAudio(inputRMS: 0, outputRMS: 0, muted: false, now: now.addingTimeInterval(Double(i) * 0.1))
    }
    #expect(display.snapshot(phase: .listening, muted: false, now: now.addingTimeInterval(4)).audioSource == .none)
}
@Test func outputWaveformDoesNotSwitchToMicrophoneLeakageAndGapsDoNotReplayOldSpeech() {
    var display = IslandPresentation()
    let now = Date(timeIntervalSince1970: 100)
    display.synchronize(owner: "a", documentID: nil)
    _ = display.observeAudio(inputRMS: 0.15, outputRMS: 0.1, muted: false, now: now)
    #expect(display.snapshot(phase: .speaking, muted: false, now: now).audioSource == .output)
    // A missing meter is not ongoing speech, even if the last sample was loud.
    #expect(display.snapshot(phase: .speaking, muted: false, now: now.addingTimeInterval(0.5)).audioSource == .none)
    _ = display.observeAudio(inputRMS: 0, outputRMS: nil, muted: false, now: now.addingTimeInterval(1))
    #expect(display.snapshot(phase: .listening, muted: false, now: now.addingTimeInterval(1)).levels.isEmpty)
    _ = display.observeAudio(inputRMS: 0.03, outputRMS: nil, muted: false, now: now.addingTimeInterval(1.1))
    #expect(display.snapshot(phase: .listening, muted: false, now: now.addingTimeInterval(1.1)).audioSource == .input)
}

@Test func normalSpeechKeepsVisibleContrastRatherThanClusteringNearFullHeight() {
    func level(_ rms: Double) -> UInt8 {
        var display = IslandPresentation()
        let now = Date(timeIntervalSince1970: 100)
        _ = display.observeAudio(inputRMS: 0, outputRMS: rms, muted: false, now: now)
        return display.snapshot(phase: .speaking, muted: true, now: now).levels.last ?? 0
    }
    #expect(level(0.18) > level(0.07) + 30)
    #expect(level(0.01) > 0)
    #expect(level(0.001) == 0)
    #expect(level(0.18) < 90)
}
