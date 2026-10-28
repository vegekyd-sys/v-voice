import Foundation

/// Bounded local lifecycle evidence only: no entry, cookies, audio, transcripts,
/// contacts, URLs, or server response bodies.
enum CallDiagnostics {
    private static let writer = LifecycleWriter()
    static func record(_ event: String, code: String? = nil) {
        writer.record(event, code: code, at: Date(), uptime: ProcessInfo.processInfo.systemUptime)
    }
    static func flush() async { await writer.flush() }
}

/// Diagnostics must not put JSON/file I/O in front of the first visible call
/// feedback or an audio callback. The serial queue preserves event order.
private final class LifecycleWriter: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.versa.vvoice.lifecycle", qos: .utility)
    func record(_ event: String, code: String?, at: Date, uptime: TimeInterval) {
        queue.async { self.write(event, code: code, at: at, uptime: uptime) }
    }
    func flush() async {
        await withCheckedContinuation { continuation in queue.async { continuation.resume() } }
    }
    private func write(_ event: String, code: String?, at: Date, uptime: TimeInterval) {
        guard let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let file = directory.appendingPathComponent("VVoiceCallLifecycle.json")
        var rows = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([[String: String]].self, from: $0) } ?? []
        let clock = ISO8601DateFormatter(); clock.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var row = ["event": event, "at": clock.string(from: at), "uptimeMS": String(Int(uptime * 1000))]
        if let code { row["code"] = String(code.prefix(160)) }
        rows.append(row)
        guard let data = try? JSONEncoder().encode(Array(rows.suffix(512))) else { return }
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
