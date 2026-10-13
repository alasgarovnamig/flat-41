import SwiftUI

/// Placeholder block with the same radius as the final content; shimmers unless Reduce Motion is on.
struct Skeleton: View {
    var width: CGFloat?
    var height: CGFloat?
    var radius: CGFloat = EvRadius.sm

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(EvColor.surfaceSunken)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(colors: [.clear, EvColor.surfaceRaised.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.6)
                            .offset(x: phase * geo.size.width * 1.4)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                }
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) { phase = 1 }
            }
            .accessibilityHidden(true)
    }
}

/// Skeleton of a `PropertyCard` (fixed 4:3 image area → no layout shift when content arrives).
struct PropertyCardSkeleton: View {
    var width: CGFloat?

    var body: some View {
        VStack(alignment: .leading, spacing: EvSpace.s2) {
            Skeleton(radius: EvRadius.lg)
                .aspectRatio(4 / 3, contentMode: .fit)
                .frame(maxWidth: .infinity)
            Skeleton(width: 140, height: 14)
            Skeleton(width: 200, height: 12)
            Skeleton(width: 90, height: 12)
        }
        .padding(EvSpace.s3)
        .frame(width: width)
        .background(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous).fill(EvColor.surfaceRaised))
        .accessibilityHidden(true)
    }
}

/// Generic list placeholder rows.
struct ListSkeleton: View {
    var rows = 4
    var rowHeight: CGFloat = 64

    var body: some View {
        VStack(spacing: EvSpace.s3) {
            ForEach(0..<rows, id: \.self) { _ in
                HStack(spacing: EvSpace.s3) {
                    Skeleton(width: 48, height: 48, radius: EvRadius.md)
                    VStack(alignment: .leading, spacing: 8) {
                        Skeleton(width: 160, height: 12)
                        Skeleton(height: 10)
                    }
                }
                .frame(height: rowHeight)
            }
        }
        .padding(.horizontal, EvSize.gutter)
        .accessibilityLabel(L("common.loading"))
    }
}
