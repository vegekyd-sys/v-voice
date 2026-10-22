import Foundation

/// App-owned layouts inside the system's expanded presentation. Compact is system-owned.
public enum IslandLayout: String, Codable, Hashable, Sendable { case audio, conversation }
public enum IslandAudioSource: String, Codable, Hashable, Sendable { case none, input, output }
public struct IslandSnapshot: Codable, Hashable, Sendable {
    public var layout: IslandLayout
    public var reactionID: String
    public var levels: [UInt8]
    public var audioSource: IslandAudioSource
    public var sampledAt: Date?
    public init(layout: IslandLayout = .audio, reactionID: String = "listen-5", levels: [UInt8] = [], audioSource: IslandAudioSource = .none, sampledAt: Date? = nil) {
        self.layout = layout; self.reactionID = reactionID
        self.levels = Array(levels.suffix(9)).map { min($0, 100) }
        self.audioSource = audioSource; self.sampledAt = sampledAt
    }
}

/// Cosmetic state only. No authority, calls, timers, audio engine, or provider requests.
public struct IslandPresentation: Sendable {
    public private(set) var owner: String?
    public private(set) var layout: IslandLayout = .audio
    private var documents: [String] = []
    private var utterance: String?
    private var newDocumentAt: Date?
    private var approvedReaction: (id: String, at: Date)?
    private var connectionAnnounced = false
    private var input: [UInt8] = [], output: [UInt8] = []
    private var inputPeak: Double = 0, outputPeak: Double = 0
    private var lastSample: Date?, lastPublish: Date?
    private var lastSource: IslandAudioSource = .none
    private var lastLevels: [UInt8] = []
    public init() {}
    public mutating func synchronize(owner: String, documentID: String?, utterance: String? = nil, now: Date = Date()) {
        if self.owner != owner { self = Self(); self.owner = owner }
        if let utterance, self.utterance != utterance { self.utterance = utterance; approvedReaction = nil; newDocumentAt = nil }
        if let documentID, !documents.contains(documentID) {
            documents.append(documentID); documents = Array(documents.suffix(32)); layout = .conversation; newDocumentAt = now
        }
    }
    @discardableResult public mutating func select(_ layout: IslandLayout, owner: String) -> Bool {
        guard self.owner == owner else { return false }; self.layout = layout; return true
    }
    /// Consume the first successful connection even in foreground, so later
    /// backgrounding or recovery cannot replay a connection alert.
    public mutating func announceConnection(owner: String, foreground: Bool) -> Bool {
        guard self.owner == owner, !connectionAnnounced else { return false }
        connectionAnnounced = true
        return !foreground
    }
    @discardableResult public mutating func displayedReaction(_ id: String, owner: String, now: Date) -> Bool {
        guard self.owner == owner, IslandReactionCatalog.assets[id] != nil, id != "idle" else { return false }
        // Do not extend a semantic reaction indefinitely through repeated display receipts.
        if approvedReaction?.id != id { approvedReaction = (id, now) }
        return true
    }
    /// Accumulate real energy, keep nine 100 ms peaks, request at most one UI update/second.
    @discardableResult public mutating func observeAudio(inputRMS: Double, outputRMS: Double?, muted: Bool, now: Date) -> Bool {
        inputPeak = max(inputPeak, muted ? 0 : Self.safe(inputRMS))
        outputPeak = max(outputPeak, Self.safe(outputRMS ?? 0))
        if let lastSample, now.timeIntervalSince(lastSample) < 0.1 { return false }
        self.lastSample = now
        input.append(Self.quantize(inputPeak)); output.append(Self.quantize(outputPeak))
        input = Array(input.suffix(9)); output = Array(output.suffix(9)); inputPeak = 0; outputPeak = 0
        if let lastPublish, now.timeIntervalSince(lastPublish) < 1 { return false }
        let next = envelope(muted: muted, now: now)
        guard next.source != lastSource || next.levels != lastLevels else { return false }
        lastPublish = now; lastSource = next.source; lastLevels = next.levels; return true
    }
    public mutating func clearAudio() { input = []; output = []; inputPeak = 0; outputPeak = 0; lastSample = nil; lastSource = .none; lastLevels = [] }
    public func snapshot(phase: VoicePhase, muted: Bool, taskActivity: String? = nil, hasDocument: Bool = false, now: Date) -> IslandSnapshot {
        let quiet = ![VoicePhase.listening, .thinking, .speaking, .muted].contains(phase)
        var fallback = "listen-5"
        if phase == .thinking { fallback = "reaction-6" }
        if let taskActivity, ["web", "memory", "calendar", "background"].contains(taskActivity) { fallback = taskActivity + "-0" }
        if hasDocument, phase != .thinking, taskActivity == nil, let newDocumentAt, (0...5).contains(now.timeIntervalSince(newDocumentAt)) { fallback = "complete-0" }
        let approved = approvedReaction.flatMap { now.timeIntervalSince($0.at) >= 0 && now.timeIntervalSince($0.at) <= 5 ? $0.id : nil }
        let audio = quiet ? (source: IslandAudioSource.none, levels: [UInt8]()) : envelope(muted: muted, now: now)
        return IslandSnapshot(layout: layout, reactionID: quiet ? "listen-5" : approved ?? fallback,
                              levels: audio.levels, audioSource: audio.source, sampledAt: audio.source == .none ? nil : lastSample)
    }
    private func envelope(muted: Bool, now: Date) -> (source: IslandAudioSource, levels: [UInt8]) {
        guard let lastSample, (0...2).contains(now.timeIntervalSince(lastSample)) else { return (.none, []) }
        // Near-end takes priority only when it actually has energy; never invent a speaker identity.
        if !muted, input.suffix(2).contains(where: { $0 >= 34 }) { return (.input, input) }
        if output.contains(where: { $0 > 0 }) { return (.output, output) }
        if !muted, input.contains(where: { $0 > 0 }) { return (.input, input) }
        return (.none, [])
    }
    private static func safe(_ value: Double) -> Double { value.isFinite ? max(0, min(1, value)) : 0 }
    private static func quantize(_ rms: Double) -> UInt8 {
        guard rms > 0.006 else { return 0 }
        return UInt8(max(0, min(100, ((20 * log10(rms) + 54) / 42 * 100).rounded())))
    }
}

/// Read-only energy index aligned to AVAudioPlayerNode's actual sample clock.
/// A queued packet is not considered audible until the cursor reaches its interval.
public struct PlaybackEnvelope: Sendable {
    private struct Segment: Sendable { let start: Int64; let end: Int64; let rms: Double }
    private var segments: [Segment] = []
    private var scheduled: Int64 = 0
    public init() {}
    public mutating func reset() { segments.removeAll(keepingCapacity: true); scheduled = 0 }
    public mutating func skip(frames: Int) { scheduled += Int64(max(0, frames)) }
    public mutating func appendPCM16(_ data: Data) {
        guard data.count % 2 == 0 else { return }
        data.withUnsafeBytes { raw in
            let count = data.count / 2
            for start in stride(from: 0, to: count, by: 480) {
                let end = min(start + 480, count)
                var energy: Double = 0
                for i in start..<end {
                    let value = Double(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))) / 32768
                    energy += value * value
                }
                segments.append(Segment(start: scheduled + Int64(start), end: scheduled + Int64(end), rms: sqrt(energy / Double(end - start))))
            }
            scheduled += Int64(count)
        }
        if segments.count > 9_000 { segments.removeFirst(segments.count - 9_000) }
    }
    public func rms(at sample: Int64) -> Double? {
        guard sample >= 0 else { return nil }
        var low = 0, high = segments.count
        while low < high { let mid = (low + high) / 2; if segments[mid].end <= sample { low = mid + 1 } else { high = mid } }
        guard low < segments.count, segments[low].start <= sample else { return nil }; return segments[low].rms
    }
}
