import SwiftUI
import EvTapCore

/// Tabs (each with its own NavigationStack) + floating glass tab bar + app-level sheets, toasts and deep links.
struct RootView: View {
    @Environment(Router.self) private var router
    @Environment(Preferences.self) private var preferences
    @Environment(SessionStore.self) private var session
    @Environment(RealtimeHub.self) private var realtime
    @Environment(ToastCenter.self) private var toast
    @Environment(FavoritesStore.self) private var favorites
    @Environment(CatalogStore.self) private var catalog
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            ForEach(AppTab.allCases) { tab in
                TabStack(tab: tab)
                    .tag(tab)
                    .toolbar(.hidden, for: .tabBar)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if router.path(for: router.tab).isEmpty {
                GlassTabBar(selection: Binding(get: { router.tab }, set: { router.select($0) }),
                            badges: [.messages: realtime.unreadMessages, .profile: session.me?.unreadNotifications ?? 0],
                            onPost: { router.presentPost() })
                    .padding(.bottom, EvSpace.s2)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(EvMotion.curve(reduceMotion: reduceMotion), value: router.path(for: router.tab).isEmpty)
        .overlay(alignment: .top) {
            if let t = toast.current {
                ToastView(toast: t)
                    .padding(.top, EvSpace.s2)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { toast.dismiss() }
                    .id(t.id)
            }
        }
        .animation(EvMotion.curve(reduceMotion: reduceMotion), value: toast.current)
        .sheet(item: $router.sheet, onDismiss: { router.authCancelled() }) { sheet in
            switch sheet {
            case .auth:
                AuthFlowView()
            case .newChat(let listingId, let title, let name):
                NewConversationView(listingId: listingId, listingTitle: title, ownerName: name)
            }
        }
        .fullScreenCover(item: $router.fullScreen) { route in
            switch route {
            case .post(let editId):
                PostWizardView(editId: editId)
            case .gallery(let urls, let index):
                GalleryView(urls: urls, startIndex: index)
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: favorites.feedbackTick)
        .onOpenURL { url in
            if let link = DeepLink.parse(url) { router.open(link) }
        }
        .tint(EvColor.ink)
        .preferredColorScheme(preferences.theme.colorScheme)
        .environment(\.locale, Locale(identifier: preferences.lang.rawValue))
        .id(preferences.lang)
        .task {
            await session.bootstrap()
            await catalog.load()
        }
    }
}

/// One tab: NavigationStack bound to the router path, with every `Route` destination.
struct TabStack: View {
    let tab: AppTab
    @Environment(Router.self) private var router

    var body: some View {
        NavigationStack(path: Binding(get: { router.path(for: tab) }, set: { router.setPath($0, for: tab) })) {
            root
                .navigationDestination(for: Route.self) { route in
                    destination(route)
                }
        }
    }

    @ViewBuilder private var root: some View {
        switch tab {
        case .home: HomeView()
        case .search: SearchView()
        case .saved: FavoritesView()
        case .messages: ConversationsView()
        case .profile: ProfileView()
        }
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .listing(let id): ListingDetailView(listingId: id)
        case .reviews(let id, let isOwner): ReviewsView(listingId: id, isOwner: isOwner)
        case .book(let id): BookingFlowView(listingId: id)
        case .booking(let id): BookingDetailView(bookingId: id)
        case .bookings: BookingsView()
        case .chat(let id): ChatThreadView(conversationId: id)
        case .myListings: MyListingsView()
        case .listingStats(let id, let title): ListingStatsView(listingId: id, title: title)
        case .hostCalendar(let id): HostCalendarView(listingId: id)
        case .wallet: WalletView()
        case .payments: PaymentsHistoryView()
        case .notifications: NotificationsView()
        case .savedSearches: SavedSearchesView()
        case .business: BusinessPlansView()
        case .agency: AgencyProfileView()
        case .settings: SettingsView()
        case .editProfile: EditProfileView()
        case .pages: PagesListView()
        case .page(let slug): CmsPageView(slug: slug)
        case .promote(let id, let upsell): PromoteView(listingId: id, upsell: upsell)
        case .listingFee(let id): ListingFeeView(listingId: id)
        case .paymentResult(let id, let status, let context): PaymentResultView(paymentId: id, statusHint: status, context: context)
        }
    }
}

/// Screens that need a session show a login prompt for guests.
struct RequireAuth<Content: View>: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @ViewBuilder var content: () -> Content

    var body: some View {
        switch session.status {
        case .loading:
            LoadingView()
        case .guest:
            EmptyState(icon: "person.crop.circle", title: L("auth.promptTitle"), message: L("auth.promptBody"),
                       actionTitle: L("common.login")) { router.requireAuth() }
                .frame(maxHeight: .infinity)
                .appBackground()
        case .signedIn:
            content()
        }
    }
}

extension View {
    /// Standard screen chrome: canvas background, inline title.
    func evScreen(_ title: String) -> some View {
        appBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
    }
}
