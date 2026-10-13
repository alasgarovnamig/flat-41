import SwiftUI

/// Circular icon button (44pt target). Thin SF Symbol inside `surfaceSunken`, white, black or glass circle.
struct IconButton: View {
    enum Style { case sunken, raised, ink, glass, plain }

    let systemName: String
    /// VoiceOver label (required — icon-only control).
    let label: String
    var style: Style = .sunken
    /// Visual diameter; the hit area is never smaller than 44pt.
    var size: CGFloat = EvSize.iconButton
    var badge = false
    var isSelected: Bool?
    var tint: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: max(13, size * 0.4), weight: .regular))
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(tint ?? foreground)
                .frame(width: size, height: size)
                .background(background)
                .overlay(alignment: .topTrailing) {
                    if badge {
                        Circle()
                            .fill(EvColor.danger)
                            .frame(width: 9, height: 9)
                            .overlay(Circle().stroke(EvColor.surface, lineWidth: 1.5))
                            .offset(x: -size * 0.12, y: size * 0.12)
                            .accessibilityHidden(true)
                    }
                }
                .frame(width: max(size, EvSize.touch), height: max(size, EvSize.touch))
                .contentShape(Rectangle())
        }
        .buttonStyle(EvPressStyle())
        .accessibilityLabel(label)
        .accessibilityAddTraits(isSelected == true ? .isSelected : [])
    }

    private var foreground: Color {
        switch style {
        case .ink: return EvColor.onInk
        default: return EvColor.ink
        }
    }

    @ViewBuilder private var background: some View {
        switch style {
        case .sunken: Circle().fill(EvColor.surfaceSunken)
        case .raised: Circle().fill(EvColor.surfaceRaised).evCardShadow()
        case .ink: Circle().fill(EvColor.ink)
        case .glass: Circle().fill(Color.clear).evGlass(in: Circle())
        case .plain: Color.clear
        }
    }
}
