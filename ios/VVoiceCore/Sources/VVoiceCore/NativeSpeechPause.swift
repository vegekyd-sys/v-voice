import Foundation

/// Reversible playback courtesy. It never identifies speakers or discards audio;
/// only a new provider response can replace the unconsumed playback queue.
public struct NativeSpeechPause: Sendable {
    public private(set) var held = false
    public private(set) var yielded = false
    private var voicedMS = 0.0, quietMS = 0.0, floor = 0.004
    private var inUtterance = false, locked = false, native = false, awaitingDecision = false
    private var expires = 0.0, hardExpires = 0.0
    private var policy: NativeRuntimePolicy.Pause?
    public init(policy: NativeRuntimePolicy.Pause? = nil) { self.policy = policy }
    public mutating func reset() { let noise = floor; self = Self(policy: policy); floor = noise }
    public mutating func nativeStarted(at: Double) {
        guard held || inUtterance else { return }
        held = true; yielded = true; native = true; expires = at + (policy?.nativeHoldMS ?? 15000); hardExpires = expires
    }
    public mutating func nativeStopped(at: Double, recognized: Bool = true) {
        if held { native = false; awaitingDecision = awaitingDecision || recognized; expires = at + (policy?.holdMS ?? 1800) }
    }
    public mutating func ignored() { awaitingDecision = false; held = false; native = false; locked = true; yielded = false }
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
        let voiced = rms >= max(policy?.rms ?? 0.035, floor * (policy?.noiseMultiplier ?? 3)) && zcr > (policy?.zcrMin ?? 0.004) && zcr < (policy?.zcrMax ?? 0.32)
        if voiced { quietMS = 0; voicedMS += ms; if voicedMS >= (policy?.onsetMS ?? 140) { inUtterance = true } }
        else {
            quietMS += ms
            if !inUtterance { voicedMS = 0 }
            if quietMS >= (policy?.quietMS ?? 400) { voicedMS = 0; inUtterance = false; locked = false }
        }
        if !enabled {
            held = false; yielded = false; expires = 0; hardExpires = 0; locked = false; native = false; awaitingDecision = false
            return false
        }
        if inUtterance && !held && !locked { held = true; yielded = true; hardExpires = at + (policy?.maxHoldMS ?? 12000) }
        if held && !native && voiced { expires = min(hardExpires, at + (policy?.holdMS ?? 1800)) }
        if held && expires == 0 { expires = min(hardExpires, at + (policy?.holdMS ?? 1800) - quietMS) }
        if !voiced && !held { floor = min(0.012, floor * 0.98 + min(rms, 0.012) * 0.02) }
        let grace = !native && !generationComplete ? (policy?.generationGraceMS ?? 600) : 0
        // A completed utterance waits for native disposition, never a timer.
        // Ignored TV/bystander speech can still resume the retained samples.
        if held && !awaitingDecision && (at >= expires + grace || at >= hardExpires) { held = false; native = false; locked = true }
        return held
    }
}
