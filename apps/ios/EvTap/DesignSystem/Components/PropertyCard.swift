import SwiftUI
import EvTapCore

/// Reference "Property Object" card: white body (radius 22), 4:3 photo fading into white, top-right white heart
/// circle + black ↗ circle; meta row "• For Rent" (dot by deal type) + orange ★; title 15/500, address 12 muted,
/// price right (`₼` muted + value ink); spec chips row (m², rooms, floor, sot).
struct PropertyCard: View {
    let card: ListingCard
    /// nil = fill the available width (lists); a value = fixed width (carousels).
    var width: CGFloat?

    @Environment(FavoritesStore.self) private var favorites
    @Environment(Router.self) private var router

    private var services: AppServices { AppServices.shared }

    var body: some View {
        let isFavorite = favorites.isFavorite(card.id)
        Button {
            router.push(.listing(id: card.id))
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                photo
                details
            }
            .background(
                RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous)
                    .fill(card.isHighlighted ? EvColor.highlightBg : EvColor.surfaceRaised)
            )
            .clipShape(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous))
            .evCardShadow()
        }
        .buttonStyle(EvPressStyle())
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 6) {
                IconButton(systemName: isFavorite ? "heart.fill" : "heart",
                           label: isFavorite ? L("listing.unsave") : L("listing.save"),
                           style: .raised, size: 36, isSelected: isFavorite,
                           tint: isFavorite ? EvColor.danger : nil) {
                    favorites.toggle(card.id)
                }
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(EvColor.onInk)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(EvColor.ink))
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
            }
            .padding(EvSpace.s2)
        }
        .frame(width: width)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityText)
    }

    private var photo: some View {
        Color.clear
            .aspectRatio(4 / 3, contentMode: .fit)
            .overlay { RemoteImage(url: services.api.mediaURL(card.coverUrl)) }
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [(card.isHighlighted ? EvColor.highlightBg : EvColor.surfaceRaised).opacity(0), card.isHighlighted ? EvColor.highlightBg : EvColor.surfaceRaised],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 64)
            }
            .overlay(alignment: .topLeading) {
                ListingBadges(card: card).padding(EvSpace.s3)
            }
            .overlay(alignment: .bottomTrailing) {
                if card.imagesCount > 1 {
                    Label("\(card.imagesCount)", systemImage: "camera")
                        .font(.ev(EvType.caption, size: 11))
                        .foregroundStyle(EvColor.inkSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(EvColor.surfaceRaised.opacity(0.85)))
                        .padding(EvSpace.s3)
                        .accessibilityHidden(true)
                }
            }
            .clipped()
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: EvSpace.s2) {
                HStack(spacing: 5) {
                    Circle().fill(card.dealType.dotColor).frame(width: 6, height: 6)
                    Text(LE("dealTypeCard", card.dealType.rawValue))
                        .font(.ev(EvType.caption, size: 11))
                        .foregroundStyle(EvColor.inkSecondary)
                }
                if let rating = card.rating {
                    HStack(spacing: 3) {
                        Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(EvColor.star)
                        Text(String(format: "%.1f", rating))
                            .font(.ev(EvType.caption, size: 11))
                            .foregroundStyle(EvColor.inkSecondary)
                    }
                }
                Spacer(minLength: 0)
                Text(card.isBusiness ? L("badge.business") : L("badge.owner"))
                    .font(.ev(EvType.caption, size: 11))
                    .foregroundStyle(EvColor.muted)
            }
            HStack(alignment: .firstTextBaseline, spacing: EvSpace.s2) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.title)
                        .font(.ev(EvType.bodyStrong))
                        .foregroundStyle(EvColor.ink)
                        .lineLimit(1)
                    Text(locationLine)
                        .font(.ev(EvType.caption))
                        .foregroundStyle(EvColor.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                MoneyText(parts: Format.priceParts(card.price, card.currency), style: EvType.bodyStrong,
                          suffix: card.pricePeriod == .TOTAL ? nil : (card.pricePeriod == .DAY ? L("common.perNightShort") : L("common.perMonthShort")))
                    .layoutPriority(1)
            }
            specChips
        }
        .padding(.horizontal, EvSpace.s3)
        .padding(.top, 2)
        .padding(.bottom, EvSpace.s3)
    }

    private var specChips: some View {
        HStack(spacing: 6) {
            ForEach(ListingFacts.chips(card), id: \.self) { chip in
                Text(chip)
                    .font(.ev(EvType.caption, size: 11))
                    .foregroundStyle(EvColor.muted)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(EvColor.surfaceSunken))
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var locationLine: String {
        [card.address, services.locations.label(cityId: card.cityId, districtId: card.districtId, metroId: nil, lang: Localizer.shared.lang)]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: ", ")
    }

    private var accessibilityText: String {
        [card.title, PriceText.listing(card.price, card.currency, card.pricePeriod), locationLine, ListingFacts.chips(card).joined(separator: ", ")]
            .joined(separator: ". ")
    }
}

/// Short facts shared by cards and the detail header.
enum ListingFacts {
    static func chips(_ c: ListingCard) -> [String] {
        var out: [String] = []
        if c.area > 0 { out.append("\(Format.number(c.area)) \(L("common.m2"))") }
        if let r = c.rooms, r > 0 { out.append(L("common.roomsShort", ["n": r])) }
        if let l = c.landArea, l > 0 { out.append("\(Format.number(l)) \(L("common.sot"))") }
        if let f = c.floor, let t = c.totalFloors { out.append(L("common.floorOf", ["floor": f, "total": t])) }
        return out
    }
}
