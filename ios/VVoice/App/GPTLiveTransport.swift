import Foundation
@preconcurrency import WebRTC
import VVoiceCore

/// Only the native call owner creates this peer. SDP is exchanged through the
/// existing authenticated Voice endpoint; provider credentials never reach H5.
@MainActor final class GPTLiveTransport: NSObject {
    private let factory: RTCPeerConnectionFactory
    private var peer: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var track: RTCAudioTrack?
    private var statsTask: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var ready: CheckedContinuation<Void, Error>?
    private var started = false
    private var closed = false
    private var connected = false
    private var captureDuration = 0.0
    private(set) var lastCaptureAt = Date.distantPast
    private var outputDuration = 0.0
    private var outputEnergy = 0.0
    private var lastOutputAt = Date.distantPast
    private(set) var speaking = false
    var onEvent: (([String: Any]) -> Void)?
    var onLevels: ((Double, Double, Bool) -> Void)?
    var onPlayback: ((Bool) -> Void)?
    var onFailure: ((Error) -> Void)?
    var isConnected: Bool { connected && !closed }
    init(factory: RTCPeerConnectionFactory = RTCPeerConnectionFactory()) { self.factory = factory; super.init() }

    func connect(muted: Bool = false, exchange: @escaping @MainActor (String) async throws -> String) async throws {
        let config = RTCConfiguration(); config.sdpSemantics = .unifiedPlan
        guard let pc = factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self) else { throw VoiceError.connection }
        peer = pc
        let source = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let audio = factory.audioTrack(with: source, trackId: "v-voice-audio"); audio.isEnabled = !muted; track = audio
        pc.add(audio, streamIds: ["v-voice"])
        let channel = pc.dataChannel(forLabel: "oai-events", configuration: RTCDataChannelConfiguration())
        self.channel = channel; channel?.delegate = self
        startStats(pc)
        try await withTaskCancellationHandler {
            let offer: RTCSessionDescription = try await withCheckedThrowingContinuation { c in
                pc.offer(for: RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true"], optionalConstraints: nil)) { sdp, error in
                    if let error { c.resume(throwing: error) } else if let sdp { c.resume(returning: sdp) } else { c.resume(throwing: VoiceError.connection) }
                }
            }
            guard !closed else { throw CancellationError() }
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in pc.setLocalDescription(offer) { error in if let error { c.resume(throwing: error) } else { c.resume() } } }
            // The endpoint accepts one complete SDP, not trickled candidates.
            for _ in 0..<100 {
                if pc.iceGatheringState == .complete { break }
                try await Task.sleep(for: .milliseconds(50)); guard !closed else { throw CancellationError() }
            }
            guard !closed, let local = pc.localDescription?.sdp else { throw CancellationError() }
            let answer = try await exchange(local)
            guard !closed, answer.hasPrefix("v=0"), answer.utf8.count <= 65_536 else { throw VoiceError.protocolMismatch }
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: answer)) { error in if let error { c.resume(throwing: error) } else { c.resume() } } }
            try await withCheckedThrowingContinuation { c in
                ready = c; checkReady()
                guard ready != nil else { return }
                deadline = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(25)); guard !Task.isCancelled else { return }; self?.fail(VoiceError.connection)
                }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.close() } }
    }
    private func checkReady() {
        guard !closed, connected, started, channel?.readyState == .open,
              peer?.receivers.contains(where: { $0.track?.kind == kRTCMediaStreamTrackKindAudio }) == true, captureDuration > 0 else { return }
        ready?.resume(); ready = nil; deadline?.cancel()
    }
    func setMuted(_ muted: Bool) {
        track?.isEnabled = !muted
        if !muted { lastCaptureAt = Date() } // Allow the next statistics sample after unmute.
    }
    @discardableResult func send(_ event: [String: Any]) -> Bool {
        guard !closed, channel?.readyState == .open, let bytes = try? JSONSerialization.data(withJSONObject: event), bytes.count < 65_536 else { return false }
        return channel?.sendData(RTCDataBuffer(data: bytes, isBinary: false)) == true
    }
    private func startStats(_ pc: RTCPeerConnection) {
        statsTask = Task { [weak self] in
            while !Task.isCancelled {
                let report = await withCheckedContinuation { c in pc.statistics { c.resume(returning: $0) } }
                guard let self, !self.closed else { return }
                var input = 0.0, output = 0.0, receivedDuration = 0.0, receivedEnergy = 0.0
                for stat in report.statistics.values {
                    let v = stat.values
                    guard v["kind"] as? String == "audio" || v["mediaType"] as? String == "audio" else { continue }
                    if stat.type == "media-source" {
                        input = (v["audioLevel"] as? NSNumber)?.doubleValue ?? 0
                        let duration = (v["totalSamplesDuration"] as? NSNumber)?.doubleValue ?? 0
                        if duration > self.captureDuration { self.captureDuration = duration; self.lastCaptureAt = Date() }
                    } else if stat.type == "inbound-rtp" {
                        receivedDuration = max(receivedDuration, (v["totalSamplesDuration"] as? NSNumber)?.doubleValue ?? 0)
                        receivedEnergy = max(receivedEnergy, (v["totalAudioEnergy"] as? NSNumber)?.doubleValue ?? 0)
                    }
                }
                let progressed = receivedDuration > self.outputDuration
                if progressed {
                    output = sqrt(max(0, receivedEnergy - self.outputEnergy) / (receivedDuration - self.outputDuration))
                    if !output.isFinite { output = 0 }
                }
                self.outputDuration = receivedDuration; self.outputEnergy = receivedEnergy
                if output > 0.003 { self.lastOutputAt = Date() }
                let playing = Date().timeIntervalSince(self.lastOutputAt) < 0.35
                if playing != self.speaking { self.speaking = playing; self.onPlayback?(playing) }
                self.onLevels?(input, output, progressed); self.checkReady()
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
            }
        }
    }
    private func receive(_ data: Data) {
        guard !closed, data.count <= 1_000_000, let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if event["type"] as? String == "session.started" { started = true; checkReady() }
        if event["type"] as? String == "error" { fail(VoiceError.unavailable); return }
        onEvent?(event)
    }
    private func fail(_ error: Error) {
        guard !closed else { return }; let callback = onFailure
        ready?.resume(throwing: error); ready = nil; close(); callback?(error)
    }
    func close() {
        guard !closed else { return }; closed = true
        ready?.resume(throwing: CancellationError()); ready = nil
        deadline?.cancel(); statsTask?.cancel(); statsTask = nil
        channel?.delegate = nil; channel?.close(); channel = nil
        track?.isEnabled = false; track = nil
        peer?.delegate = nil; peer?.close(); peer = nil
        connected = false
    }
}

extension GPTLiveTransport: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) { Task { @MainActor [weak self] in
        guard let self, !self.closed else { return }
        if dataChannel.readyState == .closed { self.fail(VoiceError.connection) } else { self.checkReady() }
    } }
    nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        let bytes = buffer.data; Task { @MainActor [weak self] in self?.receive(bytes) }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) { Task { @MainActor [weak self] in
        guard let self, !self.closed else { return }
        self.connected = newState == .connected
        if [.failed, .closed, .disconnected].contains(newState) { self.fail(VoiceError.connection) } else { self.checkReady() }
    } }
}
