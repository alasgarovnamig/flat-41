import SwiftUI

/// 24–32 thin vertical bars (2pt, gap 3pt): historic bars `subtle` and scaled by value, the last ~8 bars `ink`
/// at full height — reads as a barcode (reference: Total Revenue card).
struct BarcodeSpark: View {
    let values: [Double]
    var highlightLast = 8
    var barWidth: CGFloat = 2
    var gap: CGFloat = 3
    var height: CGFloat = 40
    var maxBars = 28

    var body: some View {
        let data = normalized
        HStack(alignment: .bottom, spacing: gap) {
            ForEach(Array(data.enumerated()), id: \.offset) { i, v in
                let recent = i >= data.count - highlightLast
                Capsule(style: .continuous)
                    .fill(recent ? EvColor.ink : EvColor.subtle)
                    .frame(width: barWidth, height: recent ? height * max(0.55, v) : max(4, height * 0.62 * v))
            }
        }
        .frame(height: height, alignment: .bottom)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    /// Last `maxBars` values scaled to 0…1 (padded on the left with small bars so short series still read as a barcode).
    private var normalized: [Double] {
        let tail = Array(values.suffix(maxBars))
        let maxV = max(tail.max() ?? 0, 1)
        let scaled = tail.map { max(0.08, $0 / maxV) }
        let padding = Array(repeating: 0.12, count: max(0, 16 - scaled.count))
        return padding + scaled
    }

    private var accessibilitySummary: String {
        guard let last = values.last else { return "" }
        let total = values.reduce(0, +)
        return L("stats.sparkSummary", ["last": Int(last), "total": Int(total), "n": values.count])
    }
}
