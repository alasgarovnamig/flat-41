import SwiftUI

/// Two metrics side by side (e.g. Sold / Rented): numbers on top, below a 16pt pill track — left share `ink`,
/// right share `accent`, the remainder (up to `capacity`) hatched with 45° `subtle` stripes.
struct SplitMeter: View {
    struct Metric {
        let label: String
        let value: String
        var symbol: String?
        let amount: Double
    }

    let left: Metric
    let right: Metric
    /// Total capacity of the track; defaults to left + right (no hatched remainder).
    var capacity: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: EvSpace.s3) {
            HStack(alignment: .top, spacing: EvSpace.s4) {
                metricView(left)
                Rectangle().fill(EvColor.hairline).frame(width: 1, height: 44).accessibilityHidden(true)
                metricView(right)
                Spacer(minLength: 0)
            }
            GeometryReader { geo in
                let total = max(capacity ?? (left.amount + right.amount), left.amount + right.amount, 0.0001)
                let w = geo.size.width
                let lw = w * left.amount / total
                let rw = w * right.amount / total
                ZStack(alignment: .leading) {
                    HatchPattern()
                        .stroke(EvColor.subtle, lineWidth: 1.2)
                        .clipShape(Capsule())
                    HStack(spacing: 0) {
                        Capsule().fill(EvColor.ink).frame(width: max(lw, left.amount > 0 ? 16 : 0))
                        Capsule().fill(EvColor.accent).frame(width: max(rw, right.amount > 0 ? 16 : 0))
                    }
                }
            }
            .frame(height: 16)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    private func metricView(_ m: Metric) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(m.label)
                .font(.ev(EvType.label, weight: .regular))
                .foregroundStyle(EvColor.muted)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if let s = m.symbol {
                    Text(s).font(.ev(EvType.h2, weight: .light)).foregroundStyle(EvColor.muted)
                }
                Text(m.value)
                    .evText(EvType.h2, weight: .regular)
                    .foregroundStyle(EvColor.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
    }
}

/// 45° diagonal stripes.
struct HatchPattern: Shape {
    var spacing: CGFloat = 6

    func path(in rect: CGRect) -> Path {
        var p = Path()
        var x = rect.minX - rect.height
        while x < rect.maxX {
            p.move(to: CGPoint(x: x, y: rect.maxY))
            p.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
            x += spacing
        }
        return p
    }
}
