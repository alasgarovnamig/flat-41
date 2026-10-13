import Foundation

/// Port of `packages/shared/src/format.ts` plus phone helpers used by the forms.
public enum Format {
    /// Groups digits with a regular space: 125000 → "125 000".
    public static func grouped(_ value: Int) -> String {
        let negative = value < 0
        var digits = String(abs(value))
        var out = ""
        while digits.count > 3 {
            out = " " + String(digits.suffix(3)) + out
            digits = String(digits.dropLast(3))
        }
        return (negative ? "-" : "") + digits + out
    }

    /// MAJOR-unit price: 125000 AZN → "125 000 ₼".
    public static func price(_ major: Double, _ currency: Currency) -> String {
        "\(grouped(Int(major.rounded()))) \(currency.symbol)"
    }

    public static func price(_ major: Int, _ currency: Currency) -> String { price(Double(major), currency) }

    /// MINOR-unit amount: 1050 → "10.50 ₼".
    public static func money(_ minor: Int, _ currency: Currency = .AZN) -> String {
        "\(decimal(minor)) \(currency.symbol)"
    }

    /// 1050 → "10.50" (always two decimals, dot separator like the web/admin).
    public static func decimal(_ minor: Int) -> String {
        let sign = minor < 0 ? "-" : ""
        let v = abs(minor)
        let cents = v % 100
        return "\(sign)\(grouped(v / 100)).\(cents < 10 ? "0" : "")\(cents)"
    }

    /// Parts for the "big quiet number" UI: symbol rendered muted and before the value.
    public struct Parts: Sendable, Hashable {
        public let symbol: String
        public let value: String
    }

    public static func priceParts(_ major: Int, _ currency: Currency) -> Parts {
        Parts(symbol: currency.symbol, value: grouped(major))
    }

    public static func moneyParts(_ minor: Int, _ currency: Currency = .AZN) -> Parts {
        Parts(symbol: currency.symbol, value: decimal(minor))
    }

    /// Compact price for map markers: 125000 → "125K", 1250000 → "1.3M".
    public static func shortPrice(_ n: Int) -> String {
        if n >= 1_000_000 {
            let v = (Double(n) / 1_000_000 * 10).rounded() / 10
            return v.rounded() == v ? "\(Int(v))M" : "\(v)M"
        }
        if n >= 10_000 { return "\(Int((Double(n) / 1000).rounded()))K" }
        return String(n)
    }

    /// "+994501234567" → "+994 50 123 45 67"
    public static func phone(_ e164: String) -> String {
        let d = Array(e164)
        guard d.count == 13, d.first == "+", d.dropFirst().allSatisfy(\.isNumber) else { return e164 }
        let s = String(d.dropFirst())
        let i = s.startIndex
        func sub(_ a: Int, _ b: Int) -> Substring { s[s.index(i, offsetBy: a)..<s.index(i, offsetBy: b)] }
        return "+\(sub(0, 3)) \(sub(3, 5)) \(sub(5, 8)) \(sub(8, 10)) \(sub(10, 12))"
    }

    /// "+994501234567" → "+994 50 123 ** **"
    public static func maskPhone(_ e164: String) -> String {
        let formatted = phone(e164)
        if formatted != e164 {
            return String(formatted.dropLast(5)) + "** **"
        }
        return e164.count > 4 ? String(e164.dropLast(4)) + "****" : e164
    }

    /// National digits after +994 (also accepts "0501234567"): "+994501234567" → "501234567".
    public static func localDigits(_ phone: String?) -> String {
        guard let phone else { return "" }
        var d = phone.filter(\.isNumber)
        if d.hasPrefix("994") && d.count == 12 { d.removeFirst(3) }
        if d.hasPrefix("0") { d.removeFirst() }
        return String(d.prefix(9))
    }

    /// Live formatting of the national part while typing: "501234567" → "50 123 45 67".
    public static func localPhone(_ digits: String) -> String {
        let d = Array(digits.filter(\.isNumber).prefix(9))
        var out = ""
        for (i, ch) in d.enumerated() {
            if i == 2 || i == 5 || i == 7 { out.append(" ") }
            out.append(ch)
        }
        return out
    }

    /// Sanitises user input for the national-number field (digits only, no leading 0, max 9).
    public static func sanitizeLocalInput(_ text: String) -> String {
        var d = text.filter(\.isNumber)
        if d.hasPrefix("994") && d.count > 9 { d.removeFirst(3) }
        while d.hasPrefix("0") { d.removeFirst() }
        return String(d.prefix(9))
    }

    public static func pricePerM2(_ price: Int, area: Double) -> Int {
        area > 0 ? Int((Double(price) / area).rounded()) : 0
    }

    /// Simple annuity mortgage monthly payment (major units).
    public static func mortgageMonthly(principal: Double, annualRatePercent: Double, years: Int) -> Double {
        let n = Double(years * 12)
        guard n > 0 else { return principal }
        let r = annualRatePercent / 100 / 12
        if r == 0 { return principal / n }
        return principal * r / (1 - pow(1 + r, -n))
    }

    /// Area without trailing ".0": 85.0 → "85", 85.5 → "85.5".
    public static func number(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
    }
}
