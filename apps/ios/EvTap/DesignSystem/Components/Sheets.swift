import SwiftUI

/// Sheet scaffold: glass header (title + close), scrolling content, optional pinned footer.
/// Presented with 28pt top radius on `surfaceRaised` and a token scrim.
struct EvSheet<Content: View, Footer: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer

    @Environment(\.dismiss) private var dismiss

    init(title: String, @ViewBuilder content: @escaping () -> Content, @ViewBuilder footer: @escaping () -> Footer) {
        self.title = title
        self.content = content
        self.footer = footer
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title)
                    .evText(EvType.h3)
                    .foregroundStyle(EvColor.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                IconButton(systemName: "xmark", label: L("common.close"), style: .sunken, size: 36) { dismiss() }
            }
            .padding(.horizontal, EvSize.gutter)
            .padding(.top, EvSpace.s4)
            .padding(.bottom, EvSpace.s2)

            ScrollView {
                VStack(alignment: .leading, spacing: EvSpace.s4) {
                    content()
                }
                .padding(.horizontal, EvSize.gutter)
                .padding(.vertical, EvSpace.s3)
            }
            .scrollDismissesKeyboard(.interactively)

            if Footer.self != EmptyView.self {
                VStack(spacing: 0) {
                    Rectangle().fill(EvColor.hairline).frame(height: 1)
                    footer()
                        .padding(.horizontal, EvSize.gutter)
                        .padding(.vertical, EvSpace.s3)
                }
                .background(EvColor.surfaceRaised)
            }
        }
        .background(EvColor.surfaceRaised)
        .presentationCornerRadius(EvRadius.xl)
        .presentationBackground(EvColor.surfaceRaised)
        .presentationDragIndicator(.visible)
    }
}

extension EvSheet where Footer == EmptyView {
    init(title: String, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, content: content, footer: { EmptyView() })
    }
}

/// Option for `OptionPickerSheet` / `SelectField`.
struct PickerOption: Identifiable, Hashable {
    let id: String
    let title: String
    var subtitle: String?
    var dotColor: Color?
}

/// Searchable single / multi select list.
struct OptionPickerSheet: View {
    let title: String
    let options: [PickerOption]
    @Binding var selection: Set<String>
    var multiple = false

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [PickerOption] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return options }
        return options.filter { $0.title.lowercased().contains(q) }
    }

    var body: some View {
        Group {
            if multiple {
                EvSheet(title: title) {
                    list
                } footer: {
                    HStack(spacing: EvSpace.s2) {
                        PrimaryButton(title: L("common.clear"), kind: .secondary) { selection = [] }
                        PrimaryButton(title: L("common.done")) { dismiss() }
                    }
                }
            } else {
                EvSheet(title: title) { list }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var list: some View {
        if options.count > 10 {
            SearchField(text: $query, placeholder: L("common.search"))
        }
        VStack(spacing: 0) {
            ForEach(filtered) { option in
                let checked = selection.contains(option.id)
                Button {
                    if multiple {
                        if checked { selection.remove(option.id) } else { selection.insert(option.id) }
                    } else {
                        selection = checked ? [] : [option.id]
                        dismiss()
                    }
                } label: {
                    HStack(spacing: EvSpace.s3) {
                        if let color = option.dotColor {
                            Circle().fill(color).frame(width: 10, height: 10).accessibilityHidden(true)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.title).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
                            if let s = option.subtitle {
                                Text(s).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted)
                            }
                        }
                        Spacer()
                        Image(systemName: multiple ? (checked ? "checkmark.square.fill" : "square") : (checked ? "checkmark.circle.fill" : "circle"))
                            .font(.system(size: 20, weight: .regular))
                            .foregroundStyle(checked ? EvColor.ink : EvColor.subtle)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 52)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(checked ? .isSelected : [])
                Rectangle().fill(EvColor.hairline).frame(height: 1)
            }
        }
    }
}

/// Form field that shows the current choice and opens an `OptionPickerSheet`.
struct SelectField: View {
    let label: String
    var placeholder: String = L("common.select")
    let options: [PickerOption]
    @Binding var selection: Set<String>
    var multiple = false
    var disabled = false
    var error: String?

    @State private var open = false

    private var summary: String {
        let chosen = options.filter { selection.contains($0.id) }
        if chosen.isEmpty { return placeholder }
        if chosen.count == 1 { return chosen[0].title }
        if chosen.count <= 2 { return chosen.map(\.title).joined(separator: ", ") }
        return L("search.selected", ["n": chosen.count])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.ev(EvType.label)).foregroundStyle(EvColor.inkSecondary)
            Button {
                open = true
            } label: {
                HStack {
                    Text(summary)
                        .font(.ev(EvType.body))
                        .foregroundStyle(selection.isEmpty ? EvColor.muted : EvColor.ink)
                        .lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .medium)).foregroundStyle(EvColor.muted)
                }
                .padding(.horizontal, EvSpace.s4)
                .frame(minHeight: 48)
                .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(disabled ? EvColor.surfaceSunken : EvColor.surfaceRaised))
                .overlay(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).strokeBorder(error == nil ? EvColor.hairline : EvColor.danger, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel(label)
            .accessibilityValue(summary)
            if let error {
                Text(error).font(.ev(EvType.caption)).foregroundStyle(EvColor.danger)
            }
        }
        .sheet(isPresented: $open) {
            OptionPickerSheet(title: label, options: options, selection: $selection, multiple: multiple)
        }
    }
}

extension Binding where Value == String? {
    /// Single optional value ↔ Set for `SelectField`.
    var asSet: Binding<Set<String>> {
        Binding<Set<String>>(
            get: { wrappedValue.map { [$0] } ?? [] },
            set: { wrappedValue = $0.first }
        )
    }
}

extension Binding where Value == [String] {
    var asSet: Binding<Set<String>> {
        Binding<Set<String>>(
            get: { Set(wrappedValue) },
            set: { new in wrappedValue = wrappedValue.filter { new.contains($0) } + new.subtracting(wrappedValue).sorted() }
        )
    }
}

/// Top toast (success / error / info) shown by `ToastCenter`.
struct ToastView: View {
    let toast: ToastCenter.Toast

    var body: some View {
        HStack(spacing: EvSpace.s2) {
            Image(systemName: icon).accessibilityHidden(true)
            Text(toast.text).font(.ev(EvType.label)).multilineTextAlignment(.leading)
        }
        .foregroundStyle(EvColor.onInk)
        .padding(.horizontal, EvSpace.s4)
        .padding(.vertical, EvSpace.s3)
        .background(Capsule(style: .continuous).fill(toast.kind == .error ? EvColor.danger : EvColor.ink))
        .evRaisedShadow()
        .padding(.horizontal, EvSize.gutter)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    private var icon: String {
        switch toast.kind {
        case .success: return "checkmark.circle"
        case .error: return "exclamationmark.circle"
        case .info: return "info.circle"
        }
    }
}
