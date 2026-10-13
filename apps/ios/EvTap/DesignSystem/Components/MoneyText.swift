import SwiftUI
import EvTapCore

/// "Big quiet number": thin Outfit value in ink with the currency symbol muted and lighter, before the value
/// (`₼ 276 880`). Optional muted suffix ("/ month").
struct MoneyText: View {
    let parts: Format.Parts
    var style: EvTextStyle = EvType.number
    var suffix: String?
    var valueColor: Color = EvColor.ink

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: style.size * 0.15) {
            Text(parts.symbol)
                .font(.ev(style, weight: .light, size: style.size * 0.82))
                .foregroundStyle(EvColor.muted)
            Text(parts.value)
                .evText(style)
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let suffix {
                Text(suffix)
                    .font(.ev(EvType.label, weight: .regular))
                    .foregroundStyle(EvColor.muted)
                    .fixedSize()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(parts.value) \(parts.symbol)\(suffix.map { " \($0)" } ?? "")")
    }
}

extension MoneyText {
    /// Listing price (MAJOR units) with its period suffix.
    init(listingPrice price: Int, currency: Currency, period: PricePeriod, style: EvTextStyle = EvType.number) {
        self.init(parts: Format.priceParts(price, currency), style: style, suffix: PriceText.periodSuffix(period))
    }

    /// Wallet / payment amount (MINOR units).
    init(minor: Int, currency: Currency = .AZN, style: EvTextStyle = EvType.number) {
        self.init(parts: Format.moneyParts(minor, currency), style: style)
    }
}

enum PriceText {
    static func periodSuffix(_ period: PricePeriod) -> String? {
        switch period {
        case .DAY: return L("common.perNight")
        case .MONTH: return L("common.perMonth")
        case .TOTAL: return nil
        }
    }

    /// "125 000 ₼ / month" (one-line label).
    static func listing(_ price: Int, _ currency: Currency, _ period: PricePeriod) -> String {
        [Format.price(price, currency), periodSuffix(period)].compactMap { $0 }.joined(separator: " ")
    }
}
