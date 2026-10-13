import SwiftUI

/// Pill search field (leading magnifier, `surfaceRaised`, 44pt) + optional 44pt circular "sliders" filter button.
struct SearchField: View {
    @Binding var text: String
    var placeholder: String
    var filterCount = 0
    var onSubmit: () -> Void = {}
    var onFilters: (() -> Void)?
    var focused: FocusState<Bool>.Binding?

    var body: some View {
        HStack(spacing: EvSpace.s2) {
            HStack(spacing: EvSpace.s2) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(EvColor.muted)
                    .accessibilityHidden(true)
                field
                if !text.isEmpty {
                    Button {
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(EvColor.subtle)
                            .frame(width: 32, height: EvSize.touch)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L("common.clear"))
                }
            }
            .padding(.leading, EvSpace.s4)
            .padding(.trailing, text.isEmpty ? EvSpace.s4 : 4)
            .frame(minHeight: EvSize.touch)
            .background(Capsule(style: .continuous).fill(EvColor.surfaceRaised))
            .overlay(Capsule(style: .continuous).strokeBorder(EvColor.hairline, lineWidth: 1))

            if let onFilters {
                Button(action: onFilters) {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 16, weight: .regular))
                        .foregroundStyle(filterCount > 0 ? EvColor.onInk : EvColor.ink)
                        .frame(width: EvSize.iconButton, height: EvSize.iconButton)
                        .background(Circle().fill(filterCount > 0 ? EvColor.ink : EvColor.surfaceRaised))
                        .overlay(alignment: .topTrailing) {
                            if filterCount > 0 {
                                Text("\(filterCount)")
                                    .font(.ev(EvType.caption, weight: .semibold, size: 10))
                                    .foregroundStyle(EvColor.ink)
                                    .frame(minWidth: 16, minHeight: 16)
                                    .background(Circle().fill(EvColor.accent))
                                    .offset(x: 2, y: -2)
                            }
                        }
                }
                .buttonStyle(EvPressStyle())
                .accessibilityLabel(L("common.filters"))
                .accessibilityValue(filterCount > 0 ? L("search.selected", ["n": filterCount]) : "")
            }
        }
    }

    @ViewBuilder private var field: some View {
        let tf = TextField(placeholder, text: $text)
            .font(.ev(EvType.body))
            .foregroundStyle(EvColor.ink)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .onSubmit(onSubmit)
            .accessibilityLabel(placeholder)
        if let focused {
            tf.focused(focused)
        } else {
            tf
        }
    }
}
