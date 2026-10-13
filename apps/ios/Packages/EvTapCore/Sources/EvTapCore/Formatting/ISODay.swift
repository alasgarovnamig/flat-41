import Foundation

/// Calendar-day helpers on "YYYY-MM-DD" strings (bookings, availability). Arithmetic is done in UTC so
/// it is independent of the device time zone; "today" uses the device calendar.
public enum ISODay {
    private static var utc: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    /// Local calendar day of `date` (device time zone).
    public static func string(from date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return format(year: c.year ?? 1970, month: c.month ?? 1, day: c.day ?? 1)
    }

    public static func today(calendar: Calendar = .current) -> String { string(from: Date(), calendar: calendar) }

    public static func format(year: Int, month: Int, day: Int) -> String {
        func pad(_ v: Int) -> String { v < 10 ? "0\(v)" : "\(v)" }
        return "\(year)-\(pad(month))-\(pad(day))"
    }

    /// Components of "YYYY-MM-DD", or nil when malformed.
    public static func components(_ iso: String) -> (year: Int, month: Int, day: Int)? {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]), (1...12).contains(m), (1...31).contains(d) else { return nil }
        return (y, m, d)
    }

    /// UTC midnight of the day.
    public static func date(_ iso: String) -> Date? {
        guard let c = components(iso) else { return nil }
        return utc.date(from: DateComponents(year: c.year, month: c.month, day: c.day))
    }

    public static func adding(_ days: Int, to iso: String) -> String {
        guard let d = date(iso), let r = utc.date(byAdding: .day, value: days, to: d) else { return iso }
        let c = utc.dateComponents([.year, .month, .day], from: r)
        return format(year: c.year!, month: c.month!, day: c.day!)
    }

    /// Nights between two ISO dates (`nightsBetween` in pricing.ts).
    public static func nightsBetween(_ checkIn: String, _ checkOut: String) -> Int {
        guard let a = date(checkIn), let b = date(checkOut) else { return 0 }
        return Int((b.timeIntervalSince(a) / 86_400).rounded())
    }

    /// Weekday index (0 = Monday … 6 = Sunday) of the day.
    public static func weekdayMondayFirst(_ iso: String) -> Int {
        guard let d = date(iso) else { return 0 }
        let w = utc.component(.weekday, from: d) // 1 = Sunday
        return (w + 5) % 7
    }

    public static func daysInMonth(year: Int, month: Int) -> Int {
        guard let d = utc.date(from: DateComponents(year: year, month: month, day: 1)),
              let range = utc.range(of: .day, in: .month, for: d) else { return 30 }
        return range.count
    }

    /// `count` consecutive months starting with the month containing `from`: [(year, month)].
    public static func months(from iso: String, count: Int) -> [(year: Int, month: Int)] {
        guard let c = components(iso) else { return [] }
        return (0..<count).map { i in
            let m0 = c.month - 1 + i
            return (c.year + m0 / 12, m0 % 12 + 1)
        }
    }
}
