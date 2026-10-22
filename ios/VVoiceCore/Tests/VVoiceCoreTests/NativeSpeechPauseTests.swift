import Testing
import Foundation
@testable import VVoiceCore

private func verify(_ value: Bool, sourceLocation: SourceLocation = #_sourceLocation) { #expect(value, sourceLocation: sourceLocation) }

private func frame(amplitude: Double = 0.15, hz: Double = 440) -> Data {
    var samples = (0..<480).map { Int16(amplitude * sin(Double($0) * 2 * .pi * hz / 24000) * 32767).littleEndian }
    return samples.withUnsafeMutableBytes { Data($0) }
}
@Test func nativeCourtesyRequiresSustainedSpeechAndResumesIgnoredUtterance() {
    var p = NativeSpeechPause()
    p.nativeStarted(at: 0); verify(!p.held)
    for i in 0..<6 { verify(!p.observe(frame(), enabled: true, at: Double(i * 20), generationComplete: false)) }
    verify(p.observe(frame(), enabled: true, at: 120, generationComplete: false))
    verify(p.yielded)
    p.ignored(); verify(!p.held); verify(!p.yielded)
    verify(!p.observe(frame(), enabled: true, at: 140, generationComplete: false))
    for i in 0..<20 { _ = p.observe(Data(count: 960), enabled: true, at: Double(160 + i * 20), generationComplete: false) }
    for i in 0..<7 { _ = p.observe(frame(), enabled: true, at: Double(560 + i * 20), generationComplete: false) }
    verify(p.held)
    verify(!p.observe(Data(count: 960), enabled: true, at: 4000, generationComplete: false))
}
@Test func clicksDCAndHighFrequencyNoiseDoNotPauseAndCaptureBeforePlaybackCounts() {
    for hz in [0.0, 9000.0] {
        var p = NativeSpeechPause()
        for i in 0..<100 { verify(!p.observe(frame(hz: hz), enabled: true, at: Double(i * 20), generationComplete: true)) }
    }
    var p = NativeSpeechPause()
    for i in 0..<7 { verify(!p.observe(frame(), enabled: false, at: Double(i * 20), generationComplete: true)) }
    verify(p.observe(frame(), enabled: true, at: 140, generationComplete: false))
    p.nativeStarted(at: 150); p.nativeStopped(at: 200)
    verify(p.observe(Data(count: 960), enabled: true, at: 1900, generationComplete: true))
    verify(!p.observe(Data(count: 960), enabled: true, at: 2100, generationComplete: true))
    p.reset(); verify(!p.held)
}
