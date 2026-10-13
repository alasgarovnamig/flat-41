import Foundation
import Observation
import EvTapCore

enum AppTab: String, CaseIterable, Hashable, Identifiable {
    case home, search, saved, messages, profile
    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .home: return "tabs.home"
        case .search: return "tabs.search"
        case .saved: return "tabs.favorites"
        case .messages: return "tabs.messages"
        case .profile: return "tabs.profile"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house"
        case .search: return "magnifyingglass"
        case .saved: return "heart"
        case .messages: return "bubble.left.and.bubble.right"
        case .profile: return "person"
        }
    }
}

/// Where the payment result screen sends the user next.
struct PaymentContext: Hashable {
    var listingId: String?
    var bookingId: String?
}

/// Pushed destinations (type-safe `navigationDestination(for: Route.self)` in every tab stack).
enum Route: Hashable {
    case listing(id: String)
    case reviews(listingId: String, isOwner: Bool)
    case book(listingId: String)
    case booking(id: String)
    case bookings
    case chat(conversationId: String)
    case myListings
    case listingStats(id: String, title: String)
    case hostCalendar(listingId: String?)
    case wallet
    case payments
    case notifications
    case savedSearches
    case business
    case agency
    case settings
    case editProfile
    case pages
    case page(slug: String)
    case promote(listingId: String, upsell: Bool)
    case listingFee(listingId: String)
    case paymentResult(paymentId: String, status: String?, context: PaymentContext)
}

/// Modal flows presented from the root.
enum SheetRoute: Identifiable {
    case auth
    case newChat(listingId: String, title: String, name: String)

    var id: String {
        switch self {
        case .auth: return "auth"
        case .newChat(let id, _, _): return "chat-\(id)"
        }
    }
}

enum FullScreenRoute: Identifiable {
    case post(editId: String?)
    case gallery(urls: [URL], index: Int)

    var id: String {
        switch self {
        case .post(let id): return "post-\(id ?? "new")"
        case .gallery(let urls, let i): return "gallery-\(urls.count)-\(i)"
        }
    }
}

/// A request for the Search tab (from Home chips, saved searches, deep links).
struct SearchRequest: Equatable {
    let id = UUID()
    var filters: ListingFilters
    var mapMode = false
    var openFilters = false
}

@MainActor
@Observable
final class Router {
    var tab: AppTab = .home
    var paths: [AppTab: [Route]] = [:]
    var sheet: SheetRoute?
    var fullScreen: FullScreenRoute?
    private(set) var searchRequest: SearchRequest?
    @ObservationIgnored private var pendingAuthAction: (@MainActor () -> Void)?

    func path(for tab: AppTab) -> [Route] { paths[tab] ?? [] }

    func setPath(_ path: [Route], for tab: AppTab) { paths[tab] = path }

    /// Push onto the visible tab's stack.
    func push(_ route: Route) {
        // Don't stack the same payment result twice (bank callback + deep link).
        if case .paymentResult(let id, _, _) = route, case .paymentResult(let top, _, _)? = paths[tab]?.last, top == id { return }
        paths[tab, default: []].append(route)
    }

    func pop() {
        guard var p = paths[tab], !p.isEmpty else { return }
        p.removeLast()
        paths[tab] = p
    }

    func popToRoot(_ tab: AppTab? = nil) { paths[tab ?? self.tab] = [] }

    /// Replace the top of the visible stack (e.g. listing fee → payment result).
    func replaceTop(with route: Route) {
        var p = paths[tab] ?? []
        if !p.isEmpty { p.removeLast() }
        p.append(route)
        paths[tab] = p
    }

    func select(_ tab: AppTab) {
        if self.tab == tab { popToRoot(tab) } else { self.tab = tab }
    }

    func openSearch(_ filters: ListingFilters = ListingFilters(), mapMode: Bool = false, openFilters: Bool = false) {
        searchRequest = SearchRequest(filters: filters, mapMode: mapMode, openFilters: openFilters)
        popToRoot(.search)
        tab = .search
    }

    // MARK: Auth gate

    /// Runs `action` now when signed in, otherwise after a successful login.
    func requireAuth(_ action: @escaping @MainActor () -> Void = {}) {
        if AppServices.shared.session.isSignedIn {
            action()
        } else {
            pendingAuthAction = action
            sheet = .auth
        }
    }

    func authCompleted() {
        sheet = nil
        let action = pendingAuthAction
        pendingAuthAction = nil
        if let action {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 350_000_000) // let the sheet dismiss first
                action()
            }
        }
    }

    func authCancelled() { pendingAuthAction = nil }

    func presentPost(editId: String? = nil) {
        requireAuth { [weak self] in self?.fullScreen = .post(editId: editId) }
    }

    // MARK: Deep links

    func open(_ link: DeepLink) {
        sheet = nil
        switch link {
        case .listing(let id):
            push(.listing(id: id))
        case .paymentResult(let id, let status):
            fullScreen = nil
            push(.paymentResult(paymentId: id, status: status, context: PaymentContext()))
        case .booking(let id):
            requireAuth { [weak self] in self?.push(.booking(id: id)) }
        case .conversation(let id):
            requireAuth { [weak self] in
                self?.tab = .messages
                self?.paths[.messages] = [.chat(conversationId: id)]
            }
        case .search(let filters):
            openSearch(filters)
        case .page(let slug):
            push(.page(slug: slug))
        case .notifications:
            requireAuth { [weak self] in self?.push(.notifications) }
        case .wallet:
            requireAuth { [weak self] in self?.push(.wallet) }
        case .myListings:
            requireAuth { [weak self] in self?.push(.myListings) }
        }
    }
}
