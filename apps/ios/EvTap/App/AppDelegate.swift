import UIKit
import UserNotifications
import EvTapCore

/// UIKit hooks SwiftUI does not expose: APNs registration callbacks and notification taps.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Bigger shared cache for listing photos loaded through AsyncImage / URLSession.
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 256 * 1024 * 1024)
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await AppServices.shared.push.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Simulator / missing entitlement — nothing to do.
    }

    // MARK: UNUserNotificationCenterDelegate

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let data = Self.payload(response.notification.request.content.userInfo)
        await MainActor.run {
            AppServices.shared.push.handleTap(data: data)
        }
    }

    /// APNs userInfo → JSON-ish dictionary (string / number / bool values; the `aps` dictionary is skipped).
    nonisolated static func payload(_ userInfo: [AnyHashable: Any]) -> [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        // Expo-style payloads nest custom data under "body"/"data"; flatten them too.
        var sources: [[AnyHashable: Any]] = [userInfo]
        if let nested = userInfo["data"] as? [AnyHashable: Any] { sources.append(nested) }
        if let nested = userInfo["body"] as? [AnyHashable: Any] { sources.append(nested) }
        for source in sources {
            for (k, v) in source {
                guard let key = k as? String, key != "aps" else { continue }
                if let s = v as? String { out[key] = .string(s) }
                else if let b = v as? Bool { out[key] = .bool(b) }
                else if let n = v as? Double { out[key] = .number(n) }
                else if let i = v as? Int { out[key] = .number(Double(i)) }
            }
        }
        return out
    }
}
