import SwiftUI

/// Async image with a token placeholder; the caller fixes the frame / aspect ratio so nothing shifts on load.
struct RemoteImage: View {
    let url: URL?
    var placeholderIcon = "house"

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: EvMotion.fast))) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                placeholder
            case .empty:
                ZStack {
                    EvColor.surfaceSunken
                    if url != nil { ProgressView().tint(EvColor.muted) }
                }
            @unknown default:
                placeholder
            }
        }
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack {
            EvColor.surfaceSunken
            Image(systemName: placeholderIcon)
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(EvColor.subtle)
        }
    }
}

/// Round avatar: photo or initials on `pill`.
struct Avatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(EvColor.pill)
            Text(initials)
                .font(.ev(EvType.bodyStrong, size: size * 0.38))
                .foregroundStyle(EvColor.ink)
            if url != nil {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        Color.clear
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined()
        return s.isEmpty ? "E" : s.uppercased()
    }
}

/// Wrapping layout for chips (amenities, filter options).
struct FlowLayout: Layout {
    var spacing: CGFloat = EvSpace.s2
    var lineSpacing: CGFloat = EvSpace.s2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: proposal.width ?? widest, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

/// Section title (h3) + optional "See all ↗".
struct SectionHeader: View {
    let title: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .evText(EvType.h3)
                .foregroundStyle(EvColor.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(action: action) {
                    HStack(spacing: 4) {
                        Text(actionTitle).font(.ev(EvType.label))
                        Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .medium)).accessibilityHidden(true)
                    }
                    .foregroundStyle(EvColor.inkSecondary)
                    .frame(minHeight: EvSize.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// ★ 4.8 display (orange star per reference) and 1–5 input.
struct StarRating: View {
    let value: Double
    var size: CGFloat = 13

    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: value >= Double(i) ? "star.fill" : (value >= Double(i) - 0.5 ? "star.leadinghalf.filled" : "star"))
                    .font(.system(size: size))
                    .foregroundStyle(EvColor.star)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: "%.1f / 5", value))
    }
}

struct StarRatingInput: View {
    @Binding var rating: Int

    var body: some View {
        HStack(spacing: EvSpace.s2) {
            ForEach(1...5, id: \.self) { i in
                Button {
                    rating = i
                } label: {
                    Image(systemName: rating >= i ? "star.fill" : "star")
                        .font(.system(size: 30))
                        .foregroundStyle(EvColor.star)
                        .frame(width: EvSize.touch, height: EvSize.touch)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(i)")
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("bookings.rating"))
        .accessibilityValue("\(rating) / 5")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: rating = min(5, rating + 1)
            case .decrement: rating = max(1, rating - 1)
            @unknown default: break
            }
        }
    }
}
