import SwiftUI

/// 44pt pill with leading line icon + label + chevron; selected = 1.5pt ink outline.
struct FilterPill: View {
    let title: String
    var icon: String?
    var isSelected = false
    /// `surfaceRaised` on cards, `pill` on the canvas.
    var onCard = false
    var showsChevron = true
    var count: Int?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: EvSpace.s2) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 15, weight: .regular)).accessibilityHidden(true)
                }
                Text(title).font(.ev(EvType.label)).lineLimit(1)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.ev(EvType.caption, weight: .semibold))
                        .foregroundStyle(EvColor.onInk)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Circle().fill(EvColor.ink))
                }
                if showsChevron {
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .medium)).accessibilityHidden(true)
                }
            }
            .foregroundStyle(EvColor.ink)
            .padding(.horizontal, EvSpace.s4)
            .frame(minHeight: EvSize.touch)
            .background(Capsule(style: .continuous).fill(onCard ? EvColor.surfaceRaised : EvColor.pill))
            .overlay(Capsule(style: .continuous).strokeBorder(EvColor.ink, lineWidth: isSelected ? 1.5 : 0))
            .contentShape(Capsule())
        }
        .buttonStyle(EvPressStyle())
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Selectable chip used in filter sheets and forms: active = black pill + white text.
struct SelectChip: View {
    let title: String
    var icon: String?
    var isSelected = false
    var minWidth: CGFloat?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 13)).accessibilityHidden(true) }
                Text(title).font(.ev(EvType.label)).lineLimit(1)
            }
            .foregroundStyle(isSelected ? EvColor.onInk : EvColor.ink)
            .padding(.horizontal, 14)
            .frame(minWidth: minWidth, minHeight: 40)
            .background(Capsule(style: .continuous).fill(isSelected ? EvColor.ink : EvColor.pill))
            .padding(.vertical, 2) // 44pt hit target
            .contentShape(Rectangle())
        }
        .buttonStyle(EvPressStyle())
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
