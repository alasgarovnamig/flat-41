import SwiftUI

/// Horizontal bars (reference "Average Sale Value"): white pill track with the value label inside on the left;
/// the filled part ends in a black pill holding the delta tag ("+10%"); vertical hairline grid + muted axis.
struct PillBarChart: View {
    struct Row: Identifiable {
        let id = UUID()
        let label: String
        let value: Double
        var tag: String?
    }

    let rows: [Row]
    var maxValue: Double?
    var ticks = 6
    var rowHeight: CGFloat = 30

    var body: some View {
        let top = niceMax
        VStack(spacing: EvSpace.s2) {
            ZStack {
                // grid
                GeometryReader { geo in
                    ForEach(0...ticks, id: \.self) { i in
                        Rectangle()
                            .fill(EvColor.hairline)
                            .frame(width: 1, height: geo.size.height)
                            .offset(x: geo.size.width * CGFloat(i) / CGFloat(ticks))
                    }
                }
                .accessibilityHidden(true)
                VStack(spacing: EvSpace.s3) {
                    ForEach(rows) { row in
                        bar(row, top: top)
                    }
                }
            }
            // axis
            HStack(spacing: 0) {
                ForEach(0...ticks, id: \.self) { i in
                    Text(axisLabel(top * Double(i) / Double(ticks)))
                        .font(.ev(EvType.caption, size: 11))
                        .foregroundStyle(EvColor.muted)
                        .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : (i == ticks ? .trailing : .center))
                }
            }
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
    }

    private func bar(_ row: Row, top: Double) -> some View {
        GeometryReader { geo in
            let fraction = top > 0 ? min(1, row.value / top) : 0
            let filled = max(rowHeight * 2.2, geo.size.width * fraction)
            ZStack(alignment: .leading) {
                Capsule().fill(EvColor.surfaceRaised).frame(width: filled)
                Text(row.label)
                    .font(.ev(EvType.caption, size: 11))
                    .foregroundStyle(EvColor.inkSecondary)
                    .padding(.leading, 10)
                    .lineLimit(1)
                if let tag = row.tag {
                    Text(tag)
                        .font(.ev(EvType.caption, weight: .medium, size: 11))
                        .foregroundStyle(EvColor.onInk)
                        .padding(.horizontal, 12)
                        .frame(height: rowHeight)
                        .background(Capsule().fill(EvColor.ink))
                        .offset(x: max(0, filled - 56))
                }
            }
        }
        .frame(height: rowHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.label)\(row.tag.map { ", \($0)" } ?? "")")
    }

    private var niceMax: Double {
        let m = maxValue ?? (rows.map(\.value).max() ?? 1)
        guard m > 0 else { return Double(ticks) }
        let magnitude = pow(10, floor(log10(m)))
        let step = (m / magnitude).rounded(.up) * magnitude
        return max(step, Double(ticks))
    }

    private func axisLabel(_ v: Double) -> String {
        v >= 1000 ? "\(Int((v / 1000).rounded()))K" : "\(Int(v.rounded()))"
    }
}
