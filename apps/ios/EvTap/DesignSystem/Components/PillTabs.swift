import SwiftUI

/// Horizontal pill tabs (reference top nav): active = black pill + white text, inactive = `pill` grey.
struct PillTabs<T: Hashable>: View {
    let items: [T]
    @Binding var selection: T
    let title: (T) -> String
    var icon: ((T) -> String?)?
    var badge: ((T) -> Int?)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var ns

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: EvSpace.s2) {
                    ForEach(items, id: \.self) { item in
                        let active = item == selection
                        Button {
                            withAnimation(EvMotion.curve(reduceMotion: reduceMotion)) { selection = item }
                        } label: {
                            HStack(spacing: 6) {
                                if let name = icon?(item) {
                                    Image(systemName: name).font(.system(size: 14)).accessibilityHidden(true)
                                }
                                Text(title(item)).font(.ev(EvType.label)).lineLimit(1)
                                if let n = badge?(item), n > 0 {
                                    Text("\(n)")
                                        .font(.ev(EvType.caption, weight: .semibold))
                                        .foregroundStyle(active ? EvColor.ink : EvColor.onInk)
                                        .padding(.horizontal, 6)
                                        .frame(minHeight: 18)
                                        .background(Capsule().fill(active ? EvColor.onInk : EvColor.ink))
                                }
                            }
                            .foregroundStyle(active ? EvColor.onInk : EvColor.ink)
                            .padding(.horizontal, EvSpace.s4)
                            .frame(minHeight: EvSize.touch)
                            .background {
                                if active {
                                    Capsule(style: .continuous).fill(EvColor.ink).matchedGeometryEffect(id: "pill", in: ns)
                                } else {
                                    Capsule(style: .continuous).fill(EvColor.pill)
                                }
                            }
                            .contentShape(Capsule())
                        }
                        .buttonStyle(EvPressStyle())
                        .id(item)
                        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
                    }
                }
                .padding(.horizontal, EvSize.gutter)
            }
            .onChange(of: selection) { _, new in
                withAnimation(EvMotion.curve(reduceMotion: reduceMotion)) { proxy.scrollTo(new, anchor: .center) }
            }
        }
    }
}
