import Foundation
import EvTapCore

/// In-app language switching on top of `Localizable.xcstrings` (az = development language, ru, en).
/// The catalog compiles to `<lang>.lproj/Localizable.strings`; we look strings up in the bundle of the chosen
/// language so the app can switch without a restart (the root view is re-identified on change).
final class Localizer: @unchecked Sendable {
    static let shared = Localizer()

    private let lock = NSLock()
    private var bundle: Bundle = .main
    private var fallback: Bundle = .main
    private var _lang: Lang = .default

    var lang: Lang {
        lock.lock(); defer { lock.unlock() }
        return _lang
    }

    func setLanguage(_ lang: Lang) {
        let b = Self.bundle(for: lang) ?? .main
        let fb = Self.bundle(for: .az) ?? .main
        lock.lock()
        _lang = lang
        bundle = b
        fallback = fb
        lock.unlock()
    }

    func string(_ key: String) -> String {
        lock.lock()
        let b = bundle
        let fb = fallback
        lock.unlock()
        let missing = "\u{0}"
        let v = b.localizedString(forKey: key, value: missing, table: "Localizable")
        if v != missing { return v }
        let f = fb.localizedString(forKey: key, value: missing, table: "Localizable")
        return f != missing ? f : key
    }

    private static func bundle(for lang: Lang) -> Bundle? {
        Bundle.main.path(forResource: lang.rawValue, ofType: "lproj").flatMap(Bundle.init(path:))
    }
}

/// Translate `key` (e.g. "common.save") with `{placeholder}` arguments.
func L(_ key: String, _ args: [String: any CustomStringConvertible] = [:]) -> String {
    let template = Localizer.shared.string(key)
    return args.isEmpty ? template : Interpolation.apply(template, args.mapValues { $0.description })
}

/// Translate an enum value: `LE("dealType", "SALE")` → `enums.dealType.SALE`.
func LE(_ group: String, _ value: String?) -> String {
    guard let value else { return "" }
    return L("enums.\(group).\(value)")
}

/// Localised text of a validation issue.
func L(_ issue: ValidationIssue) -> String { L(issue.key, issue.args) }

/// Localised message for any error (API codes → `errors.<CODE>`).
func L(error: Error) -> String {
    if let e = error as? APIError {
        let key = e.localizationKey
        let text = L(key)
        if text != key { return text }
        return e.messages.first ?? L("common.unknownError")
    }
    if error is CancellationError { return "" }
    return L("common.unknownError")
}

extension LocalizedText {
    var current: String { resolve(Localizer.shared.lang) }
}

// MARK: - Dates

enum DateText {
    static var locale: Locale { Locale(identifier: Localizer.shared.lang.rawValue) }

    /// "13 oktyabr 2026"
    static func day(_ date: Date?) -> String {
        guard let date else { return "" }
        return date.formatted(Date.FormatStyle(date: .long, time: .omitted, locale: locale))
    }

    /// "13.10.2026, 14:05"
    static func dateTime(_ date: Date?) -> String {
        guard let date else { return "" }
        return date.formatted(Date.FormatStyle(date: .numeric, time: .shortened, locale: locale))
    }

    /// "14:05"
    static func time(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale))
    }

    /// "Bu gün, 14:05" / "Dünən, 09:12" / "13.10.2026"
    static func relative(_ date: Date?) -> String {
        guard let date else { return "" }
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "\(L("common.today")), \(time(date))" }
        if cal.isDateInYesterday(date) { return "\(L("common.yesterday")), \(time(date))" }
        return date.formatted(Date.FormatStyle(date: .numeric, time: .omitted, locale: locale))
    }

    /// "YYYY-MM-DD" → "13 oktyabr 2026" (calendar days are shown in UTC to avoid off-by-one).
    static func isoDay(_ iso: String?) -> String {
        guard let iso, let d = ISODay.date(iso) else { return iso ?? "" }
        var style = Date.FormatStyle(date: .long, time: .omitted, locale: locale)
        style.timeZone = TimeZone(identifier: "UTC")!
        return d.formatted(style)
    }

    /// "13 okt" short day for compact ranges.
    static func isoDayShort(_ iso: String?) -> String {
        guard let iso, let d = ISODay.date(iso) else { return iso ?? "" }
        var style = Date.FormatStyle(locale: locale).day().month(.abbreviated)
        style.timeZone = TimeZone(identifier: "UTC")!
        return d.formatted(style)
    }

    /// Localised month name + year for calendar headers.
    static func monthTitle(year: Int, month: Int) -> String {
        var c = DateComponents()
        c.year = year
        c.month = month
        c.day = 1
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let d = cal.date(from: c) else { return "\(month)/\(year)" }
        var style = Date.FormatStyle(locale: locale).month(.wide).year()
        style.timeZone = TimeZone(identifier: "UTC")!
        return d.formatted(style).capitalized(with: locale)
    }

    /// Mo … Su, from the translation table (`calendar.weekdays`).
    static var weekdaySymbols: [String] {
        L("calendar.weekdays").split(separator: ",").map { String($0) }
    }
}
