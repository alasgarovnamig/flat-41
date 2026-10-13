import SwiftUI
import EvTapCore

enum CalendarDayState {
    case normal, past, disabled, booked, blocked
    case selectedStart, selectedEnd, selectedSingle, inRange

    var isInteractive: Bool {
        switch self {
        case .past, .disabled, .booked: return false
        default: return true
        }
    }

    var accessibilityKey: String? {
        switch self {
        case .booked: return "calendar.booked"
        case .blocked: return "calendar.blocked"
        case .selectedStart: return "booking.checkIn"
        case .selectedEnd: return "booking.checkOut"
        case .selectedSingle, .inRange: return "booking.legendSelected"
        case .disabled, .past: return "calendar.unavailable"
        case .normal: return nil
        }
    }
}

/// Vertical list of month grids (Monday first) for booking ranges, host blocking and filter dates.
struct MonthCalendar: View {
    /// First month shown = month of this day ("YYYY-MM-DD", usually today).
    let from: String
    var months = 6
    let state: (String) -> CalendarDayState
    let onTap: (String) -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var body: some View {
        let list = ISODay.months(from: from, count: months)
        LazyVStack(alignment: .leading, spacing: EvSpace.s6) {
            ForEach(list.indices, id: \.self) { i in
                monthView(year: list[i].year, month: list[i].month)
            }
        }
    }

    private func monthView(year: Int, month: Int) -> some View {
        let first = ISODay.format(year: year, month: month, day: 1)
        let leading = ISODay.weekdayMondayFirst(first)
        let count = ISODay.daysInMonth(year: year, month: month)
        let symbols = DateText.weekdaySymbols
        return VStack(alignment: .leading, spacing: EvSpace.s2) {
            Text(DateText.monthTitle(year: year, month: month))
                .evText(EvType.h3)
                .foregroundStyle(EvColor.ink)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(0..<7, id: \.self) { i in
                    Text(i < symbols.count ? symbols[i] : "")
                        .font(.ev(EvType.caption))
                        .foregroundStyle(EvColor.muted)
                        .frame(height: 24)
                        .accessibilityHidden(true)
                }
                ForEach(0..<(leading + count), id: \.self) { idx in
                    if idx < leading {
                        Color.clear.frame(height: 44).accessibilityHidden(true)
                    } else {
                        let day = idx - leading + 1
                        dayCell(ISODay.format(year: year, month: month, day: day), day: day)
                    }
                }
            }
        }
    }

    private func dayCell(_ iso: String, day: Int) -> some View {
        let s = state(iso)
        return Button {
            onTap(iso)
        } label: {
            ZStack {
                background(for: s)
                Text("\(day)")
                    .font(.ev(EvType.body, weight: isSelected(s) ? .semibold : .regular))
                    .foregroundStyle(foreground(for: s))
                    .strikethrough(s == .booked, color: EvColor.muted)
            }
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!s.isInteractive)
        .accessibilityLabel(DateText.isoDay(iso))
        .accessibilityValue(s.accessibilityKey.map { L($0) } ?? "")
        .accessibilityAddTraits(isSelected(s) ? .isSelected : [])
    }

    private func isSelected(_ s: CalendarDayState) -> Bool {
        s == .selectedStart || s == .selectedEnd || s == .selectedSingle
    }

    @ViewBuilder private func background(for s: CalendarDayState) -> some View {
        switch s {
        case .selectedStart, .selectedEnd, .selectedSingle:
            ZStack {
                if s == .selectedStart {
                    HStack(spacing: 0) { Color.clear; EvColor.pill }.padding(.vertical, 4)
                } else if s == .selectedEnd {
                    HStack(spacing: 0) { EvColor.pill; Color.clear }.padding(.vertical, 4)
                }
                Circle().fill(EvColor.ink).padding(2)
            }
        case .inRange:
            EvColor.pill.padding(.vertical, 4)
        case .blocked:
            Circle().fill(EvColor.dangerBg).padding(4)
        case .booked:
            Circle().fill(EvColor.surfaceSunken).padding(4)
        default:
            Color.clear
        }
    }

    private func foreground(for s: CalendarDayState) -> Color {
        switch s {
        case .selectedStart, .selectedEnd, .selectedSingle: return EvColor.onInk
        case .past, .disabled: return EvColor.subtle
        case .booked: return EvColor.muted
        case .blocked: return EvColor.danger
        default: return EvColor.ink
        }
    }
}

/// Colour key under a calendar.
struct CalendarLegend: View {
    var items: [(color: Color, labelKey: String, strike: Bool)]

    var body: some View {
        HStack(spacing: EvSpace.s4) {
            ForEach(items.indices, id: \.self) { i in
                HStack(spacing: 6) {
                    Circle().fill(items[i].color).frame(width: 14, height: 14)
                        .overlay(Circle().stroke(EvColor.hairline, lineWidth: 1))
                    Text(L(items[i].labelKey))
                        .font(.ev(EvType.caption))
                        .foregroundStyle(EvColor.inkSecondary)
                        .strikethrough(items[i].strike)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
