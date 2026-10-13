import SwiftUI

/// Settings-style row: icon in a sunken circle, title / subtitle, optional count badge, chevron.
struct ListRow: View {
    let icon: String
    let title: String
    var subtitle: String?
    var badge: Int?
    var destructive = false
    var showsChevron = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: EvSpace.s3) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(destructive ? EvColor.danger : EvColor.ink)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(destructive ? EvColor.dangerBg : EvColor.surfaceSunken))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.ev(EvType.body))
                        .foregroundStyle(destructive ? EvColor.danger : EvColor.ink)
                    if let subtitle {
                        Text(subtitle)
                            .font(.ev(EvType.caption))
                            .foregroundStyle(EvColor.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: EvSpace.s2)
                if let badge, badge > 0 {
                    Text("\(badge)")
                        .font(.ev(EvType.caption, weight: .semibold))
                        .foregroundStyle(EvColor.onInk)
                        .padding(.horizontal, 7)
                        .frame(minHeight: 20)
                        .background(Capsule().fill(EvColor.ink))
                }
                if showsChevron {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(EvColor.subtle)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, EvSpace.s4)
            .frame(minHeight: 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowPressStyle())
        .accessibilityValue(badge.map { $0 > 0 ? "\($0)" : "" } ?? "")
    }
}

struct RowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? EvColor.surfaceSunken : Color.clear)
    }
}

/// Grouped rows inside one card with hairline dividers.
struct RowGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            content()
        }
        .background(CardSurface(radius: EvRadius.lg))
        .clipShape(RoundedRectangle(cornerRadius: EvRadius.lg, style: .continuous))
    }
}

struct RowDivider: View {
    var body: some View {
        Rectangle().fill(EvColor.hairline).frame(height: 1).padding(.leading, 68).accessibilityHidden(true)
    }
}

/// Label ↔ value line used in price breakdowns and fact tables.
struct KeyValueRow: View {
    let key: String
    let value: String
    var bold = false
    var valueColor: Color = EvColor.ink

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: EvSpace.s3) {
            Text(key)
                .font(.ev(bold ? EvType.bodyStrong : EvType.body))
                .foregroundStyle(bold ? EvColor.ink : EvColor.muted)
            Spacer(minLength: EvSpace.s2)
            Text(value)
                .font(.ev(bold ? EvType.bodyStrong : EvType.body, weight: bold ? .semibold : .medium))
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.trailing)
        }
        .frame(minHeight: 32)
        .accessibilityElement(children: .combine)
    }
}

/// − value + stepper with 44pt buttons.
struct StepperRow: View {
    let title: String
    @Binding var value: Int
    var range: ClosedRange<Int> = 1...30
    var hint: String?

    var body: some View {
        HStack(spacing: EvSpace.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
                if let hint { Text(hint).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted) }
            }
            Spacer()
            IconButton(systemName: "minus", label: "\(title) −", style: .sunken, size: 40) {
                value = max(range.lowerBound, value - 1)
            }
            .disabled(value <= range.lowerBound)
            .opacity(value <= range.lowerBound ? 0.4 : 1)
            Text("\(value)")
                .font(.ev(EvType.h3))
                .foregroundStyle(EvColor.ink)
                .frame(minWidth: 28)
                .accessibilityHidden(true)
            IconButton(systemName: "plus", label: "\(title) +", style: .sunken, size: 40) {
                value = min(range.upperBound, value + 1)
            }
            .disabled(value >= range.upperBound)
            .opacity(value >= range.upperBound ? 0.4 : 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityValue("\(value)")
    }
}

/// Toggle with label + hint, ink tint.
struct ToggleRow: View {
    let title: String
    var hint: String?
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.ev(EvType.body)).foregroundStyle(EvColor.ink)
                if let hint { Text(hint).font(.ev(EvType.caption)).foregroundStyle(EvColor.muted) }
            }
        }
        .tint(EvColor.ink)
        .frame(minHeight: EvSize.touch)
    }
}

/// Small uppercase-free form section label.
struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.ev(EvType.label))
            .foregroundStyle(EvColor.inkSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Inline notice banner (info / warning / danger).
struct NoticeBanner: View {
    let text: String
    var tone: EvTone = .info
    var icon = "info.circle"

    var body: some View {
        HStack(alignment: .top, spacing: EvSpace.s2) {
            Image(systemName: icon).foregroundStyle(tone.foreground).accessibilityHidden(true)
            Text(text).font(.ev(EvType.label, weight: .regular)).foregroundStyle(EvColor.ink)
            Spacer(minLength: 0)
        }
        .padding(EvSpace.s3)
        .background(RoundedRectangle(cornerRadius: EvRadius.md, style: .continuous).fill(tone.background))
        .accessibilityElement(children: .combine)
    }
}
