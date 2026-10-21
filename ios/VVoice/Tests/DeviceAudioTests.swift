import XCTest
import AVFoundation
import UIKit
@testable import VVoice

/// Exercises physical Voice Processing I/O without opening a network connection,
/// storing microphone samples, or contacting a model.
@MainActor final class DeviceAudioTests: XCTestCase {
    func testSystemCallActivatesAudioWithoutNetwork() async throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("CallKit activation requires a physical device")
        #else
        let systemCall = SystemCallSession.shared
        let audio = VoiceAudio()
        defer { audio.stop(); systemCall.finish() }
        do { try await systemCall.start() }
        catch { XCTFail("System call: \(systemCall.lastFailure ?? String(describing: error))"); return }
        XCTAssertTrue(systemCall.audioIsActive)
        var bytes = 0
        audio.onInput = { data, _ in bytes += data.count }
        try audio.start(systemManaged: true)
        try await audio.waitUntilCapturing()
        systemCall.connected()
        XCTAssertGreaterThan(bytes, 0)
        XCTAssertTrue(audio.isRunning)
        #endif
    }
    func testAudioCapturesPlaysAndRestartsWithoutNetwork() async throws {
        XCTAssertEqual(AVAudioApplication.shared.recordPermission, .granted,
                       "Authorize the microphone in V Voice before device acceptance")
        guard AVAudioApplication.shared.recordPermission == .granted else { return }
        let audio = VoiceAudio()
        defer { audio.stop() }
        for attempt in 1...3 {
            var inputBytes = 0
            var played = false
            var drained = false
            audio.onInput = { bytes, _ in inputBytes += bytes.count }
            audio.onPlayback = { if $0 { played = true } }
            audio.onDrained = { drained = true }
            audio.beginStream()
            do { try audio.start(); try await audio.waitUntilCapturing() }
            catch {
                XCTFail("Audio attempt \(attempt): \(audio.lastStartupFailure ?? "capture readiness timeout")")
                return
            }
            XCTAssertTrue(audio.isRunning)
            XCTAssertGreaterThan(inputBytes, 0)
            // Quiet synthetic output exercises the same 24 kHz PCM playback path.
            try audio.play(Data(count: 24_000), sequence: 1)
            audio.markOutputDone()
            let deadline = Date().addingTimeInterval(3)
            while !drained, Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
            XCTAssertTrue(played)
            XCTAssertTrue(drained)
            XCTAssertGreaterThan(inputBytes, 960)
            audio.stop()
            XCTAssertFalse(audio.isRunning)
            let stoppedBytes = inputBytes
            try await Task.sleep(for: .milliseconds(100))
            XCTAssertEqual(inputBytes, stoppedBytes)
        }
    }
}
