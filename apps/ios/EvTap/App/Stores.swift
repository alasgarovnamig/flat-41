import Foundation
import Observation
import SwiftUI
import EvTapCore

// MARK: - Preferences

enum ThemePreference: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// Language + appearance, persisted in UserDefaults.
@MainActor
@Observable
final class Preferences {
    private static let langKey = "evtap.lang"
    private static let themeKey = "evtap.theme"

    var lang: Lang {
        didSet {
            UserDefaults.standard.set(lang.rawValue, forKey: Self.langKey)
            Localizer.shared.setLanguage(lang)
        }
    }

    var theme: ThemePreference {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: Self.themeKey) }
    }

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.langKey).flatMap(Lang.init(rawValue:))
        lang = saved ?? Lang.best(for: Locale.preferredLanguages)
        theme = UserDefaults.standard.string(forKey: Self.themeKey).flatMap(ThemePreference.init(rawValue:)) ?? .system
    }
}

// MARK: - Session

@MainActor
@Observable
final class SessionStore {
    enum Status { case loading, guest, signedIn }

    private(set) var status: Status = .loading
    private(set) var me: Me?
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let tokens: TokenManager
    /// Realtime / favorites / push started for the current session.
    @ObservationIgnored private var sessionServicesStarted = false

    var isSignedIn: Bool { status == .signedIn }

    init(api: APIClient, tokens: TokenManager) {
        self.api = api
        self.tokens = tokens
    }

    /// App launch: restore the Keychain session and load `/auth/me`.
    func bootstrap() async {
        guard await tokens.isSignedIn else {
            status = .guest
            return
        }
        tokensChanged(signedIn: true)
        await refreshMe()
    }

    func signIn(_ response: AuthResponse) async {
        await tokens.set(response.tokens)
        status = .signedIn
        await refreshMe()
        // Keep the server-side locale (push / SMS language) in sync with the app.
        let lang = AppServices.shared.preferences.lang
        if response.user.locale != lang {
            _ = try? await api.send(API.updateMe(UpdateMeInput(locale: lang)))
        }
        AppServices.shared.toast.show(L("auth.welcome", ["name": response.user.name]), kind: .success)
    }

    func refreshMe() async {
        guard status == .signedIn else { return }
        do {
            me = try await api.send(API.me())
        } catch let e as APIError where e.isUnauthorized {
            await tokens.set(nil)
        } catch {
            // offline: keep the cached `me`
        }
    }

    func logout() async {
        let refresh = await tokens.current?.refreshToken
        await AppServices.shared.push.unregister()
        if let refresh { _ = try? await api.send(API.logout(refreshToken: refresh)) }
        await tokens.set(nil)
    }

    /// Token observer (sign-in, refresh, forced logout).
    func tokensChanged(signedIn: Bool) {
        if signedIn {
            if status != .signedIn { status = .signedIn }
            // Token rotation also lands here — start the per-session services only once.
            guard !sessionServicesStarted else { return }
            sessionServicesStarted = true
            AppServices.shared.realtime.start()
            Task { await AppServices.shared.favorites.load() }
            Task { await AppServices.shared.push.registerIfAuthorized() }
        } else {
            sessionServicesStarted = false
            status = .guest
            me = nil
            AppServices.shared.realtime.stop()
            AppServices.shared.favorites.reset()
        }
    }

    /// Optimistic local update after PATCH /users/me.
    func replaceMe(_ me: Me?) { self.me = me }
}

// MARK: - Toasts

@MainActor
@Observable
final class ToastCenter {
    enum Kind { case info, success, error }

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let kind: Kind
    }

    private(set) var current: Toast?
    @ObservationIgnored private var hideTask: Task<Void, Never>?

    func show(_ text: String, kind: Kind = .info) {
        guard !text.isEmpty else { return }
        current = Toast(text: text, kind: kind)
        hideTask?.cancel()
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_800_000_000)
            guard !Task.isCancelled else { return }
            self?.current = nil
        }
    }

    func error(_ error: Error) {
        let text = L(error: error)
        if !text.isEmpty { show(text, kind: .error) }
    }

    func dismiss() { current = nil }
}

// MARK: - Favorites

@MainActor
@Observable
final class FavoritesStore {
    private(set) var ids: Set<String> = []
    private(set) var loaded = false
    /// Incremented on every toggle — drives `.sensoryFeedback`.
    private(set) var feedbackTick = 0
    @ObservationIgnored private let api: APIClient

    init(api: APIClient) { self.api = api }

    func load() async {
        guard let list = try? await api.send(API.favoriteIds()) else { return }
        ids = Set(list)
        loaded = true
    }

    func reset() {
        ids = []
        loaded = false
    }

    func isFavorite(_ id: String, fallback: Bool = false) -> Bool { loaded ? ids.contains(id) : (ids.contains(id) || fallback) }

    /// Optimistic toggle; asks to log in first when needed.
    func toggle(_ id: String) {
        let services = AppServices.shared
        services.router.requireAuth { [weak self] in
            guard let self else { return }
            let adding = !self.ids.contains(id)
            if adding { self.ids.insert(id) } else { self.ids.remove(id) }
            self.feedbackTick += 1
            Task {
                do {
                    _ = try await self.api.send(adding ? API.addFavorite(id) : API.removeFavorite(id))
                    services.bus.bump(.favorites)
                    if adding { services.toast.show(L("favorites.added"), kind: .success) }
                } catch {
                    if adding { self.ids.remove(id) } else { self.ids.insert(id) }
                    services.toast.error(error)
                }
            }
        }
    }
}

// MARK: - Catalog

@MainActor
@Observable
final class CatalogStore {
    private(set) var catalog: Catalog = .fallback
    @ObservationIgnored private var loadedAt: Date?
    @ObservationIgnored private let api: APIClient

    init(api: APIClient) { self.api = api }

    var settings: CatalogSettings { catalog.settings }

    /// `GET /catalog` (prices from the DB), cached for 10 minutes; shared defaults until it answers.
    func load(force: Bool = false) async {
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 600 { return }
        let fetched = try? await api.send(API.catalog())
        if let c = fetched {
            catalog = c
            loadedAt = Date()
        }
    }
}

// MARK: - Refresh bus

/// Cross-screen invalidation: screens `.task(id: bus.version(.wallet))` and reload when another screen bumps it.
@MainActor
@Observable
final class RefreshBus {
    enum Topic: Hashable, CaseIterable {
        case me, wallet, payments, myListings, bookings, conversations, notifications, favorites, savedSearches, subscription, listing
    }

    private var versions: [Topic: Int] = [:]

    func version(_ topic: Topic) -> Int { versions[topic] ?? 0 }

    func bump(_ topics: Topic...) {
        for t in topics { versions[t, default: 0] += 1 }
        if topics.contains(.me) { Task { await AppServices.shared.session.refreshMe() } }
    }

    /// Everything money-related after a payment reached a final state.
    func paymentFinished() {
        bump(.me, .wallet, .payments, .myListings, .bookings, .subscription, .listing)
    }
}
