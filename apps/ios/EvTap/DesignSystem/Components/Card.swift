import SwiftUI

/// Frosted card surface: `surface` fill, 28pt continuous corners, inner top highlight, very soft shadow.
struct CardSurface: View {
    var radius: CGFloat = EvRadius.xl
    var fill: Color = EvColor.surface

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(fill)
            .overlay(
                shape.strokeBorder(
                    LinearGradient(colors: [EvColor.glassBorder, EvColor.glassBorder.opacity(0)], startPoint: .top, endPoint: .center),
                    lineWidth: 1
                )
            )
            .evCardShadow()
    }
}

/// Card: optional title (19/500) top-left and trailing accessory (e.g. ↗ icon button) top-right.
struct Card<Content: View, Trailing: View>: View {
    var title: String?
    var padding: CGFloat = EvSpace.s5
    var fill: Color = EvColor.surface
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    init(title: String? = nil, padding: CGFloat = EvSpace.s5, fill: Color = EvColor.surface,
         @ViewBuilder trailing: @escaping () -> Trailing, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.padding = padding
        self.fill = fill
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: EvSpace.s4) {
            if title != nil || Trailing.self != EmptyView.self {
                HStack(alignment: .center, spacing: EvSpace.s3) {
                    if let title {
                        Text(title)
                            .evText(EvType.h3)
                            .foregroundStyle(EvColor.ink)
                            .accessibilityAddTraits(.isHeader)
                    }
                    Spacer(minLength: 0)
                    trailing()
                }
            }
            content()
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CardSurface(fill: fill))
    }
}

extension Card where Trailing == EmptyView {
    init(title: String? = nil, padding: CGFloat = EvSpace.s5, fill: Color = EvColor.surface, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, padding: padding, fill: fill, trailing: { EmptyView() }, content: content)
    }
}

extension View {
    /// Wraps any view in the card surface.
    func evCard(padding: CGFloat = EvSpace.s5, radius: CGFloat = EvRadius.xl, fill: Color = EvColor.surface) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CardSurface(radius: radius, fill: fill))
    }
}
