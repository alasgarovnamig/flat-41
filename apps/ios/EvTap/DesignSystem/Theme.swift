import SwiftUI
import UIKit

// Design-system glue on top of the generated `EvTapTokens.swift` (never edit that file — it is regenerated
// from packages/design-tokens/tokens.json).

/// `EvTextStyle` is a plain value type; the generated file does not mark it Sendable.
extension EvTextStyle: @unchecked Sendable {}

/// Extra tokens from tokens.json that the Swift generator does not emit (size / motion / shadow / blur).
enum EvSize {
    static let touch: CGFloat = 44
    static let iconButton: CGFloat = 44
    static let navHeight: CGFloat = 64
    static let iconSm: CGFloat = 14
    static let iconMd: CGFloat = 18
    static let iconLg: CGFloat = 22
    /// Side margin of mobile screens (DESIGN_SYSTEM.md §3 "Mobile").
    static let gutter: CGFloat = 20
}

enum EvMotion {
    static let fast: Double = 0.15
    static let base: Double = 0.22
    static let slow: Double = 0.32

    /// tokens.json easing `cubic-bezier(0.2, 0.8, 0.2, 1)`; nil when Reduce Motion is on.
    static func curve(_ duration: Double = base, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: duration)
    }
}

// MARK: - Fonts

/// Bundled Outfit (display) + Inter (body) static instances; falls back to SF when a face is missing.
enum EvFonts {
    /// PostScript names of every face available at runtime (bundled + system).
    static let installed: Set<String> = Set(UIFont.familyNames.flatMap { UIFont.fontNames(forFamilyName: $0) })

    static func faceName(display: Bool, weight: Font.Weight) -> String {
        let family = display ? EvFontName.display : EvFontName.body
        let style: String
        if weight == .light || weight == .thin || weight == .ultraLight {
            style = display ? "Light" : "Regular"
        } else if weight == .medium {
            style = "Medium"
        } else if weight == .semibold || weight == .bold || weight == .heavy || weight == .black {
            style = "SemiBold"
        } else {
            style = "Regular"
        }
        return "\(family)-\(style)"
    }

    /// Text style the custom size scales with (Dynamic Type).
    static func textStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case 34...: return .largeTitle
        case 26..<34: return .title
        case 21..<26: return .title2
        case 18..<21: return .title3
        case 16..<18: return .headline
        case 14..<16: return .body
        case 13..<14: return .footnote
        case 12..<13: return .caption
        default: return .caption2
        }
    }
}

extension Font {
    /// Token typography: `.ev(EvType.h1)`; scales with Dynamic Type via `relativeTo:`.
    static func ev(_ style: EvTextStyle, weight: Font.Weight? = nil, size: CGFloat? = nil) -> Font {
        let w = weight ?? style.weight
        let s = size ?? style.size
        let face = EvFonts.faceName(display: style.display, weight: w)
        let relative = EvFonts.textStyle(for: s)
        if EvFonts.installed.contains(face) {
            return .custom(face, size: s, relativeTo: relative)
        }
        return .system(relative, design: .default).weight(w)
    }
}

private struct EvTextModifier: ViewModifier {
    let style: EvTextStyle
    let weight: Font.Weight?
    let size: CGFloat?

    func body(content: Content) -> some View {
        content
            .font(.ev(style, weight: weight, size: size))
            .tracking(style.tracking)
            .lineSpacing(max(0, (style.line - style.size * 1.2) / 2))
    }
}

extension View {
    /// Applies a token text style (font family, size, weight, tracking, line height).
    func evText(_ style: EvTextStyle, weight: Font.Weight? = nil, size: CGFloat? = nil) -> some View {
        modifier(EvTextModifier(style: style, weight: weight, size: size))
    }
}

// MARK: - Surfaces

extension View {
    /// tokens.json `shadow.card` (very soft, two layers).
    func evCardShadow() -> some View {
        shadow(color: Color.black.opacity(0.08), radius: 16, x: 0, y: 10)
            .shadow(color: Color.black.opacity(0.03), radius: 3, x: 0, y: 2)
    }

    /// tokens.json `shadow.raised`.
    func evRaisedShadow() -> some View {
        shadow(color: Color.black.opacity(0.14), radius: 24, x: 0, y: 14)
            .shadow(color: Color.black.opacity(0.05), radius: 4, x: 0, y: 2)
    }

    /// Frosted glass: material + `glass` tint + hairline `glassBorder` (sticky headers, floating bars, map overlays).
    func evGlass<S: Shape>(in shape: S) -> some View {
        background {
            shape.fill(.ultraThinMaterial)
                .overlay(shape.fill(EvColor.glass))
                .overlay(shape.stroke(EvColor.glassBorder, lineWidth: 1))
        }
    }

    /// Screen background: soft grey canvas edge to edge.
    func evScreenBackground() -> some View {
        background(EvColor.canvas.ignoresSafeArea())
    }
}

/// Press feedback without layout shift: scale .98 (opacity only with Reduce Motion), 150 ms.
struct EvPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: EvMotion.fast), value: configuration.isPressed)
    }
}
