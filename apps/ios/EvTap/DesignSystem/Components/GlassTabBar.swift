import SwiftUI

/// Floating glass capsule tab bar (64pt high, 16pt above the bottom safe area, 5 items max).
/// Active item = black pill with white icon + label; inactive = icon only (label for VoiceOver).
/// The black circular "+" next to the capsule is the primary "Post listing" action.
struct GlassTabBar: View {
    @Binding var selection: AppTab
    var badges: [AppTab: Int] = [:]
    let onPost: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var ns

    var body: some View {
        HStack(spacing: EvSpace.s2) {
            HStack(spacing: 2) {
                ForEach(AppTab.allCases) { tab in
                    item(tab)
                }
            }
            .padding(EvSpace.s2)
            .frame(height: EvSize.navHeight)
            .evGlass(in: Capsule(style: .continuous))
            .evRaisedShadow()

            Button(action: onPost) {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(EvColor.onInk)
                    .frame(width: EvSize.navHeight, height: EvSize.navHeight)
                    .background(Circle().fill(EvColor.ink))
                    .evRaisedShadow()
            }
            .buttonStyle(EvPressStyle())
            .accessibilityLabel(L("tabs.post"))
        }
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .padding(.horizontal, EvSpace.s4)
    }

    private func item(_ tab: AppTab) -> some View {
        let active = tab == selection
        let count = badges[tab] ?? 0
        return Button {
            withAnimation(EvMotion.curve(reduceMotion: reduceMotion)) { selection = tab }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: tab.icon)
                    .symbolVariant(active ? .fill : .none)
                    .font(.system(size: 18, weight: .regular))
                    .overlay(alignment: .topTrailing) {
                        if count > 0 && !active {
                            Text(count > 99 ? "99+" : "\(count)")
                                .font(.ev(EvType.caption, weight: .semibold, size: 10))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(Capsule().fill(EvColor.danger))
                                .offset(x: 10, y: -8)
                        }
                    }
                if active {
                    Text(L(tab.titleKey))
                        .font(.ev(EvType.label))
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .foregroundStyle(active ? EvColor.onInk : EvColor.ink)
            .padding(.horizontal, active ? 14 : 0)
            .frame(maxWidth: active ? nil : .infinity, minHeight: 48)
            .frame(minWidth: 44)
            .background {
                if active {
                    Capsule(style: .continuous).fill(EvColor.ink).matchedGeometryEffect(id: "tab", in: ns)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L(tab.titleKey))
        .accessibilityValue(count > 0 ? "\(count)" : "")
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }
}
