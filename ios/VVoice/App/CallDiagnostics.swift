import Foundation

/// Bounded local lifecycle evidence only: no entry, cookies, audio, transcripts,
/// contacts, URLs, or server response bodies.
@MainActor enum CallDiagnostics {
    static func record(_ event: String, code: String? = nil) {
        guard let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let file = directory.appendingPathComponent("VVoiceCallLifecycle.json")
        var rows = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([[String: String]].self, from: $0) } ?? []
        var row = ["event": event, "at": ISO8601DateFormatter().string(from: Date())]
        if let code { row["code"] = String(code.prefix(160)) }
        rows.append(row)
        guard let data = try? JSONEncoder().encode(Array(rows.suffix(80))) else { return }
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
