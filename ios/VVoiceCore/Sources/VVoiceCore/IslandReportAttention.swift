import Foundation

/// Report delivery is distinct from ordinary waveform/caption updates. Keep
/// one alert per delivered revision and a brief quiet window for system presentation.
public struct IslandReportAttention: Sendable {
    private let owner: String
    private var announced: [CallDocument] = []
    private var protectedAt: Date?
    public init(owner: String) { self.owner = owner }

    public mutating func request(_ report: CallDocument, owner: String, inBackground: Bool, now: Date) -> Bool {
        guard self.owner == owner, inBackground, !announced.contains(report) else { return false }
        announced.removeAll { $0.id == report.id }
        announced.append(report)
        announced = Array(announced.suffix(32))
        protectedAt = now
        return true
    }

    public func protectsPresentation(at now: Date) -> Bool {
        guard let protectedAt else { return false }
        return (0..<6).contains(now.timeIntervalSince(protectedAt))
    }

    /// Explicit user controls and foreground reading always take precedence.
    public mutating func releasePresentation() { protectedAt = nil }
}
