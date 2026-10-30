import UIKit
import UserNotifications

enum PushRegistration {
    /// The device's APNs token as hex, once iOS has given one.
    @MainActor static var token: String?

    @MainActor static func requestPermission() {
        Task {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
}

final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor static weak var model: AppModel?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistration.token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Self.model?.pushTokenChanged()
    }

    /// V pushes every note because it cannot tell whether the app is really open;
    /// the chat on screen needs no banner.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void)
    {
        let key = notification.request.content.userInfo["sessionKey"] as? String
        Task { @MainActor in
            completionHandler(Self.model?.selectedSessionID == key ? [] : [.banner, .sound])
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void)
    {
        let key = response.notification.request.content.userInfo["sessionKey"] as? String
        Task { @MainActor in
            if let key { Self.model?.openFromNotification(key) }
            completionHandler()
        }
    }
}
