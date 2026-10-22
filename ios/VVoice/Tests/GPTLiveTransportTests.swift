import XCTest
@preconcurrency import WebRTC
import AudioToolbox
import WebKit
import SwiftUI
import VVoiceCore
@testable import VVoice

/// Two actual native WebRTC peers, synthetic PCM only, no network/model account.
@MainActor final class GPTLiveTransportTests: XCTestCase {
    func testLoopbackNegotiatesAudioCaptionsMuteAndClose() async throws {
        let device = GPTSyntheticAudio()
        let factory = RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: device)
        let remote = GPTLoopbackPeer()
        let transport = GPTLiveTransport(factory: factory)
        defer { transport.close(); remote.close(); device.shutdown() }
        var caption = "", peak = 0.0, progress = 0
        transport.onEvent = { event in caption = (event["item"] as? [String: Any])?["text"] as? String ?? caption }
        transport.onLevels = { _, out, advanced in peak = max(peak, out); if advanced { progress += 1 } }
        try await transport.connect { try await remote.answer($0) }
        XCTAssertTrue(transport.isConnected)
        for _ in 0..<50 {
            if peak > 0.003 && caption == "本地 GPT 音频回环" && progress > 2 { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertEqual(caption, "本地 GPT 音频回环")
        XCTAssertGreaterThan(peak, 0.003)
        XCTAssertGreaterThan(progress, 2)
        XCTAssertLessThan(Date().timeIntervalSince(transport.lastCaptureAt), 2)
        transport.setMuted(true)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertTrue(transport.isConnected)
        transport.setMuted(false)
        XCTAssertTrue(transport.send(["type":"fixture.control"]))
        for _ in 0..<20 { if remote.receivedControl { break }; try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertTrue(remote.receivedControl)
        transport.close()
        XCTAssertFalse(transport.isConnected)
        XCTAssertFalse(transport.send(["type":"fixture.control"]))
    }
    func testNativeOwnerGPTSelectionReportCaptionAndH5Reload() async throws {
        let base = VoiceFixture.base
        func command(_ command: String, _ extra: [String: Any] = [:]) async throws {
            var req = URLRequest(url: base.appendingPathComponent("fixture/command")); req.httpMethod = "POST"
            req.httpBody = try JSONSerialization.data(withJSONObject: extra.merging(["command": command]) { _, new in new })
            _ = try await URLSession.shared.data(for: req)
        }
        func state() async throws -> [String: Any] {
            let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
            return try JSONSerialization.jsonObject(with: data) as! [String: Any]
        }
        try await command("reset")
        let previous = UserDefaults.standard.string(forKey: "voiceModel")
        let device = GPTSyntheticAudio(), remote = GPTLoopbackPeer()
        let factory = RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: device)
        let store = BindingStore(service: "com.versa.vvoice.gpt-tests." + UUID().uuidString)
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let call = CallCoordinator(api: VoiceAPI(store: store), makeGPT: { GPTLiveTransport(factory: factory) })
        defer { device.shutdown(); remote.close(); UserDefaults.standard.set(previous, forKey: "voiceModel") }
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        call.sceneChanged(.active); call.model = .gptLive
        let dialing = Task { try await call.startOrContinue() }
        var offer: String?
        for _ in 0..<100 {
            offer = try await state()["lastOffer"] as? String
            if offer != nil { break }; try await Task.sleep(for: .milliseconds(50))
        }
        let answer = try await remote.answer(XCTUnwrap(offer))
        try await command("gpt-answer", ["sdp": answer]); try await dialing.value
        let request = try await state()["lastSessionRequest"] as? [String: Any]
        XCTAssertEqual(request?["model"] as? String, "gpt-live")
        XCTAssertEqual(request?["inputPolicy"] as? String, "native")
        XCTAssertTrue(call.active)
        XCTAssertTrue(call.conversation.turns.contains { $0.text == "本地 GPT 音频回环" })
        let owner = call.presentationID
        call.sceneChanged(.background)
        try await command("report")
        for _ in 0..<30 { if call.activityState.documentID != nil { break }; try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertEqual(call.activityState.documentID, "fixture-plan")
        XCTAssertEqual(call.activityState.island.layout, .conversation)
        XCTAssertEqual(call.activityState.captionSpeaker, "V")
        call.toggleMute(); XCTAssertTrue(call.muted)
        call.toggleMute(); XCTAssertFalse(call.muted)
        call.sceneChanged(.active)
        let host = H5WebHost(call: call, onError: { XCTFail($0) })
        host.latest = H5Snapshot.make(call, visible: true)
        let web = host.makeWebView()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previousWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        defer { host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page); window.isHidden = true; previousWindow?.makeKeyAndVisible() }
        for _ in 0..<100 { if host.ready { break }; try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertTrue(host.ready)
        host.reload(); host.openDocument("fixture-plan")
        var readerVisible = false
        for _ in 0..<100 {
            if host.ready { readerVisible = (try? await web.evaluateJavaScript("document.querySelector('#readerBody table') !== null")) as? Bool == true }
            if readerVisible { break }; try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertTrue(readerVisible, "GPT report must reopen in the reloaded original H5 reader")
        try await call.startOrContinue()
        XCTAssertEqual(call.presentationID, owner)
        let sessions = try await state()["sessions"] as? Int
        XCTAssertEqual(sessions, 1)
        await call.end()
        XCTAssertFalse(call.active)
        let closes = try await state()["closeRequests"] as? Int
        XCTAssertEqual(closes, 1)
    }
    func testInitiallyMutedPeerDoesNotTransmitSoundUntilUnmuted() async throws {
        let device = GPTSyntheticAudio(), remote = GPTLoopbackPeer()
        let transport = GPTLiveTransport(factory: RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: device))
        defer { transport.close(); remote.close(); device.shutdown() }
        try await transport.connect(muted: true) { try await remote.answer($0) }
        try await Task.sleep(for: .milliseconds(300))
        _ = await remote.inputLevel()
        // Opus comfort noise is not transmitted microphone audio. Verify the
        // known input tone is absent; RTP audioLevel can retain a stale level.
        XCTAssertLessThan(remote.inputTone, 0.001)
        transport.setMuted(false)
        var level = 0.0
        for _ in 0..<30 { level = await remote.inputLevel(); if level > 0.003 && remote.inputTone > 0.01 { break }; try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertGreaterThan(level, 0.003)
        XCTAssertGreaterThan(remote.inputTone, 0.01)
    }
    func testSystemAudioBackendCanReturnToPCM() async throws {
        let audio = VoiceAudio(), transport = GPTLiveTransport(), remote = GPTLoopbackPeer()
        defer { transport.close(); remote.close(); audio.stop() }
        try audio.startWebRTC()
        try await transport.connect { try await remote.answer($0) }
        XCTAssertTrue(audio.isRunning)
        XCTAssertLessThan(Date().timeIntervalSince(transport.lastCaptureAt), 2)
        transport.close(); audio.stop()
        XCTAssertFalse(audio.isRunning)
        try audio.start(); try await audio.waitUntilCapturing()
        XCTAssertTrue(audio.isRunning)
    }
    func testCancelledOfferCannotCreateLateConnection() async throws {
        let device = GPTSyntheticAudio()
        let transport = GPTLiveTransport(factory: RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: device))
        defer { transport.close(); device.shutdown() }
        let task = Task { try await transport.connect { _ in try await Task.sleep(for: .seconds(20)); return "v=0" } }
        try await Task.sleep(for: .milliseconds(300))
        task.cancel()
        do { try await task.value; XCTFail("Cancelled dial unexpectedly connected") } catch {}
        XCTAssertFalse(transport.isConnected)
    }
}

private final class GPTSyntheticAudio: NSObject, RTCAudioDevice, @unchecked Sendable {
    private let lock = NSLock()
    private var delegate: (any RTCAudioDeviceDelegate)?
    private var recording = false, playing = false
    private var timer: Timer?
    private var sample = 0.0
    private var tone = 0.0
    var renderedTone: Double { lock.withLock { tone } }
    var deviceInputSampleRate: Double { 48000 }; var deviceOutputSampleRate: Double { 48000 }
    var inputIOBufferDuration: TimeInterval { 0.01 }; var outputIOBufferDuration: TimeInterval { 0.01 }
    var inputNumberOfChannels: Int { 1 }; var outputNumberOfChannels: Int { 1 }
    var inputLatency: TimeInterval { 0.01 }; var outputLatency: TimeInterval { 0.01 }
    var isInitialized: Bool { lock.withLock { delegate != nil } }
    var isPlayoutInitialized: Bool { true }; var isRecordingInitialized: Bool { true }
    var isPlaying: Bool { lock.withLock { playing } }; var isRecording: Bool { lock.withLock { recording } }
    func initialize(with delegate: any RTCAudioDeviceDelegate) -> Bool {
        lock.withLock { self.delegate = delegate }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isInitialized else { return }
            self.timer?.invalidate()
            self.timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak self] _ in self?.tick() }
        }
        return true
    }
    func terminateDevice() -> Bool { lock.withLock { delegate = nil; recording = false; playing = false }; return true }
    func initializePlayout() -> Bool { true }; func initializeRecording() -> Bool { true }
    func startPlayout() -> Bool { lock.withLock { playing = true }; return true }
    func stopPlayout() -> Bool { lock.withLock { playing = false }; return true }
    func startRecording() -> Bool { lock.withLock { recording = true }; return true }
    func stopRecording() -> Bool { lock.withLock { recording = false }; return true }
    @MainActor func shutdown() { timer?.invalidate(); timer = nil; _ = terminateDevice() }
    private func tick() {
        // Main runloop keeps both PCM callbacks on the same OS thread.
        let state = lock.withLock { (delegate, recording, playing) }
        guard let delegate = state.0 else { return }
        var samples = [Int16](repeating: 0, count: 480)
        for i in samples.indices { samples[i] = Int16(sin(sample * 2 * .pi * 440 / 48000) * 4000); sample += 1 }
        var flags: AudioUnitRenderActionFlags = []
        var timestamp = AudioTimeStamp(); timestamp.mSampleTime = sample; timestamp.mFlags = .sampleTimeValid
        samples.withUnsafeMutableBytes { bytes in
            var buffer = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: 960, mData: bytes.baseAddress))
            if state.1 { _ = delegate.deliverRecordedData(&flags, &timestamp, 0, 480, &buffer, nil, nil) }
            if state.2 {
                _ = delegate.getPlayoutData(&flags, &timestamp, 0, 480, &buffer)
                let pcm = bytes.bindMemory(to: Int16.self)
                var real = 0.0, imaginary = 0.0
                for i in 0..<480 {
                    let value = Double(pcm[i]) / 32768
                    real += value * cos(Double(i) * 2 * .pi * 440 / 48000)
                    imaginary += value * sin(Double(i) * 2 * .pi * 440 / 48000)
                }
                lock.withLock { tone = 2 * sqrt(real * real + imaginary * imaginary) / 480 }
            }
        }
    }
}

@MainActor private final class GPTLoopbackPeer: NSObject, RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    private let device = GPTSyntheticAudio()
    private var factory: RTCPeerConnectionFactory!
    private var peer: RTCPeerConnection!
    private var channel: RTCDataChannel?
    var receivedControl = false
    override init() {
        super.init()
        factory = RTCPeerConnectionFactory(encoderFactory: nil, decoderFactory: nil, audioDevice: device)
        let config = RTCConfiguration(); config.sdpSemantics = .unifiedPlan
        peer = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
        peer.add(factory.audioTrack(withTrackId: "synthetic-remote"), streamIds: ["fixture"])
    }
    func answer(_ offer: String) async throws -> String {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in peer.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: offer)) { e in if let e { c.resume(throwing: e) } else { c.resume() } } }
        let answer: RTCSessionDescription = try await withCheckedThrowingContinuation { c in peer.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { s, e in if let s { c.resume(returning: s) } else { c.resume(throwing: e!) } } }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in peer.setLocalDescription(answer) { e in if let e { c.resume(throwing: e) } else { c.resume() } } }
        for _ in 0..<100 { if peer.iceGatheringState == .complete { break }; try await Task.sleep(for: .milliseconds(50)) }
        return peer.localDescription!.sdp
    }
    var inputTone: Double { device.renderedTone }
    func inputLevel() async -> Double {
        let report = await withCheckedContinuation { c in peer.statistics { c.resume(returning: $0) } }
        return report.statistics.values.filter { $0.type == "inbound-rtp" }.compactMap { ($0.values["audioLevel"] as? NSNumber)?.doubleValue }.max() ?? 0
    }
    func close() { channel?.delegate = nil; channel?.close(); peer.delegate = nil; peer.close(); device.shutdown() }
    private func welcome(_ channel: RTCDataChannel) {
        guard channel.readyState == .open else { return }
        for value: [String: Any] in [["type":"session.started"], ["type":"output_transcript.added","item":["id":"fixture","text":"本地 GPT 音频回环"]]] {
            channel.sendData(RTCDataBuffer(data: try! JSONSerialization.data(withJSONObject: value), isBinary: false))
        }
    }
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) { Task { @MainActor in self.welcome(dataChannel) } }
    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) { Task { @MainActor in self.receivedControl = true } }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) { Task { @MainActor in self.channel = dataChannel; dataChannel.delegate = self; self.welcome(dataChannel) } }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
}
