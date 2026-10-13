import SwiftUI
import EvTapCore

@main
struct EvTapApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    private let services = AppServices.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services.preferences)
                .environment(services.session)
                .environment(services.router)
                .environment(services.toast)
                .environment(services.favorites)
                .environment(services.catalog)
                .environment(services.bus)
                .environment(services.realtime)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                services.realtime.resume()
                Task { await services.session.refreshMe() }
            }
        }
    }
}
