import Testing
import Foundation
@testable import VVoiceCore

private func verify(_ value: Bool, sourceLocation: SourceLocation = #_sourceLocation) { #expect(value, sourceLocation: sourceLocation) }
private func frame(amplitude: Double = 0.15, hz: Double = 440) -> Data {
    var samples = (0..<480).map { Int16(amplitude * sin(Double($0) * 2 * .pi * hz / 24000) * 32767).littleEndian }
    return samples.withUnsafeMutableBytes { Data($0) }
}
@Test func sustainedUnconfirmedSoundNeverPausesOrRetiresPlayback() {
    for complete in [true, false] {
        var p = NativeSpeechPause()
        // Six bursts at the cadence of the reported false pauses, followed by
        // sustained energy. Neither can synthesize a service hold command.
        for i in 0..<3000 {
            let pcm = i < 1500 && i % 250 > 20 ? Data(count: 960) : frame()
            verify(!p.observe(pcm, enabled: true, at: Double(i * 20), generationComplete: complete))
            verify(!p.yielded)
        }
    }
}
@Test func confirmedSpeechPausesAndIgnoredSpeechResumesRetainedAudio() {
    var p = NativeSpeechPause()
    p.nativeStarted(at: 0); verify(!p.held)
    p.nativeStopped(at: 1, recognized: false)
    for i in 0..<8 { verify(!p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: false)) }
    p.nativeStarted(at: 160); verify(p.held); verify(p.yielded)
    p.ignored(); verify(!p.held); verify(!p.yielded)
    p.nativeStarted(at: 180); verify(!p.held)
    for i in 0..<20 { _ = p.observe(Data(count: 960), enabled: true, at: Double(200 + i * 20), generationComplete: false) }
    for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(600 + i * 20), generationComplete: false) }
    p.nativeStarted(at: 760); verify(p.held)
}
@Test func delayedConfirmationKeepsShortInterruptionButCannotReuseStaleEvidence() {
    for delay in [1000.0, 2300] {
        var p = NativeSpeechPause()
        for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: true) }
        for i in 0..<25 { _ = p.observe(Data(count: 960), enabled: true, at: Double(160 + i * 20), generationComplete: true) }
        p.nativeStarted(at: delay); verify(p.held == (delay == 1000))
        p.reset(); p.nativeStarted(at: delay + 20); verify(!p.held)
    }
}
@Test func clicksDCAndHighFrequencyNoiseCannotCorroborateServiceOnset() {
    for hz in [0.0, 9000.0] {
        var p = NativeSpeechPause()
        for i in 0..<100 { verify(!p.observe(frame(hz: hz), enabled: true, at: Double(i * 20), generationComplete: true)) }
        p.nativeStarted(at: 2000); verify(!p.held)
    }
    var p = NativeSpeechPause()
    for i in 0..<2 { _ = p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: true) }
    p.nativeStarted(at: 40); verify(!p.held)
}
@Test func recognizedInterruptionWaitsForDispositionBeyondBothOldTimeouts() {
    for generationComplete in [true, false] {
        var p = NativeSpeechPause()
        for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: generationComplete) }
        p.nativeStarted(at: 160); p.nativeStopped(at: 400)
        for time in [2500.0, 5000, 16000, 60000] {
            p.generationDone(at: time)
            verify(p.observe(Data(count: 960), enabled: true, at: time, generationComplete: generationComplete))
        }
        p.nativeStarted(at: 60000); p.nativeStopped(at: 60010, recognized: false)
        verify(p.observe(Data(count: 960), enabled: true, at: 63000, generationComplete: true))
        p.ignored(); verify(!p.observe(Data(count: 960), enabled: true, at: 63020, generationComplete: true))
        p.reset(); verify(!p.held)
    }
}
@Test func failedRecognitionDoesNotLatchPlayback() {
    var p = NativeSpeechPause()
    for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: true) }
    p.nativeStarted(at: 160); p.nativeStopped(at: 400, recognized: false)
    verify(!p.observe(Data(count: 960), enabled: true, at: 2500, generationComplete: true))
}

@Test func serviceOnsetBeforeLocalCorroborationStillInterruptsButExpiredSignalCannot() {
    for delay in [0.0, 3000] {
        var p = NativeSpeechPause()
        p.nativeStarted(at: 0)
        for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: delay + Double(i * 20), generationComplete: true) }
        verify(p.held == (delay == 0))
    }
    var p = NativeSpeechPause()
    p.nativeStarted(at: 0); p.nativeStopped(at: 10, recognized: false)
    for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(20 + i * 20), generationComplete: true) }
    verify(!p.held)
}

@Test func acousticSpeechCanInterruptQuicklyButEnergyOrStaleClassificationCannot() {
    var p = NativeSpeechPause()
    p.localSpeech(confidence: 1, at: 0); verify(!p.held)
    for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: false) }
    p.localSpeech(confidence: 0.89, at: 160); verify(!p.held)
    p.localSpeech(confidence: 0.99, at: 1000); verify(!p.held)
    for i in 0..<8 { _ = p.observe(frame(), enabled: true, at: Double(1020 + i * 20), generationComplete: false) }
    p.localSpeech(confidence: 0.95, at: 1180); verify(p.held); verify(p.yielded)
    p.nativeStarted(at: 1500); p.nativeStopped(at: 2000)
    verify(p.observe(Data(count: 960), enabled: true, at: 6000, generationComplete: true))
    p.ignored(); p.localSpeech(confidence: 1, at: 6020); verify(!p.held)
}

@Test func quietShortSpeechCanCorroborateBothLocalAndServiceConfirmation() {
    for service in [false, true] {
        var p = NativeSpeechPause()
        // RMS 0.0106, approximately 10 dB below the previous loudness gate.
        for i in 0..<5 { verify(!p.observe(frame(amplitude: 0.015), enabled: true, at: Double(i * 20), generationComplete: true)) }
        if service { p.nativeStarted(at: 100) }
        else { p.localSpeech(confidence: 0.95, at: 100) }
        verify(p.held)
    }
    var p = NativeSpeechPause()
    for i in 0..<10 { _ = p.observe(frame(amplitude: 0.001), enabled: true, at: Double(i * 20), generationComplete: true) }
    p.localSpeech(confidence: 0.99, at: 200); verify(!p.held)
    p.nativeStarted(at: 200); verify(!p.held)
    p.reset()
    for i in 0..<5 { _ = p.observe(frame(amplitude: 0.015), enabled: true, at: Double(i * 20), generationComplete: true) }
    _ = p.observe(Data(count: 960), enabled: false, at: 100, generationComplete: true)
    p.localSpeech(confidence: 0.99, at: 120); verify(!p.held)
}

@Test func confirmedLongUtteranceCannotResumeAnOldAudioTailAtFifteenSeconds() {
    for complete in [false, true] {
        var p = NativeSpeechPause()
        let speech = frame()
        for i in 0..<8 { _ = p.observe(speech, enabled: true, at: Double(i * 20), generationComplete: complete) }
        p.nativeStarted(at: 160)
        for i in 8..<1000 { _ = p.observe(speech, enabled: true, at: Double(i * 20), generationComplete: complete) }
        verify(p.held)
        p.nativeStopped(at: 20000)
        verify(p.observe(Data(count: 960), enabled: true, at: 60000, generationComplete: complete))
        p.ignored(); verify(!p.held)
    }
}

@Test func missingServiceDispositionStillRecoversAfterLocalSpeechGoesQuiet() {
    var p = NativeSpeechPause()
    let speech = frame()
    for i in 0..<8 { _ = p.observe(speech, enabled: true, at: Double(i * 20), generationComplete: true) }
    p.nativeStarted(at: 160)
    for i in 8..<1000 { _ = p.observe(speech, enabled: true, at: Double(i * 20), generationComplete: true) }
    let silence = Data(count: 960)
    verify(p.observe(silence, enabled: true, at: 20000, generationComplete: true))
    verify(!p.observe(silence, enabled: true, at: 35000, generationComplete: true))
    p.reset(); verify(!p.held)
}
