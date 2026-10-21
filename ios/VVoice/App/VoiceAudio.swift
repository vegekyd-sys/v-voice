import AVFoundation
import OSLog
import VVoiceCore

/// One converter per input tap; AVAudioEngine invokes this tap serially.
private final class CaptureConverter: @unchecked Sendable {
    let converter: AVAudioConverter
    let target: AVAudioFormat
    let onFrame: @Sendable (Data, Double) -> Void
    private var accumulator = Data()
    init(input: AVAudioFormat, onFrame: @escaping @Sendable (Data, Double) -> Void) throws {
        target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: true)!
        guard let c = AVAudioConverter(from: input, to: target) else { throw VoiceError.audio }
        converter = c; self.onFrame = onFrame
    }
    func consume(_ input: AVAudioPCMBuffer) {
        let capacity = AVAudioFrameCount(Double(input.frameLength) * 24_000 / input.format.sampleRate + 32)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var supplied = false; var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in
            if supplied { state.pointee = .noDataNow; return nil }
            supplied = true; state.pointee = .haveData; return input
        }
        guard error == nil, status != .error, let samples = output.int16ChannelData?[0], output.frameLength > 0 else { return }
        accumulator.append(UnsafeBufferPointer(start: samples, count: Int(output.frameLength)))
        // Exactly 20 ms, signed little-endian PCM16 mono, matching the existing relay.
        while accumulator.count >= 960 {
            let frame = Data(accumulator.prefix(960)); accumulator.removeFirst(960)
            let energy = frame.withUnsafeBytes { bytes -> Double in
                let values = bytes.bindMemory(to: Int16.self)
                return sqrt(values.reduce(0) { $0 + pow(Double(Int16(littleEndian: $1)) / 32768, 2) } / 480)
            }
            onFrame(frame, energy)
        }
    }
}

private final class CaptureHandoff: @unchecked Sendable {
    private let lock = NSLock()
    private var pending = 0
    private var reported = false
    func reserve() -> (accepted: Bool, report: Bool) {
        lock.lock(); defer { lock.unlock() }
        // UI scene transitions may briefly occupy the main actor. Keep at most
        // 1.28 s / 61 KB of 20 ms PCM here, still below the relay's 96 KB bound.
        // Normal delivery remains one frame at a time; sustained backlog fails.
        if pending < 64 { pending += 1; return (true, false) }
        let report = !reported; reported = true; return (false, report)
    }
    func release() { lock.lock(); pending = max(0, pending - 1); lock.unlock() }
}

@MainActor final class VoiceAudio {
    private let logger = Logger(subsystem: "com.versa.vvoice", category: "audio")
    private(set) var lastStartupFailure: String?
    private var generation = UUID()
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24_000, channels: 1, interleaved: false)!
    private var ledger = PlaybackLedger()
    private var outputEnvelope = PlaybackEnvelope()
    /// Display-only. The sample clock, not packet arrival, selects energy.
    var playbackRMS: Double? {
        guard startingOutput, ledger.queuedFrames > 0, let player, player.isPlaying,
              let rendered = player.lastRenderTime, let cursor = player.playerTime(forNodeTime: rendered) else { return nil }
        return outputEnvelope.rms(at: cursor.sampleTime)
    }
    private var lastCaptureAt = Date.distantPast
    private var capturedInput = false
    private var started = false
    private var outputFinished = false
    private var startingOutput = false
    private var ownsSessionActivation = false
    var onInput: ((Data, Double) -> Void)?
    var onPlayback: ((Bool) -> Void)?
    var onDrained: (() -> Void)?
    var onFailure: ((Error) -> Void)?
    var isRunning: Bool { engine?.isRunning == true }
    var queuedFrames: Int { ledger.queuedFrames }

    static func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setPreferredSampleRate(48_000)
        try session.setPreferredIOBufferDuration(0.02)
    }
    func start() throws {
        stop()
        lastStartupFailure = nil
        let session = AVAudioSession.sharedInstance()
        var stage = "category"
        do {
            try Self.configureSession()
            stage = "activation"
            try session.setActive(true); ownsSessionActivation = true
            let e = AVAudioEngine(); let p = AVAudioPlayerNode(); e.attach(p)
            // Configure both I/O nodes while stopped. Voice Processing I/O requires
            // matching input/output stream formats (unlike the simulator's HAL).
            let input = e.inputNode
            let output = e.outputNode
            #if !targetEnvironment(simulator)
            // Simulator HAL is not the device Voice Processing I/O unit.
            stage = "voice-processing"
            try input.setVoiceProcessingEnabled(true)
            #endif
            stage = "input-format"
            let inputFormat = input.outputFormat(forBus: 0)
            guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else { throw VoiceError.audio }
            e.connect(p, to: e.mainMixerNode, format: format)
            // Keep the 24 kHz network/player format upstream of the mixer; the
            // duplex I/O stream must use the microphone's negotiated format.
            e.connect(e.mainMixerNode, to: output, format: inputFormat)
            let captureOwner = generation
            let handoff = CaptureHandoff()
            let converter = try CaptureConverter(input: inputFormat) { [weak self] data, rms in
                let slot = handoff.reserve()
                guard slot.accepted else {
                    if slot.report { Task { @MainActor [weak self] in
                        guard let self, self.generation == captureOwner else { return }; CallDiagnostics.record("audio.capture-overflow"); self.onFailure?(VoiceError.bufferOverflow)
                    } }
                    return
                }
                Task { @MainActor [weak self] in
                    handoff.release()
                    guard let self, self.started, self.generation == captureOwner else { return }; self.capturedInput = true; self.lastCaptureAt = Date(); self.onInput?(data, rms)
                }
            }
            input.installTap(onBus: 0, bufferSize: 960, format: inputFormat) { @Sendable buffer, _ in converter.consume(buffer) }
            engine = e; player = p; stage = "engine-start"; e.prepare(); try e.start(); started = true
        } catch {
            let failure = "\(stage): \((error as NSError).domain) (\((error as NSError).code))"
            lastStartupFailure = failure
            logger.error("Audio startup failed: \(failure, privacy: .public)")
            stop(); throw VoiceError.audio
        }
    }
    func waitUntilCapturing() async throws {
        for _ in 0..<50 {
            guard isRunning else {
                lastStartupFailure = "engine stopped before first PCM frame (captured=\(capturedInput))"
                logger.error("Audio engine stopped before first PCM frame")
                throw VoiceError.audio
            }
            if capturedInput, Date().timeIntervalSince(lastCaptureAt) < 0.3 { return }
            try await Task.sleep(for: .milliseconds(30))
        }
        throw VoiceError.audio
    }
    func play(_ data: Data, sequence: Int?) throws {
        guard started, isRunning, let player else { throw VoiceError.audio }
        guard !data.isEmpty, data.count % 2 == 0, data.count <= 480_000 else { throw VoiceError.protocolMismatch }
        let count = data.count / 2
        guard try ledger.accept(frames: count, sequence: sequence) else { return }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)), let dst = buffer.floatChannelData?[0] else { throw VoiceError.audio }
        data.withUnsafeBytes { bytes in
            let samples = bytes.bindMemory(to: Int16.self)
            for i in 0..<count { dst[i] = Float(Int16(littleEndian: samples[i])) / 32768 }
        }
        outputEnvelope.appendPCM16(data)
        outputFinished = false; buffer.frameLength = AVAudioFrameCount(count)
        let epoch = ledger.epoch
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.ledger.epoch == epoch else { return }
                if self.ledger.consumed(count, epoch: epoch) {
                    self.startingOutput = false
                    self.player?.pause()
                    self.onPlayback?(false)
                    if self.outputFinished { self.onDrained?() }
                }
            }
        }
        if ledger.queuedFrames >= 2880 { startPlayback() }
    }
    private func startPlayback() {
        guard !startingOutput, ledger.queuedFrames > 0 else { return }
        startingOutput = true; player?.play(); onPlayback?(true)
    }
    /// A finite, quiet connection cue after upstream and actual microphone I/O are ready.
    /// Capture remains live; this never substitutes for background execution.
    func playReadyCue() {
        guard isRunning, let player, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 3360), let dst = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = 3360
        for i in 0..<3360 {
            let t = Double(i) / 24_000
            let envelope = pow(sin(Double.pi * Double(i) / 3360), 2) * 0.07
            dst[i] = Float((sin(2 * Double.pi * 660 * t) + sin(2 * Double.pi * 880 * t)) * envelope)
        }
        outputEnvelope.skip(frames: 3360)
        let epoch = ledger.epoch
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { @Sendable [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.ledger.epoch == epoch, self.ledger.queuedFrames == 0 else { return }; self.player?.pause()
            }
        }
        player.play()
    }
    func markOutputDone() {
        outputFinished = true
        if ledger.queuedFrames > 0 { startPlayback() } else { onDrained?() }
    }
    func clear() {
        outputEnvelope.reset()
        ledger.clear(); player?.stop(); startingOutput = false; outputFinished = false; onPlayback?(false)
    }
    func beginStream() {
        clear(); ledger.beginStream()
    }
    func stop() {
        generation = UUID(); started = false; capturedInput = false; lastCaptureAt = .distantPast; clear()
        engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil; player = nil
        if ownsSessionActivation {
            ownsSessionActivation = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}
