import SwiftUI

/// Pill track (`pill`) with the selected segment in white + soft shadow (e.g. Daily / Weekly / Monthly).
struct Segmented<T: Hashable>: View {
    let options: [T]
    @Binding var selection: T
    let title: (T) -> String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.self) { option in
                let active = option == selection
                Button {
                    withAnimation(EvMotion.curve(EvMotion.fast, reduceMotion: reduceMotion)) { selection = option }
                } label: {
                    Text(title(option))
                        .font(.ev(EvType.label))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .foregroundStyle(active ? EvColor.ink : EvColor.inkSecondary)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background {
                            if active {
                                Capsule(style: .continuous)
                                    .fill(EvColor.surfaceRaised)
                                    .shadow(color: Color.black.opacity(0.06), radius: 1, x: 0, y: 1)
                                    .matchedGeometryEffect(id: "seg", in: ns)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(2)
        .background(Capsule(style: .continuous).fill(EvColor.pill))
    }
}
