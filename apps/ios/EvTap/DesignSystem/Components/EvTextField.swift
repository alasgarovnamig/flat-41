import SwiftUI

/// Labelled input: `surfaceRaised`, radius 16, 48pt, 1pt hairline; focus = ink border + 20 % ink ring.
/// Error text sits right under the field (never placeholder-only labels).
struct EvTextField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var prefix: String?
    var error: String?
    var hint: String?
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType?
    var autocapitalization: TextInputAutocapitalization = .sentences
    var secure = false
    var multiline = false
    var maxLength: Int?
    var disabled = false

    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !label.isEmpty {
                Text(label)
                    .font(.ev(EvType.label))
                    .foregroundStyle(EvColor.inkSecondary)
            }
            HStack(alignment: multiline ? .top : .center, spacing: EvSpace.s2) {
                if let prefix {
                    Text(prefix)
                        .font(.ev(EvType.bodyStrong))
                        .foregroundStyle(EvColor.ink)
                        .accessibilityHidden(true)
                }
                input
                    .font(.ev(EvType.body))
                    .foregroundStyle(EvColor.ink)
                    .keyboardType(keyboard)
                    .textContentType(contentType)
                    .textInputAutocapitalization(autocapitalization)
                    .focused($focused)
                    .disabled(disabled)
                    .accessibilityLabel(label.isEmpty ? placeholder : label)
                    .accessibilityHint(error ?? hint ?? "")
            }
            .padding(.horizontal, EvSpace.s4)
            .padding(.vertical, multiline ? 14 : 0)
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(disabled ? EvColor.surfaceSunken : EvColor.surfaceRaised))
            .overlay(
                RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous)
                    .strokeBorder(error != nil ? EvColor.danger : (focused ? EvColor.ink : EvColor.hairline), lineWidth: focused || error != nil ? 1.5 : 1)
            )
            .background(
                RoundedRectangle(cornerRadius: EvRadius.md + 3, style: .continuous)
                    .stroke(EvColor.ink.opacity(focused ? 0.2 : 0), lineWidth: 3)
                    .padding(-2)
            )
            .onChange(of: text) { _, new in
                if let maxLength, new.count > maxLength { text = String(new.prefix(maxLength)) }
            }

            if let error {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.danger)
            } else if let hint {
                Text(hint)
                    .font(.ev(EvType.caption))
                    .foregroundStyle(EvColor.muted)
            }
        }
    }

    @ViewBuilder private var input: some View {
        if secure {
            SecureField(placeholder, text: $text)
        } else if multiline {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(4...10)
        } else {
            TextField(placeholder, text: $text)
        }
    }
}

/// Numeric text binding helpers (forms keep numbers as text until submit).
extension Binding where Value == String {
    /// Keeps only digits (and one decimal separator when `decimal`).
    func numeric(decimal: Bool = false) -> Binding<String> {
        Binding(
            get: { wrappedValue },
            set: { new in
                var seenSeparator = false
                let filtered = new.filter { ch in
                    if ch.isNumber { return true }
                    if decimal, ch == "." || ch == ",", !seenSeparator {
                        seenSeparator = true
                        return true
                    }
                    return false
                }
                wrappedValue = filtered.replacingOccurrences(of: ",", with: ".")
            }
        )
    }
}
