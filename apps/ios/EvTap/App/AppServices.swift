import Foundation
import EvTapCore

/// Composition root. View models reach shared services through `AppServices.shared` (all main-actor);
/// views observe the `@Observable` stores through the SwiftUI environment.
@MainActor
final class AppServices {
    static let shared = AppServices()

    let tokens: TokenManager
    let api: APIClient
    let locations: Locations
    let preferences: Preferences
    let session: SessionStore
    let router: Router
    let toast: ToastCenter
    let favorites: FavoritesStore
    let catalog: CatalogStore
    let bus: RefreshBus
    let realtime: RealtimeHub
    let payments: PaymentCoordinator
    let push: PushManager

    private init() {
        let preferences = Preferences()
        Localizer.shared.setLanguage(preferences.lang)

        #if canImport(Security)
        let store: AuthStore = KeychainAuthStore()
        #else
        let store: AuthStore = InMemoryAuthStore()
        #endif
        let tokens = TokenManager(store: store)
        let api = APIClient(origin: AppConfig.apiOrigin, tokens: tokens, language: { Localizer.shared.lang.rawValue })

        self.tokens = tokens
        self.api = api
        self.preferences = preferences
        self.locations = Self.loadLocations()
        self.bus = RefreshBus()
        self.toast = ToastCenter()
        self.router = Router()
        self.catalog = CatalogStore(api: api)
        self.session = SessionStore(api: api, tokens: tokens)
        self.favorites = FavoritesStore(api: api)
        self.realtime = RealtimeHub(api: api, tokens: tokens)
        self.payments = PaymentCoordinator()
        self.push = PushManager(api: api)

        // Every token change (sign-in, refresh, forced logout after a rejected refresh) reaches the session.
        Task { [session] in
            await tokens.addObserver { newTokens in
                let signedIn = newTokens != nil
                Task { @MainActor in session.tokensChanged(signedIn: signedIn) }
            }
        }
    }

    private static func loadLocations() -> Locations {
        guard let url = Bundle.main.url(forResource: "locations", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let locations = try? Locations(json: data) else { return Locations(.empty) }
        return locations
    }
}
