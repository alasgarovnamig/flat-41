import UIKit
import UserNotifications
import EvTapCore

/// APNs registration placeholder.
///  - asks for permission (Settings toggle / first sign-in), registers with APNs and sends the hex device token to
///    `POST /users/me/push-tokens { token, platform: "ios" }`; logout / opt-out → `DELETE /users/me/push-tokens/:token`.
///  - NOTE: the backend currently delivers pushes through **Expo** (`apps/api/src/modules/push`, PUSH_PROVIDER=expo),
///    which cannot send to raw APNs tokens. A native APNs provider (token-based .p8 auth, `apns-topic: az.evtap.app`)
///    must be added server-side before pushes reach this app — see apps/ios/README.md.
@MainActor
final class PushManager {
    private static let tokenKey = "evtap.push.token"
    private static let enabledKey = "evtap.push.enabled"
    private let api: APIClient

    init(api: APIClient) { self.api = api }

    /// User preference (Settings toggle), default on.
    var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }

    enum Result { case ok, denied, disabled }

    /// Asks for permission when needed and registers with APNs. Returns `.denied` when the user refused.
    @discardableResult
    func enable() async -> Result {
        isEnabled = true
        guard await Self.requestPermission() else { return .denied }
        UIApplication.shared.registerForRemoteNotifications()
        return .ok
    }

    // UNUserNotificationCenter calls live in nonisolated helpers so no non-Sendable value crosses the main actor.
    private nonisolated static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    }

    private nonisolated static func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func disable() async {
        isEnabled = false
        await unregister()
    }

    /// On sign-in / launch: re-register silently when the user already granted permission.
    func registerIfAuthorized() async {
        guard isEnabled else { return }
        let status = await Self.authorizationStatus()
        switch status {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        case .notDetermined:
            await enable()
        default:
            break
        }
    }

    /// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
    func didRegister(deviceToken: Data) async {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard AppServices.shared.session.isSignedIn, isEnabled else { return }
        do {
            _ = try await api.send(API.registerPushToken(token, platform: .ios))
            UserDefaults.standard.set(token, forKey: Self.tokenKey)
        } catch {
            // Retried on next launch.
        }
    }

    /// Removes this device's token from the API (logout / opt-out).
    func unregister() async {
        guard let token = UserDefaults.standard.string(forKey: Self.tokenKey) else { return }
        _ = try? await api.send(API.deletePushToken(token))
        UserDefaults.standard.removeObject(forKey: Self.tokenKey)
    }

    /// Notification tap → in-app route.
    func handleTap(data: [String: JSONValue]) {
        if let link = DeepLink.from(notificationData: data) {
            AppServices.shared.router.open(link)
        } else {
            AppServices.shared.router.open(.notifications)
        }
    }
}
