import SwiftUI
import EvTapCore

@MainActor
@Observable
final class MyListingsViewModel {
    static let tabs: [ListingStatus] = [.ACTIVE, .PENDING, .DRAFT, .REJECTED, .EXPIRED, .ARCHIVED]

    var status: ListingStatus = .ACTIVE
    private(set) var lists: [ListingStatus: PagedList<MyListing>] = [:]
    private(set) var working: String?

    func list(for status: ListingStatus) -> PagedList<MyListing> {
        if let l = lists[status] { return l }
        let l = PagedList<MyListing> { page in
            try await AppServices.shared.api.send(API.myListings(status: status, page: page))
        }
        lists[status] = l
        return l
    }

    var current: PagedList<MyListing> { list(for: status) }

    /// Overview of the loaded tab: totals for the StatCards.
    struct Totals {
        var views = 0
        var phoneViews = 0
        var favorites = 0
    }

    var totals: Totals {
        var t = Totals()
        for l in current.items {
            t.views += l.views
            t.phoneViews += l.phoneViews
            t.favorites += l.favoritesCount
        }
        return t
    }

    func action(_ listing: MyListing, _ action: ListingAction) async {
        working = listing.id
        defer { working = nil }
        do {
            _ = try await AppServices.shared.api.send(API.listingAction(listing.id, action))
            AppServices.shared.toast.show(L("myListings.done"), kind: .success)
            AppServices.shared.bus.bump(.myListings, .me, .listing)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func applyCredit(_ listing: MyListing, _ credit: CreditKind) async {
        working = listing.id
        defer { working = nil }
        do {
            _ = try await AppServices.shared.api.send(API.applyCredit(listing.id, credit))
            AppServices.shared.toast.show(L("promote.creditApplied"), kind: .success)
            AppServices.shared.bus.bump(.myListings, .me)
        } catch {
            AppServices.shared.toast.error(error)
        }
    }

    func refreshAll() async {
        for l in lists.values where !l.isEmpty || l.error != nil { await l.refresh() }
        if current.isEmpty { await current.refresh() }
    }
}

/// My listings: status pill tabs, overview StatCards, listing cards with stats and actions.
struct MyListingsView: View {
    @State private var vm = MyListingsViewModel()
    @State private var menuFor: MyListing? = nil
    @State private var creditFor: MyListing? = nil
    @State private var confirm: (MyListing, ListingAction)? = nil
    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(RefreshBus.self) private var bus

    var body: some View {
        RequireAuth {
            ScrollView {
                VStack(alignment: .leading, spacing: EvSpace.s4) {
                    PillTabs(items: MyListingsViewModel.tabs, selection: $vm.status, title: { L("myListings.tabs.\($0.rawValue)") })
                        .padding(.horizontal, -EvSize.gutter)
                    overview
                    listContent
                }
                .padding(.horizontal, EvSize.gutter)
                .padding(.vertical, EvSpace.s3)
            }
            .refreshable { await vm.current.refresh() }
        }
        .evScreen(L("myListings.title"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                IconButton(systemName: "plus", label: L("myListings.newListing"), style: .ink, size: 36) { router.presentPost() }
            }
        }
        .task(id: "\(vm.status.rawValue)-\(bus.version(.myListings))") { await vm.current.refresh() }
        .confirmationDialog(L("myListings.actions"), isPresented: Binding(get: { menuFor != nil }, set: { if !$0 { menuFor = nil } }),
                            titleVisibility: .visible, presenting: menuFor) { l in
            actionButtons(l)
        }
        .confirmationDialog(L("promote.credits"), isPresented: Binding(get: { creditFor != nil }, set: { if !$0 { creditFor = nil } }),
                            titleVisibility: .visible, presenting: creditFor) { l in
            ForEach(session.me?.activeSubscription?.usage.availableCredits ?? []) { c in
                Button("\(LE("credit", c.kind.rawValue)) · \(L("promote.creditsLeft", ["n": c.count]))") {
                    Task { await vm.applyCredit(l, c.kind) }
                }
            }
        }
        .alert(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })) {
            Button(L("common.cancel"), role: .cancel) {}
            Button(L("common.yes"), role: .destructive) {
                if let c = confirm { Task { await vm.action(c.0, c.1) } }
            }
        }
    }

    private var confirmTitle: String {
        switch confirm?.1 {
        case .ARCHIVE?: return L("myListings.confirmArchive")
        case .MARK_SOLD?: return L("myListings.confirmSold")
        default: return L("common.confirm")
        }
    }

    @ViewBuilder private var overview: some View {
        let list = vm.current
        if vm.status == .ACTIVE && !list.isEmpty {
            let t = vm.totals
            HStack(spacing: EvSpace.s3) {
                StatCard(label: L("myListings.views"), value: Format.grouped(t.views), caption: L("myListings.statsTitle"),
                         spark: list.items.map { Double($0.views) })
                StatCard(label: L("myListings.phoneViews"), value: Format.grouped(t.phoneViews), caption: L("myListings.favoritesN", ["n": t.favorites]),
                         spark: list.items.map { Double($0.phoneViews) })
            }
            if let quota = session.me?.quota, !quota.isUnlimited {
                SplitMeter(left: .init(label: L("myListings.quotaUsed"), value: "\(quota.used)", amount: Double(quota.used)),
                           right: .init(label: L("myListings.quotaLeft"), value: "\(max(0, quota.remaining))", amount: 0),
                           capacity: Double(max(quota.freeLimit, quota.used)))
                    .evCard()
            }
        }
    }

    @ViewBuilder private var listContent: some View {
        let list = vm.current
        if list.isInitialLoading {
            ForEach(0..<2, id: \.self) { _ in Skeleton(height: 170, radius: EvRadius.xl) }
        } else if let e = list.error, list.isEmpty {
            ErrorStateView(error: e) { Task { await list.refresh() } }
        } else if list.isEmpty {
            EmptyState(icon: "square.stack", title: L("myListings.empty"), actionTitle: L("myListings.newListing")) { router.presentPost() }
        } else {
            LazyVStack(spacing: EvSpace.s3) {
                ForEach(list.items) { l in
                    MyListingCard(listing: l, working: vm.working == l.id) { menuFor = l }
                        .onAppear { Task { await list.loadMoreIfNeeded(l) } }
                }
            }
        }
    }

    @ViewBuilder private func actionButtons(_ l: MyListing) -> some View {
        let credits = session.me?.activeSubscription?.usage.availableCredits ?? []
        Button(L("myListings.view")) { router.push(.listing(id: l.id)) }
        Button(L("myListings.stats")) { router.push(.listingStats(id: l.id, title: l.title)) }
        if l.dealType == .RENT_DAILY { Button(L("myListings.calendar")) { router.push(.hostCalendar(listingId: l.id)) } }
        if l.requiresPayment { Button(L("myListings.payFee")) { router.push(.listingFee(listingId: l.id)) } }
        if l.status == .ACTIVE && !credits.isEmpty { Button(L("myListings.applyCredit")) { creditFor = l } }
        if l.status == .ACTIVE || l.status == .EXPIRED { Button(L("myListings.renew")) { Task { await vm.action(l, .RENEW) } } }
        if [.ARCHIVED, .SOLD, .EXPIRED].contains(l.status) { Button(L("myListings.restore")) { Task { await vm.action(l, .RESTORE) } } }
        if l.status == .ACTIVE { Button(L("myListings.markSold")) { confirm = (l, .MARK_SOLD) } }
        if l.status != .ARCHIVED && l.status != .SOLD { Button(L("myListings.archive"), role: .destructive) { confirm = (l, .ARCHIVE) } }
        Button(L("common.cancel"), role: .cancel) {}
    }
}

/// Owner card: thumbnail, status, price, title, expiry; views / calls / saved; promote / edit / ⋯ actions.
private struct MyListingCard: View {
    let listing: MyListing
    let working: Bool
    let onMenu: () -> Void
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                router.push(.listing(id: listing.id))
            } label: {
                HStack(alignment: .top, spacing: EvSpace.s3) {
                    RemoteImage(url: AppServices.shared.api.mediaURL(listing.coverUrl), placeholderIcon: "photo")
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 4) {
                            StatusPill(text: LE("listingStatus", listing.status.rawValue), tone: listing.status.tone)
                            ListingBadges(card: listing.card)
                        }
                        MoneyText(listingPrice: listing.price, currency: listing.currency, period: listing.pricePeriod, style: EvType.bodyStrong)
                        Text(listing.title).font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.ink).lineLimit(2)
                        if let exp = listing.expiresAt, listing.status == .ACTIVE {
                            Text(L("myListings.expires", ["date": DateText.day(exp)])).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(EvSpace.s3)
            }
            .buttonStyle(EvPressStyle())

            HStack {
                stat("eye", listing.views, L("myListings.views"))
                stat("phone", listing.phoneViews, L("myListings.phoneViews"))
                stat("heart", listing.favoritesCount, L("myListings.favorites"))
            }
            .padding(.vertical, EvSpace.s2)
            .overlay(alignment: .top) { Rectangle().fill(EvColor.hairline).frame(height: 1) }

            if let reason = listing.rejectionReason, listing.status == .REJECTED {
                NoticeBanner(text: L("myListings.rejected", ["reason": reason]), tone: .danger, icon: "xmark.octagon").padding(.horizontal, EvSpace.s3)
            }
            if listing.requiresPayment {
                NoticeBanner(text: L("myListings.waitingPayment"), tone: .warning, icon: "creditcard").padding(.horizontal, EvSpace.s3)
            }

            HStack(spacing: EvSpace.s2) {
                if listing.requiresPayment {
                    PrimaryButton(title: L("myListings.payFee"), icon: "creditcard", size: .small) { router.push(.listingFee(listingId: listing.id)) }
                } else if listing.status == .ACTIVE || listing.status == .PENDING {
                    PrimaryButton(title: L("post.promoteNow"), icon: "arrow.up.right", size: .small) {
                        router.push(.promote(listingId: listing.id, upsell: false))
                    }
                }
                PrimaryButton(title: L("common.edit"), icon: "pencil", kind: .secondary, size: .small) {
                    router.fullScreen = .post(editId: listing.id)
                }
                if working {
                    ProgressView().tint(EvColor.ink).frame(width: 44, height: 44)
                } else {
                    IconButton(systemName: "ellipsis", label: L("myListings.actions"), style: .sunken, action: onMenu)
                }
            }
            .padding(EvSpace.s3)
        }
        .background(CardSurface(radius: EvRadius.xl, fill: listing.isHighlighted ? EvColor.highlightBg : EvColor.surface))
    }

    private func stat(_ icon: String, _ value: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(EvColor.muted)
                Text("\(value)").font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
            }
            Text(label).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(value)")
    }
}

/// Per-listing statistics: StatCards with barcode sparks + weekly PillBarChart (+delta vs previous week).
struct ListingStatsView: View {
    let listingId: String
    let title: String
    @State private var state: Loadable<ListingStats> = .idle

    var body: some View {
        Group {
            switch state {
            case .loaded(let s): content(s)
            case .failed(let e): ErrorStateView(error: e) { Task { await load() } }
            default: LoadingView()
            }
        }
        .evScreen(L("myListings.stats"))
        .task { await load() }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await AppServices.shared.api.send(API.listingStats(listingId))) } catch { state = .failed(error) }
    }

    private func content(_ s: ListingStats) -> some View {
        let daily = Array(s.daily.suffix(30))
        return ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s4) {
                Text(title).evText(EvType.h3).foregroundStyle(EvColor.ink).lineLimit(2)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: EvSpace.s3), GridItem(.flexible(), spacing: EvSpace.s3)], spacing: EvSpace.s3) {
                    StatCard(label: L("myListings.views"), value: Format.grouped(s.views), caption: L("myListings.statsTitle"), spark: daily.map { Double($0.views) })
                    StatCard(label: L("myListings.phoneViews"), value: Format.grouped(s.phoneViews), caption: L("myListings.statsTitle"), spark: daily.map { Double($0.phoneViews) })
                    StatCard(label: L("myListings.favorites"), value: Format.grouped(s.favorites))
                    StatCard(label: L("myListings.messages"), value: Format.grouped(s.messages))
                }
                Card(title: L("myListings.weekly")) {
                    PillBarChart(rows: weeklyRows(daily))
                }
            }
            .padding(EvSize.gutter)
        }
    }

    /// Last four weeks of views; the tag shows the change vs the previous week.
    private func weeklyRows(_ daily: [ListingStats.Day]) -> [PillBarChart.Row] {
        let weeks: [[ListingStats.Day]] = stride(from: 0, to: daily.count, by: 7).map { Array(daily[$0..<min($0 + 7, daily.count)]) }
        let sums = weeks.map { $0.reduce(0) { $0 + $1.views } }
        return sums.indices.suffix(4).map { i in
            let prev = i > 0 ? sums[i - 1] : 0
            let tag: String? = prev > 0 ? "\(sums[i] >= prev ? "+" : "")\(Int((Double(sums[i] - prev) / Double(prev) * 100).rounded()))%" : nil
            let start = weeks[i].first.map { DateText.isoDayShort($0.date) } ?? ""
            return PillBarChart.Row(label: "\(start) · \(sums[i])", value: Double(sums[i]), tag: tag)
        }
    }
}
