import SwiftUI
import EvTapCore

/// Saved listings (tab). Cards un-favourited in this session disappear immediately.
struct FavoritesView: View {
    @State private var list = PagedList<ListingCard> { page in try await AppServices.shared.api.send(API.favorites(page: page)) }
    @Environment(SessionStore.self) private var session
    @Environment(FavoritesStore.self) private var favorites
    @Environment(Router.self) private var router
    @Environment(RefreshBus.self) private var bus

    private var visible: [ListingCard] {
        favorites.loaded ? list.items.filter { favorites.ids.contains($0.id) } : list.items
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L("favorites.title"))
                .evText(EvType.h1)
                .foregroundStyle(EvColor.ink)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, EvSize.gutter)
                .padding(.vertical, EvSpace.s2)
            if !session.isSignedIn {
                EmptyState(icon: "heart", title: L("favorites.empty"), message: L("profile.guestText"), actionTitle: L("common.login")) {
                    router.requireAuth()
                }
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: EvSpace.s4) {
                        if list.isInitialLoading {
                            PropertyCardSkeleton()
                            PropertyCardSkeleton()
                        } else if let e = list.error, list.isEmpty {
                            ErrorStateView(error: e) { Task { await list.refresh() } }
                        } else if visible.isEmpty {
                            EmptyState(icon: "heart", title: L("favorites.empty"), message: L("favorites.emptyHint"), actionTitle: L("common.search")) {
                                router.openSearch()
                            }
                        } else {
                            ForEach(visible) { card in
                                PropertyCard(card: card)
                                    .onAppear { Task { await list.loadMoreIfNeeded(card) } }
                            }
                        }
                    }
                    .padding(.horizontal, EvSize.gutter)
                    .padding(.bottom, EvSpace.s8)
                }
                .refreshable { await list.refresh() }
            }
        }
        .appBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task(id: "\(session.isSignedIn)-\(bus.version(.favorites))") {
            if session.isSignedIn { await list.refresh() }
        }
    }
}
