import Foundation

/// Decides, frame by frame, whether microphone audio is sent while the uplink is not draining.
/// The same rule as the web page's relay (lab/gpt-live-h5/relay-audio.mjs): a stalled connection
/// sheds new frames so speech stays current, and the call ends only when it never drains. Before,
/// the App ended the call once 96 KB (two seconds) waited, so a 20 s stall on a lossy route that the
/// web page rode out hung the App's call up (11/21).
public struct UploadBackpressure: Sendable {
    public enum Decision: Equatable, Sendable {
        case send
        /// Sending again after shedding `frames` frames for `shedMS`.
        case resumed(shedMS: Int, frames: Int)
        /// Dropped; `first` is the start of a stall.
        case shed(first: Bool)
        case fail
    }
    public let policy: NativeRuntimePolicy.Upload
    private var stalledAt: Double?
    private var frames = 0
    public init(policy: NativeRuntimePolicy.Upload = .standard) { self.policy = policy }
    /// `waiting`: bytes handed to the connection and not yet sent; `nowMS`: a monotonic clock.
    public mutating func decide(waiting: Int, nowMS: Double) -> Decision {
        let over = stalledAt == nil ? waiting > policy.shedBytes : waiting > policy.resumeBytes
        guard over else {
            guard let since = stalledAt else { return .send }
            let shed = frames; stalledAt = nil; frames = 0
            return .resumed(shedMS: Int(nowMS - since), frames: shed)
        }
        let first = stalledAt == nil
        if first { stalledAt = nowMS }
        frames += 1
        return nowMS - stalledAt! > policy.stallMS ? .fail : .shed(first: first)
    }
}
