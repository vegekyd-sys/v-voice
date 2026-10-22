import XCTest
import AVFoundation
@testable import VVoice

private final class ConvertedCapture: @unchecked Sendable {
    var frames: [(Data, Double)] = []
}

/// Byte counters can pass with a silent microphone. Verify actual signal and
/// framing independently of hardware permissions, network, and model calls.
final class CaptureConverterTests: XCTestCase {
    func testNegotiatedInputFormatsPreserveSpeechBandSignal() throws {
        for rate in [8_000.0, 16_000.0, 24_000.0, 48_000.0] {
            let format = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false))
            let result = ConvertedCapture()
            let converter = try CaptureConverter(input: format) { data, rms in result.frames.append((data, rms)) }
            let count = Int(rate * 0.02)
            var cursor = 0
            for _ in 0..<30 {
                let input = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)))
                input.frameLength = AVAudioFrameCount(count)
                for i in 0..<count { input.floatChannelData![0][i] = Float(0.2 * sin(Double(cursor + i) * 2 * .pi * 440 / rate)) }
                cursor += count
                converter.consume(input)
            }
            XCTAssertGreaterThanOrEqual(result.frames.count, 28, "rate=\(rate)")
            for (data, rms) in result.frames {
                XCTAssertEqual(data.count, 960)
                XCTAssertGreaterThan(rms, 0.10, "rate=\(rate)")
                XCTAssertLessThan(rms, 0.18, "rate=\(rate)")
                let peak = data.withUnsafeBytes { raw in raw.bindMemory(to: Int16.self).map { abs(Int(Int16(littleEndian: $0))) }.max() ?? 0 }
                XCTAssertGreaterThan(peak, 5_000)
            }
        }
    }

    func testSilentInputIsReportedAsSilenceDespiteFullPCMFrames() throws {
        let format = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 1, interleaved: false))
        let result = ConvertedCapture()
        let converter = try CaptureConverter(input: format) { data, rms in result.frames.append((data, rms)) }
        let input = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 960))
        input.frameLength = 960
        input.floatChannelData![0].initialize(repeating: 0, count: 960)
        for _ in 0..<10 { converter.consume(input) }
        XCTAssertFalse(result.frames.isEmpty)
        for (data, rms) in result.frames {
            XCTAssertEqual(data, Data(count: 960))
            XCTAssertEqual(rms, 0)
        }
    }
}
