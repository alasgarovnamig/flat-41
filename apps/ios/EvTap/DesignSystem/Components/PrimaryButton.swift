import SwiftUI

enum EvButtonKind {
    /// Black pill, white text.
    case primary
    /// `pill` grey.
    case secondary
    /// Transparent, ink text.
    case ghost
    /// `danger` text on `dangerBg`.
    case destructive
    /// White pill (on dark / photo backgrounds).
    case raised
}

enum EvButtonSize {
    case regular, small
    var height: CGFloat { self == .regular ? 52 : 44 }
}

/// Pill button style (never square). Press = scale .98 / 150 ms; disabled = 40 % opacity.
struct EvButtonStyle: ButtonStyle {
    var kind: EvButtonKind = .primary
    var size: EvButtonSize = .regular
    var fullWidth = true

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ev(EvType.bodyStrong))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(foreground)
            .padding(.horizontal, size == .regular ? EvSpace.s6 : EvSpace.s4)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: size.height)
            .background(Capsule(style: .continuous).fill(background))
            .contentShape(Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.88 : 1) : 0.4)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: EvMotion.fast), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return EvColor.onInk
        case .secondary, .ghost, .raised: return EvColor.ink
        case .destructive: return EvColor.danger
        }
    }

    private var background: Color {
        switch kind {
        case .primary: return EvColor.ink
        case .secondary: return EvColor.pill
        case .ghost: return .clear
        case .destructive: return EvColor.dangerBg
        case .raised: return EvColor.surfaceRaised
        }
    }
}

/// Button with optional leading SF Symbol and loading spinner (keeps its width while loading).
struct PrimaryButton: View {
    let title: String
    var icon: String?
    var kind: EvButtonKind = .primary
    var size: EvButtonSize = .regular
    var fullWidth = true
    var isLoading = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                HStack(spacing: EvSpace.s2) {
                    if let icon { Image(systemName: icon).accessibilityHidden(true) }
                    Text(title)
                }
                .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView()
                        .tint(kind == .primary ? EvColor.onInk : EvColor.ink)
                }
            }
        }
        .buttonStyle(EvButtonStyle(kind: kind, size: size, fullWidth: fullWidth))
        .disabled(isLoading)
        .accessibilityLabel(title)
        .accessibilityValue(isLoading ? L("common.loading") : "")
    }
}
