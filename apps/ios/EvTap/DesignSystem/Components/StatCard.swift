import SwiftUI
import EvTapCore

/// Card + label + big number (`type.number`) + caption + right-aligned `BarcodeSpark`; optional ↗ action.
struct StatCard: View {
    let label: String
    var value: String?
    var money: Format.Parts?
    var caption: String?
    var spark: [Double] = []
    var openAction: (() -> Void)?
    var openLabel: String?

    var body: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            HStack(alignment: .top) {
                Text(label)
                    .evText(EvType.h3, weight: .regular, size: 16)
                    .foregroundStyle(EvColor.ink)
                    .lineLimit(2)
                Spacer(minLength: EvSpace.s2)
                if let openAction {
                    IconButton(systemName: "arrow.up.right", label: openLabel ?? label, style: .raised, size: 36, action: openAction)
                        .padding(-4)
                }
            }
            Spacer(minLength: EvSpace.s2)
            HStack(alignment: .bottom, spacing: EvSpace.s2) {
                VStack(alignment: .leading, spacing: 4) {
                    if let money {
                        MoneyText(parts: money)
                    } else if let value {
                        Text(value)
                            .evText(EvType.number)
                            .foregroundStyle(EvColor.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    if let caption {
                        Text(caption)
                            .font(.ev(EvType.label, weight: .regular))
                            .foregroundStyle(EvColor.muted)
                    }
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                if !spark.isEmpty {
                    BarcodeSpark(values: spark, height: 36, maxBars: 18)
                }
            }
        }
        .padding(EvSpace.s5)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(CardSurface())
    }
}
