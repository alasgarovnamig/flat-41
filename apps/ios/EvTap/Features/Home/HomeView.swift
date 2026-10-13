import SwiftUI
import EvTapCore

/// Home: header, search pill + filters, deal chips, MOBILE_HOME banners, stat strip (SplitMeter),
/// Premium carousel, VIP list, daily-rent promo, popular cities, latest listings.
struct HomeView: View {
    @State private var vm = HomeViewModel()
    @State private var query = ""
    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(\.openURL) private var openURL

    private var locations: Locations { AppServices.shared.locations }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: EvSpace.s6) {
                header
                VStack(alignment: .leading, spacing: EvSpace.s3) {
                    Text(L("home.headline"))
                        .evText(EvType.h1)
                        .foregroundStyle(EvColor.ink)
                        .accessibilityAddTraits(.isHeader)
                    SearchField(text: $query, placeholder: L("home.searchPlaceholder"), onSubmit: submitSearch,
                                onFilters: { router.openSearch(openFilters: true) })
                }
                .padding(.horizontal, EvSize.gutter)

                dealChips
                if !vm.banners.isEmpty { banners }
                statStrip.padding(.horizontal, EvSize.gutter)
                premiumSection
                vipSection
                dailyPromo.padding(.horizontal, EvSize.gutter)
                citiesSection.padding(.horizontal, EvSize.gutter)
                latestSection
            }
            .padding(.top, EvSpace.s2)
            .padding(.bottom, EvSpace.s8)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await vm.load() }
        .appBackground()
        .toolbar(.hidden, for: .navigationBar)
        .task { if vm.latest.value == nil { await vm.load() } }
    }

    private func submitSearch() {
        var f = ListingFilters()
        f.q = query.trimmingCharacters(in: .whitespaces).isEmpty ? nil : query
        router.openSearch(f)
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: EvSpace.s3) {
            HStack(spacing: 10) {
                Image(systemName: "house.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(EvColor.onInk)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: EvRadius.sm, style: .continuous).fill(EvColor.ink))
                    .accessibilityHidden(true)
                Text("EvTap")
                    .evText(EvType.h2)
                    .foregroundStyle(EvColor.ink)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer()
            IconButton(systemName: "heart", label: L("tabs.favorites")) { router.select(.saved) }
            IconButton(systemName: "bell", label: L("notifications.title"), badge: (session.me?.unreadNotifications ?? 0) > 0) {
                router.requireAuth { router.push(.notifications) }
            }
        }
        .padding(.horizontal, EvSize.gutter)
    }

    private var dealChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: EvSpace.s2) {
                ForEach(DealType.allCases) { deal in
                    FilterPill(title: LE("dealType", deal.rawValue), icon: deal.icon, showsChevron: false) {
                        router.openSearch(ListingFilters(dealType: deal))
                    }
                }
                FilterPill(title: L("search.map"), icon: "map", showsChevron: false) {
                    router.openSearch(mapMode: true)
                }
            }
            .padding(.horizontal, EvSize.gutter)
        }
    }

    private var banners: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: EvSpace.s3) {
                ForEach(vm.banners) { banner in
                    Button {
                        vm.bannerTapped(banner)
                        open(banner.linkUrl)
                    } label: {
                        RemoteImage(url: AppServices.shared.api.mediaURL(banner.imageUrl), placeholderIcon: "photo")
                            .frame(height: 140)
                            .containerRelativeFrame(.horizontal) { w, _ in w - EvSize.gutter * 2 }
                            .clipShape(RoundedRectangle(cornerRadius: EvRadius.xl, style: .continuous))
                    }
                    .buttonStyle(EvPressStyle())
                    .accessibilityLabel(banner.title)
                    .accessibilityAddTraits(.isLink)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .contentMargins(.horizontal, EvSize.gutter, for: .scrollContent)
    }

    private var statStrip: some View {
        let sale = vm.counts[.SALE] ?? 0
        let rent = vm.counts[.RENT_LONG] ?? 0
        let daily = vm.counts[.RENT_DAILY] ?? 0
        return VStack(alignment: .leading, spacing: EvSpace.s3) {
            SplitMeter(
                left: .init(label: L("home.statSale"), value: Format.grouped(sale), amount: Double(sale)),
                right: .init(label: L("home.statRent"), value: Format.grouped(rent), amount: Double(rent)),
                capacity: Double(sale + rent + daily)
            )
            HStack(spacing: 6) {
                Circle().stroke(EvColor.subtle, lineWidth: 1).frame(width: 8, height: 8)
                Text(L("home.statDaily", ["n": Format.grouped(daily)]))
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
            }
        }
        .evCard()
        .redacted(reason: vm.counts.isEmpty ? .placeholder : [])
    }

    @ViewBuilder private var premiumSection: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            SectionHeader(title: L("home.premium"), actionTitle: L("common.seeAll")) { router.openSearch() }
                .padding(.horizontal, EvSize.gutter)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: EvSpace.s3) {
                    switch vm.premium {
                    case .loaded(let items) where !items.isEmpty:
                        ForEach(items) { PropertyCard(card: $0, width: 272) }
                    case .loaded, .failed:
                        postPromo
                    default:
                        PropertyCardSkeleton(width: 272)
                        PropertyCardSkeleton(width: 272)
                    }
                }
                .padding(.vertical, EvSpace.s2)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .contentMargins(.horizontal, EvSize.gutter, for: .scrollContent)
        }
    }

    @ViewBuilder private var vipSection: some View {
        switch vm.vip {
        case .loaded(let items) where !items.isEmpty:
            listSection(title: L("home.vip"), items: items)
        case .loading, .idle:
            VStack(alignment: .leading, spacing: EvSpace.s3) {
                SectionHeader(title: L("home.vip"))
                PropertyCardSkeleton()
            }
            .padding(.horizontal, EvSize.gutter)
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var latestSection: some View {
        switch vm.latest {
        case .loaded(let items):
            listSection(title: L("home.latest"), items: items)
        case .failed(let error):
            ErrorStateView(error: error) { Task { await vm.load() } }
        default:
            VStack(spacing: EvSpace.s3) {
                PropertyCardSkeleton()
                PropertyCardSkeleton()
            }
            .padding(.horizontal, EvSize.gutter)
        }
    }

    private func listSection(title: String, items: [ListingCard]) -> some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            SectionHeader(title: title, actionTitle: L("common.seeAll")) { router.openSearch() }
            LazyVStack(spacing: EvSpace.s4) {
                ForEach(items) { PropertyCard(card: $0) }
            }
        }
        .padding(.horizontal, EvSize.gutter)
    }

    private var postPromo: some View {
        promoCard(icon: "plus", title: L("home.postPromoTitle"), text: L("home.postPromoText"), width: 300) {
            router.presentPost()
        }
    }

    private var dailyPromo: some View {
        promoCard(icon: "sun.max", title: L("home.dailyPromoTitle"), text: L("home.dailyPromoText"), width: nil) {
            router.openSearch(ListingFilters(dealType: .RENT_DAILY))
        }
    }

    private func promoCard(icon: String, title: String, text: String, width: CGFloat?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: EvSpace.s4) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(EvColor.ink)
                    .frame(width: 52, height: 52)
                    .background(Circle().fill(EvColor.accent))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink)
                    Text(text).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(EvColor.onInk)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(EvColor.ink))
                    .accessibilityHidden(true)
            }
            .padding(EvSpace.s4)
            .frame(width: width)
            .background(CardSurface(radius: EvRadius.lg, fill: EvColor.highlightBg))
        }
        .buttonStyle(EvPressStyle())
    }

    private var citiesSection: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            SectionHeader(title: L("home.popularCities"))
            FlowLayout {
                ForEach(locations.popularCities) { city in
                    FilterPill(title: city.name.current, icon: "mappin", onCard: false, showsChevron: false) {
                        router.openSearch(ListingFilters(cityId: city.id))
                    }
                }
            }
        }
    }

    private func open(_ link: String) {
        guard let url = URL(string: link) else { return }
        if let deep = DeepLink.parse(url) {
            router.open(deep)
        } else {
            openURL(url)
        }
    }
}
