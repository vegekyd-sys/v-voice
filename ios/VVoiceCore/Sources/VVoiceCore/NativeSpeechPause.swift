import Foundation

/// Reversible playback courtesy. It never identifies speakers or discards audio;
/// only a new provider response can replace the unconsumed playback queue.
public struct NativeSpeechPause: Sendable {
    public private(set) var held = false
    public private(set) var yielded = false
    private var voicedMS = 0.0, quietMS = 0.0
    private var inUtterance = false, locked = false, native = false, awaitingDecision = false
    private var expires = 0.0, hardExpires = 0.0
    private var lastVoicedAt: Double?
    private var pendingNativeStartAt: Double?
    private var policy: NativeRuntimePolicy.Pause?
    public init(policy: NativeRuntimePolicy.Pause? = nil) { self.policy = policy }
    public mutating func reset() { self = Self(policy: policy) }
    public mutating func nativeStarted(at: Double) {
        // Local energy is only corroboration, never a playback command. A short
        // utterance may have ended before the service onset reaches the phone.
        guard held || !locked else { return }
        guard held || lastVoicedAt.map({ at >= $0 && at - $0 <= (policy?.confirmationMS ?? 2000) }) == true else {
            pendingNativeStartAt = at; return
        }
        pendingNativeStartAt = nil
        held = true; yielded = true; native = true; expires = at + (policy?.nativeHoldMS ?? 15000); hardExpires = expires
    }
    /// A high-confidence acoustic speech result can yield before network onset.
    /// It still requires fresh local onset evidence and remains reversible.
    public mutating func localSpeech(confidence: Double, at: Double) {
        guard !held, !locked, confidence >= (policy?.speechConfidence ?? 0.9),
              lastVoicedAt.map({ at >= $0 && at - $0 <= (policy?.quietMS ?? 400) }) == true else { return }
        held = true; yielded = true; native = false
        hardExpires = at + (policy?.maxHoldMS ?? 12000)
        expires = at + (policy?.holdMS ?? 1800)
    }
    public mutating func nativeStopped(at: Double, recognized: Bool = true) {
        pendingNativeStartAt = nil
        if held { native = false; awaitingDecision = awaitingDecision || recognized; expires = at + (policy?.holdMS ?? 1800) }
    }
    public mutating func ignored() { pendingNativeStartAt = nil; awaitingDecision = false; held = false; native = false; locked = true; yielded = false }
    public mutating func generationDone(at: Double) {
        if held && !native { expires = max(expires, min(hardExpires, at + (policy?.doneGraceMS ?? 250))) }
    }
    public mutating func observe(_ data: Data, enabled: Bool, at: Double, generationComplete: Bool) -> Bool {
        let signal = data.withUnsafeBytes { bytes -> (Double, Double, Double) in
            let samples = bytes.bindMemory(to: Int16.self)
            var energy = 0.0, crossings = 0
            for i in samples.indices {
                let sample = Int16(littleEndian: samples[i])
                energy += pow(Double(sample) / 32768, 2)
                if i > 0 && ((sample < 0) != (Int16(littleEndian: samples[i - 1]) < 0)) { crossings += 1 }
            }
            return (sqrt(energy / Double(max(1, samples.count))), Double(crossings) / Double(max(1, samples.count)), Double(samples.count) / 24)
        }
        let (rms, zcr, ms) = signal
        // This is corroboration for confirmed speech, not an energy-only VAD.
        // Quiet syllables must not also pass the former 0.035 / 140 ms gate.
        let voiced = rms >= (policy?.speechRMS ?? 0.006) && zcr > (policy?.zcrMin ?? 0.004) && zcr < (policy?.zcrMax ?? 0.32)
        if voiced { quietMS = 0; voicedMS = min(policy?.speechOnsetMS ?? 60, voicedMS + ms); if voicedMS >= (policy?.speechOnsetMS ?? 60) { inUtterance = true } }
        else {
            quietMS += ms
            if !inUtterance { voicedMS = max(0, voicedMS - ms) }
            if quietMS >= (policy?.quietMS ?? 400) { voicedMS = 0; inUtterance = false; locked = false }
        }
        if !enabled {
            pendingNativeStartAt = nil; lastVoicedAt = nil; voicedMS = 0; inUtterance = false; held = false; yielded = false; expires = 0; hardExpires = 0; locked = false; native = false; awaitingDecision = false
            return false
        }
        if inUtterance && voiced { lastVoicedAt = at }
        if let start = pendingNativeStartAt {
            if at - start > (policy?.confirmationMS ?? 2000) { pendingNativeStartAt = nil }
            else if at >= start && inUtterance && voiced { nativeStarted(at: at) }
        }
        // RMS/ZCR alone never acquires a pause. A service hold or a trusted
        // acoustic speech classification must corroborate the local candidate.
        if held && !native && voiced { expires = min(hardExpires, at + (policy?.holdMS ?? 1800)) }
        if held && expires == 0 { expires = min(hardExpires, at + (policy?.holdMS ?? 1800) - quietMS) }
        let grace = !native && !generationComplete ? (policy?.generationGraceMS ?? 600) : 0
        // A completed utterance waits for native disposition, never a timer.
        // Ignored TV/bystander speech can still resume the retained samples.
        if held && !awaitingDecision && (at >= expires + grace || at >= hardExpires) { held = false; native = false; locked = true }
        return held
    }
}
