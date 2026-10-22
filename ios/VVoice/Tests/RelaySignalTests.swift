import XCTest
import AVFoundation
import VVoiceCore
@testable import VVoice

private final class CapturedSignalFrames: @unchecked Sendable {
    var values: [Data] = []
}

@MainActor final class RelaySignalTests: XCTestCase {
    /// Known audio is converted and uploaded through the production relay class.
    /// This tests signal bytes, not a real microphone or provider recognition.
    func testNonzeroConvertedSignalReachesRelayAndSilenceRemainsDistinct() async throws {
        let base = VoiceFixture.base
        var reset = URLRequest(url: base.appendingPathComponent("fixture/command")); reset.httpMethod = "POST"
        reset.httpBody = Data(#"{"command":"reset"}"#.utf8)
        _ = try await URLSession.shared.data(for: reset)
        let store = BindingStore(service: "com.versa.vvoice.signal-test.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let api = VoiceAPI(store: store)
        let reservation = try await api.call("session", body: ["model":"seeduplex"])
        let id = try XCTUnwrap(reservation["voiceSessionId"] as? String)
        let ticket = try XCTUnwrap(reservation["relayTicket"] as? String)
        let relay = RelayTransport(id: id)
        addTeardownBlock { @MainActor in
            relay.close()
            _ = try? await api.call("close", body: ["voiceSessionId":id])
            api.forget()
        }
        try await relay.connect(session: api.session, request: api.relayRequest(id: id, ticket: ticket))
        let format = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 1, interleaved: false))
        let frames = CapturedSignalFrames()
        let converter = try CaptureConverter(input: format) { data, _ in frames.values.append(data) }
        for block in 0..<30 {
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 960))
            buffer.frameLength = 960
            for i in 0..<960 { buffer.floatChannelData![0][i] = Float(0.2 * sin(Double(block * 960 + i) * 2 * .pi * 440 / 48_000)) }
            converter.consume(buffer)
        }
        XCTAssertGreaterThanOrEqual(frames.values.count, 28)
        for frame in frames.values { relay.sendAudio(frame) }
        func state(after expected: Int) async throws -> [String: Any] {
            let deadline = Date().addingTimeInterval(5)
            repeat {
                let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
                let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
                if value["inputFrames"] as? Int == expected { return value }
                try await Task.sleep(for: .milliseconds(50))
            } while Date() < deadline
            XCTFail("Uploaded signal did not reach the local relay")
            return [:]
        }
        let audible = try await state(after: frames.values.count)
        XCTAssertEqual(audible["inputActiveFrames"] as? Int, frames.values.count)
        XCTAssertEqual(audible["inputBytes"] as? Int, frames.values.count * 960)
        XCTAssertGreaterThan(audible["peakInputRMS"] as? Double ?? 0, 0.1)
        relay.sendAudio(Data(count: 960))
        let silent = try await state(after: frames.values.count + 1)
        XCTAssertEqual(silent["inputActiveFrames"] as? Int, frames.values.count)
        XCTAssertEqual(silent["zeroBytes"] as? Int, 960)
    }
}
