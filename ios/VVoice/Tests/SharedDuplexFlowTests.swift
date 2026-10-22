import XCTest
import Foundation
import AVFoundation
import SwiftUI
import VVoiceCore
@testable import VVoice

/// Production HTTP/relay/provider adapter with a local simulated upstream.
/// No provider access, recorded microphone samples or real tool invocation.
@MainActor final class SharedDuplexFlowTests: XCTestCase {
    private var base: URL { URL(string: "http://127.0.0.1:\(ProcessInfo.processInfo.environment["VVOICE_SHARED_FIXTURE_PORT"] ?? "29847")/")! }
    private func command(_ name: String) async throws {
        var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
        r.httpBody = try JSONSerialization.data(withJSONObject: ["command":name]); r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.data(for: r)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }
    private func state() async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    private func until(_ predicate: @MainActor () async throws -> Bool, seconds: Double = 2) async throws {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end { if try await predicate() { return }; try await Task.sleep(for: .milliseconds(30)) }
        XCTFail("Shared service/native playback state did not converge")
    }
    func testSharedProviderClearsBeforeNewPCMRejectsOldTailAndStillHangsUp() async throws {
        let (_, response) = try await URLSession.shared.data(from: base.appendingPathComponent("voice/"))
        let header = try XCTUnwrap((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie"))
        let cookie = String(try XCTUnwrap(header.split(separator: ";").first))
        let store = BindingStore(service: "com.versa.vvoice.shared-duplex.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: cookie))
        let call = CallCoordinator(api: VoiceAPI(store: store)); call.sceneChanged(.active); call.model = .seeduplex
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        try await call.startOrContinue(); call.toggleMute()
        try await command("old")
        try await until { try await self.state()["playbackBusy"] as? Bool == true }
        let before = try await state()["inputFrames"] as? Int ?? 0
        try await command("replace")
        try await until { try await self.state()["playbackBusy"] as? Bool == false }
        try await Task.sleep(for: .milliseconds(180))
        let gap = try await state()
        XCTAssertEqual(gap["playbackBusy"] as? Bool, false, "old playback must stop before replacement PCM exists")
        XCTAssertGreaterThan(gap["inputFrames"] as? Int ?? 0, before)
        try await command("next")
        try await until { try await self.state()["playbackBusy"] as? Bool == true }
        try await until { try await self.state()["playbackBusy"] as? Bool == false }
        try await command("farewell")
        try await until({ call.phase == .ended }, seconds: 5)
    }
    func testRecognizedInterruptionDoesNotResumeOldSpeechWhileWaitingAndIgnoredSpeechStillResumes() async throws {
        let (_, response) = try await URLSession.shared.data(from: base.appendingPathComponent("voice/"))
        let header = try XCTUnwrap((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie"))
        let cookie = String(try XCTUnwrap(header.split(separator: ";").first))
        let store = BindingStore(service: "com.versa.vvoice.shared-wait.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: cookie))
        let audio = VoiceAudio()
        let call = CallCoordinator(api: VoiceAPI(store: store), audio: audio)
        call.sceneChanged(.active); call.model = .seeduplex
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        try await call.startOrContinue()
        let input = try XCTUnwrap(audio.onInput)
        // Discard physical input; feed only silence and deliberate synthetic
        // speech into the production capture handler. No recording/model call.
        audio.onInput = { bytes, _ in input(Data(count: bytes.count), 0) }
        let samples = (0..<480).map { Int16(0.15 * sin(Double($0) * 2 * .pi * 440 / 24000) * 32767).littleEndian }
        let voice = samples.withUnsafeBytes { Data($0) }
        try await command("old")
        try await until { audio.queuedFrames > 0 }
        for attempt in 0..<2 {
            for _ in 0..<8 { input(voice, 0.1) }
            XCTAssertTrue(audio.playbackPaused)
            try await command("speech-start"); try await command("speech-complete")
            let retained = audio.queuedFrames
            for _ in 0..<32 {
                try await Task.sleep(for: .milliseconds(100))
                XCTAssertTrue(audio.playbackPaused, "Old speech must not resume at 1.8 seconds")
                XCTAssertEqual(audio.queuedFrames, retained)
            }
            XCTAssertTrue(audio.isRunning)
            if attempt == 0 {
                try await command("ignored")
                try await until { !audio.playbackPaused }
                XCTAssertGreaterThan(audio.queuedFrames, 0, "Ignored speech retains the old queue")
                try await Task.sleep(for: .milliseconds(600))
            }
        }
        try await command("replace")
        try await until { audio.queuedFrames == 0 }
        try await command("next")
        try await until { audio.queuedFrames > 0 && !audio.playbackPaused }
        try await until { audio.queuedFrames == 0 }
        try await command("farewell")
        try await until({ call.phase == .ended }, seconds: 5)
    }

}
