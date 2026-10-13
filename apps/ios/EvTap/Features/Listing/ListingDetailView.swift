import MapKit
import SwiftUI
import EvTapCore

/// Listing detail: gallery pager (+ fullscreen), facts, description, amenities, map snippet, owner card with
/// phone reveal / WhatsApp / message, favorite, share, report, reviews, mortgage calculator, similar listings.
struct ListingDetailView: View {
    @State private var vm: ListingDetailViewModel
    @State private var page = 0
    @State private var expanded = false
    @State private var showReport = false
    @Environment(Router.self) private var router
    @Environment(FavoritesStore.self) private var favorites
    @Environment(\.openURL) private var openURL

    init(listingId: String) {
        _vm = State(initialValue: ListingDetailViewModel(listingId: listingId))
    }

    private var api: APIClient { AppServices.shared.api }

    var body: some View {
        Group {
            switch vm.state {
            case .loaded(let l):
                content(l)
            case .failed(let error):
                ErrorStateView(error: error) { Task { await vm.load() } }
                    .frame(maxHeight: .infinity)
            default:
                skeleton
            }
        }
        .appBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if let l = vm.listing {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    ShareLink(item: AppConfig.listingWebURL(l.id), subject: Text(l.title),
                              message: Text(L("listing.shareText", ["title": l.title, "price": PriceText.listing(l.price, l.currency, l.pricePeriod), "url": AppConfig.listingWebURL(l.id).absoluteString]))) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 15))
                            .foregroundStyle(EvColor.ink)
                            .frame(width: 36, height: 36)
                            .evGlass(in: Circle())
                    }
                    .accessibilityLabel(L("common.share"))
                    let fav = favorites.isFavorite(l.id, fallback: l.isFavorite)
                    IconButton(systemName: fav ? "heart.fill" : "heart", label: fav ? L("listing.unsave") : L("listing.save"),
                               style: .glass, size: 36, isSelected: fav, tint: fav ? EvColor.danger : nil) {
                        favorites.toggle(l.id)
                    }
                }
            }
        }
        .sheet(isPresented: $showReport) {
            ReportSheet { reason, comment in await vm.report(reason: reason, comment: comment) }
        }
        .task { if vm.listing == nil { await vm.load() } }
        .task(id: AppServices.shared.bus.version(.listing)) { if vm.listing != nil { await vm.load() } }
    }

    // MARK: Content

    private func content(_ l: ListingDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                gallery(l)
                VStack(alignment: .leading, spacing: EvSpace.s5) {
                    if l.status != .ACTIVE { statusNotice(l) }
                    header(l)
                    factsChips(l)
                    detailsCard(l)
                    descriptionCard(l)
                    if !l.amenities.isEmpty { amenities(l) }
                    if let lat = l.lat, let lng = l.lng { mapSnippet(l, lat: lat, lng: lng) }
                    ownerCard(l)
                    if l.dealType == .RENT_DAILY { reviewsSection(l) }
                    if l.dealType == .SALE, l.currency == .AZN, l.propertyType == .APARTMENT || l.propertyType == .HOUSE {
                        MortgageCalculatorView(price: l.price, currency: l.currency, listingId: l.id)
                    }
                    footerMeta(l)
                }
                .padding(.horizontal, EvSize.gutter)
                .padding(.top, EvSpace.s4)
                if !vm.similar.isEmpty { similarSection }
            }
            .padding(.bottom, EvSpace.s6)
        }
        .ignoresSafeArea(edges: .top)
        .refreshable { await vm.load() }
        .safeAreaInset(edge: .bottom, spacing: 0) { actionBar(l) }
    }

    private func gallery(_ l: ListingDetail) -> some View {
        let images = l.orderedImages
        let urls = images.compactMap { api.mediaURL($0.url) }
        return ZStack(alignment: .bottom) {
            if images.isEmpty {
                RemoteImage(url: api.mediaURL(l.coverUrl))
            } else {
                TabView(selection: $page) {
                    ForEach(Array(images.enumerated()), id: \.element.id) { i, img in
                        Button {
                            router.fullScreen = .gallery(urls: urls, index: i)
                        } label: {
                            RemoteImage(url: api.mediaURL(img.url))
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .clipped()
                        }
                        .buttonStyle(.plain)
                        .tag(i)
                        .accessibilityLabel(L("listing.photoN", ["n": i + 1, "total": images.count]))
                        .accessibilityHint(L("listing.openGallery"))
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            // Fade into the canvas + readable nav bar on top.
            VStack {
                LinearGradient(colors: [EvColor.canvas.opacity(0.85), EvColor.canvas.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 110)
                Spacer()
                LinearGradient(colors: [EvColor.canvas.opacity(0), EvColor.canvas], startPoint: .top, endPoint: .bottom)
                    .frame(height: 90)
            }
            .allowsHitTesting(false)
            if images.count > 1 {
                Text("\(page + 1) / \(images.count)")
                    .font(.ev(EvType.caption, weight: .medium))
                    .foregroundStyle(EvColor.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .evGlass(in: Capsule())
                    .padding(.bottom, EvSpace.s4)
                    .accessibilityHidden(true)
            }
        }
        .frame(height: 360)
        .clipped()
    }

    private func statusNotice(_ l: ListingDetail) -> some View {
        var text = l.isOwner ? "\(L("listing.yourListing")) · \(LE("listingStatus", l.status.rawValue))" : L("listing.notActive")
        if let reason = l.rejectionReason { text += "\n" + L("myListings.rejected", ["reason": reason]) }
        return NoticeBanner(text: text, tone: l.status.tone == .danger ? .danger : .warning, icon: "exclamationmark.circle")
    }

    private func header(_ l: ListingDetail) -> some View {
        VStack(alignment: .leading, spacing: EvSpace.s2) {
            ListingBadges(card: l.card, large: true)
            MoneyText(listingPrice: l.price, currency: l.currency, period: l.pricePeriod, style: EvType.display)
            if l.dealType == .SALE, l.area > 0 {
                Text(L("listing.pricePerM2", ["price": Format.price(Format.pricePerM2(l.price, area: l.area), l.currency)]))
                    .font(.ev(EvType.label, weight: .regular))
                    .foregroundStyle(EvColor.muted)
            }
            Text(l.title)
                .evText(EvType.h2)
                .foregroundStyle(EvColor.ink)
                .padding(.top, 4)
            Label {
                Text([l.address, AppServices.shared.locations.label(cityId: l.cityId, districtId: l.districtId, metroId: l.metroId, lang: Localizer.shared.lang)]
                    .compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", "))
            } icon: {
                Image(systemName: "mappin.and.ellipse")
            }
            .font(.ev(EvType.label, weight: .regular))
            .foregroundStyle(EvColor.inkSecondary)
            if l.dealType == .RENT_DAILY, let rating = l.rating {
                HStack(spacing: 6) {
                    StarRating(value: rating)
                    Text("\(String(format: "%.1f", rating)) · \(L("listing.reviewsCount", ["n": l.reviewsCount]))")
                        .font(.ev(EvType.caption))
                        .foregroundStyle(EvColor.muted)
                }
            }
        }
    }

    private func factsChips(_ l: ListingDetail) -> some View {
        FlowLayout {
            ForEach(ListingFacts.chips(l.card), id: \.self) { chip in
                Text(chip)
                    .font(.ev(EvType.label))
                    .foregroundStyle(EvColor.ink)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 36)
                    .background(Capsule().fill(EvColor.surfaceRaised))
            }
            if let p = l.bathrooms {
                Text(L("listing.bathroomsShort", ["n": p]))
                    .font(.ev(EvType.label))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 36)
                    .background(Capsule().fill(EvColor.surfaceRaised))
            }
        }
    }

    private func detailsCard(_ l: ListingDetail) -> some View {
        Card(title: L("listing.details")) {
            VStack(spacing: 0) {
                let rows = vm.factRows(l)
                ForEach(rows.indices, id: \.self) { i in
                    KeyValueRow(key: rows[i].0, value: rows[i].1)
                    if i < rows.count - 1 { Rectangle().fill(EvColor.hairline).frame(height: 1) }
                }
            }
        }
    }

    private func descriptionCard(_ l: ListingDetail) -> some View {
        Card(title: L("listing.description")) {
            VStack(alignment: .leading, spacing: EvSpace.s3) {
                Text(l.description)
                    .font(.ev(EvType.body))
                    .foregroundStyle(EvColor.ink)
                    .lineLimit(expanded ? nil : 6)
                    .lineSpacing(4)
                    .textSelection(.enabled)
                if l.description.count > 280 {
                    Button(expanded ? L("listing.showLess") : L("listing.showMore")) { expanded.toggle() }
                        .font(.ev(EvType.label))
                        .foregroundStyle(EvColor.ink)
                        .underline()
                        .frame(minHeight: EvSize.touch)
                }
                if l.dealType == .RENT_DAILY, let rules = l.houseRules, !rules.isEmpty {
                    FieldLabel(text: L("listing.houseRules"))
                    Text(rules).font(.ev(EvType.body)).foregroundStyle(EvColor.inkSecondary)
                }
            }
        }
    }

    private func amenities(_ l: ListingDetail) -> some View {
        Card(title: L("listing.amenities")) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: EvSpace.s2), GridItem(.flexible(), spacing: EvSpace.s2)], alignment: .leading, spacing: EvSpace.s2) {
                ForEach(l.amenities) { a in
                    HStack(spacing: EvSpace.s2) {
                        Image(systemName: a.icon)
                            .font(.system(size: 14))
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(EvColor.surfaceSunken))
                            .accessibilityHidden(true)
                        Text(LE("amenity", a.rawValue))
                            .font(.ev(EvType.label, weight: .regular))
                            .foregroundStyle(EvColor.ink)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    private func mapSnippet(_ l: ListingDetail, lat: Double, lng: Double) -> some View {
        let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        return Card(title: L("listing.location"), trailing: {
            IconButton(systemName: "arrow.up.right", label: L("listing.openInMaps"), style: .raised, size: 36) { openMaps(l, lat: lat, lng: lng) }
        }) {
            Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01))),
                interactionModes: []) {
                Annotation("", coordinate: coordinate) {
                    Image(systemName: "house.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(EvColor.onInk)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(EvColor.ink))
                        .overlay(Circle().stroke(EvColor.surfaceRaised, lineWidth: 2))
                }
                .annotationTitles(.hidden)
            }
            .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll, showsTraffic: false))
            .frame(height: 180)
            .clipShape(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous))
            .onTapGesture { openMaps(l, lat: lat, lng: lng) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L("listing.location"))
            .accessibilityHint(L("listing.openInMaps"))
            .accessibilityAddTraits(.isButton)
        }
    }

    private func ownerCard(_ l: ListingDetail) -> some View {
        let displayName = l.agency?.name ?? l.contactName
        return Card(title: L("listing.owner")) {
            VStack(alignment: .leading, spacing: EvSpace.s4) {
                HStack(spacing: EvSpace.s3) {
                    Avatar(url: api.mediaURL(l.agency?.logoUrl ?? l.owner.avatarUrl), name: displayName, size: 52)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(displayName).font(.ev(EvType.bodyStrong)).foregroundStyle(EvColor.ink).lineLimit(1)
                            if l.agency?.verified == true {
                                Image(systemName: "checkmark.seal.fill").foregroundStyle(EvColor.success)
                                    .accessibilityLabel(L("badge.verified"))
                            }
                        }
                        if l.agency != nil { Text(l.contactName).font(.ev(EvType.caption)).foregroundStyle(EvColor.inkSecondary) }
                        Text("\((l.isBusiness || l.agency != nil) ? L("badge.business") : L("badge.owner")) · \(L("listing.activeListings", ["n": l.owner.activeListings]))")
                            .font(.ev(EvType.caption))
                            .foregroundStyle(EvColor.muted)
                        Text(L("listing.memberSince", ["date": DateText.day(l.owner.memberSince)]))
                            .font(.ev(EvType.caption))
                            .foregroundStyle(EvColor.muted)
                    }
                    Spacer(minLength: 0)
                    if let r = l.owner.rating {
                        VStack(spacing: 2) {
                            Image(systemName: "star.fill").foregroundStyle(EvColor.star)
                            Text(String(format: "%.1f", r)).font(.ev(EvType.label))
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if !l.isOwner {
                    Button {
                        Task {
                            if vm.phone != nil { await call() } else { _ = await vm.revealPhone() }
                        }
                    } label: {
                        HStack(spacing: EvSpace.s2) {
                            Image(systemName: "phone").accessibilityHidden(true)
                            Text(vm.phone.map(Format.phone) ?? l.contactPhoneMasked)
                                .font(.ev(EvType.bodyStrong))
                                .monospacedDigit()
                            Spacer()
                            if vm.revealing {
                                ProgressView().tint(EvColor.ink)
                            } else if vm.phone == nil {
                                Text(L("listing.showPhone")).font(.ev(EvType.label)).underline()
                            }
                        }
                        .foregroundStyle(EvColor.ink)
                        .padding(.horizontal, EvSpace.s4)
                        .frame(minHeight: 52)
                        .background(Capsule(style: .continuous).fill(EvColor.surfaceRaised))
                    }
                    .buttonStyle(EvPressStyle())
                }
            }
        }
    }

    private func reviewsSection(_ l: ListingDetail) -> some View {
        Card(title: "\(L("listing.reviews")) (\(l.reviewsCount))", trailing: {
            if l.reviewsCount > 0 {
                IconButton(systemName: "arrow.up.right", label: L("common.seeAll"), style: .raised, size: 36) {
                    router.push(.reviews(listingId: l.id, isOwner: l.isOwner))
                }
            }
        }) {
            if vm.reviews.isEmpty {
                Text(vm.reviewsLoading ? L("common.loading") : L("listing.noReviews"))
                    .font(.ev(EvType.body))
                    .foregroundStyle(EvColor.muted)
            } else {
                VStack(spacing: EvSpace.s3) {
                    ForEach(vm.reviews) { r in
                        ReviewRow(review: r, canReply: l.isOwner) { Task { await vm.loadReviews() } }
                    }
                }
            }
        }
    }

    private func footerMeta(_ l: ListingDetail) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(L("listing.id", ["id": String(l.id.prefix(8)).uppercased()])) · \(L("common.views")): \(l.views)")
                Text(L("listing.updated", ["date": DateText.day(l.updatedAt)]))
            }
            .font(.ev(EvType.caption))
            .foregroundStyle(EvColor.muted)
            Spacer()
            if !l.isOwner {
                Button {
                    showReport = true
                } label: {
                    Label(L("listing.report"), systemImage: "flag")
                        .font(.ev(EvType.label))
                        .foregroundStyle(EvColor.inkSecondary)
                        .frame(minHeight: EvSize.touch)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var similarSection: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            SectionHeader(title: L("listing.similar")).padding(.horizontal, EvSize.gutter)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: EvSpace.s3) {
                    ForEach(vm.similar) { PropertyCard(card: $0, width: 260) }
                }
                .padding(.vertical, EvSpace.s2)
            }
            .contentMargins(.horizontal, EvSize.gutter, for: .scrollContent)
        }
        .padding(.top, EvSpace.s6)
    }

    // MARK: Action bar

    private func actionBar(_ l: ListingDetail) -> some View {
        HStack(spacing: EvSpace.s2) {
            if l.isOwner {
                PrimaryButton(title: L("listing.manage"), icon: "slider.horizontal.3", kind: .secondary) { router.push(.myListings) }
                PrimaryButton(title: L("post.promoteNow"), icon: "arrow.up.right") { router.push(.promote(listingId: l.id, upsell: false)) }
            } else if l.dealType == .RENT_DAILY {
                VStack(alignment: .leading, spacing: 0) {
                    MoneyText(listingPrice: l.price, currency: l.currency, period: l.pricePeriod, style: EvType.h3)
                    if let n = l.minNights, n > 1 {
                        Text(L("booking.minNights", ["n": n])).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                    }
                }
                Spacer(minLength: 0)
                IconButton(systemName: "bubble.left", label: L("listing.message"), style: .sunken) { message(l) }
                PrimaryButton(title: L("listing.book"), fullWidth: false) {
                    router.requireAuth { router.push(.book(listingId: l.id)) }
                }
            } else {
                PrimaryButton(title: L("listing.call"), icon: "phone", isLoading: vm.revealing) { Task { await call() } }
                IconButton(systemName: "message", label: L("listing.whatsapp"), style: .sunken) { Task { await whatsapp() } }
                PrimaryButton(title: L("listing.message"), icon: "bubble.left", kind: .secondary) { message(l) }
            }
        }
        .padding(.horizontal, EvSize.gutter)
        .padding(.vertical, EvSpace.s3)
        .evGlass(in: Rectangle())
    }

    // MARK: Actions

    private func call() async {
        guard let phone = await vm.revealPhone(), let url = URL(string: "tel:\(phone)") else { return }
        openURL(url)
    }

    private func whatsapp() async {
        guard let phone = await vm.revealPhone(), let l = vm.listing else { return }
        let digits = phone.filter(\.isNumber)
        let text = L("listing.whatsappText", ["url": AppConfig.listingWebURL(l.id).absoluteString])
        var comps = URLComponents(string: "https://wa.me/\(digits)")
        comps?.queryItems = [URLQueryItem(name: "text", value: text)]
        if let url = comps?.url { openURL(url) }
    }

    private func message(_ l: ListingDetail) {
        router.requireAuth {
            router.sheet = .newChat(listingId: l.id, title: l.title, name: l.agency?.name ?? l.contactName)
        }
    }

    private func openMaps(_ l: ListingDetail, lat: Double, lng: Double) {
        var comps = URLComponents(string: "https://maps.apple.com/")
        comps?.queryItems = [URLQueryItem(name: "ll", value: "\(lat),\(lng)"), URLQueryItem(name: "q", value: l.title)]
        if let url = comps?.url { openURL(url) }
    }

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            Skeleton(height: 360, radius: 0)
            VStack(alignment: .leading, spacing: EvSpace.s3) {
                Skeleton(width: 180, height: 34)
                Skeleton(width: 260, height: 20)
                Skeleton(height: 160, radius: EvRadius.xl)
                Skeleton(height: 14)
                Skeleton(width: 220, height: 14)
            }
            .padding(.horizontal, EvSize.gutter)
            Spacer()
        }
        .ignoresSafeArea(edges: .top)
    }
}

extension Amenity {
    var icon: String {
        switch self {
        case .BALCONY: return "sun.horizon"
        case .PARKING: return "car"
        case .ELEVATOR: return "arrow.up.arrow.down.square"
        case .FURNITURE: return "sofa"
        case .KITCHEN_FURNITURE: return "fork.knife"
        case .INTERNET: return "network"
        case .WIFI: return "wifi"
        case .AIR_CONDITIONER: return "snowflake"
        case .CENTRAL_HEATING: return "heater.vertical"
        case .KOMBI: return "flame"
        case .GAS: return "flame"
        case .WATER: return "drop"
        case .ELECTRICITY: return "bolt"
        case .WASHING_MACHINE: return "washer"
        case .DISHWASHER: return "dishwasher"
        case .REFRIGERATOR: return "refrigerator"
        case .TV: return "tv"
        case .POOL: return "figure.pool.swim"
        case .GARDEN: return "leaf"
        case .SECURITY: return "lock.shield"
        case .CCTV: return "video"
        case .SEA_VIEW: return "water.waves"
        case .PETS_ALLOWED: return "pawprint"
        case .KIDS_ALLOWED: return "figure.and.child.holdinghands"
        case .SMOKING_ALLOWED: return "smoke"
        case .SAUNA: return "thermometer.sun"
        case .BBQ: return "flame.fill"
        }
    }
}
