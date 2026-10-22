import UIKit

/// Public UIKit icon selection refreshes the system registration without uninstalling.
/// Never activate it from a background intent or while a call is active.
@MainActor enum AppIconBranding {
    static let portraitName = "VVoiceSystemPortrait"
    private static var task: Task<Void, Never>?
    private static var lastAttempt = Date.distantPast

    static func refreshWhenIdle(allowed: Bool) {
        let app = UIApplication.shared
        guard allowed, app.applicationState == .active, app.supportsAlternateIcons,
              app.alternateIconName != portraitName, task == nil,
              Date().timeIntervalSince(lastAttempt) > 60 else { return }
        lastAttempt = Date()
        task = Task {
            defer { task = nil }
            guard app.applicationState == .active else { return }
            CallDiagnostics.record("icon.activation.requested", code: portraitName)
            do {
                try await app.setAlternateIconName(portraitName)
                CallDiagnostics.record("icon.activation.confirmed", code: app.alternateIconName)
            } catch {
                CallDiagnostics.record("icon.activation.failed", code: (error as NSError).domain)
            }
        }
    }
}
