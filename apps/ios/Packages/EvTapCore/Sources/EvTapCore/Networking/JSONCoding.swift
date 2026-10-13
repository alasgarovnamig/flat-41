import Foundation

/// JSON coders matching the API: ISO-8601 timestamps (with or without fractional seconds) and YYYY-MM-DD days.
public enum JSONCoding {
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let date = DateParsing.parse(s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Invalid ISO-8601 date: \(s)")
        }
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(DateParsing.isoString(date))
        }
        e.outputFormatting = [.sortedKeys]
        return e
    }
}

public enum DateParsing {
    private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let plain = Date.ISO8601FormatStyle()

    /// Parses "2026-10-13T14:05:42.123Z", "2026-10-13T14:05:42Z" and "2026-10-13" (UTC midnight).
    public static func parse(_ s: String) -> Date? {
        if let d = try? fractional.parse(s) { return d }
        if let d = try? plain.parse(s) { return d }
        if s.count == 10, let d = try? plain.parse(s + "T00:00:00Z") { return d }
        return nil
    }

    public static func isoString(_ date: Date) -> String {
        fractional.format(date)
    }
}
