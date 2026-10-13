import Foundation

/// Arbitrary JSON (used for `SavedSearch.query`, `AppNotification.data`, …).
public enum JSONValue: Codable, Sendable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n):
            if n.rounded() == n, abs(n) < 1e15 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .bool(let b): try c.encode(b)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }

    public var stringValue: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return n.rounded() == n ? String(Int64(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    public var doubleValue: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)
        default: return nil
        }
    }

    public var intValue: Int? { doubleValue.map { Int($0) } }

    public var boolValue: Bool? {
        switch self {
        case .bool(let b): return b
        case .string(let s): return s == "true" || s == "1" ? true : (s == "false" || s == "0" ? false : nil)
        case .number(let n): return n != 0
        default: return nil
        }
    }

    /// Arrays, or CSV strings (the API's `csv()` query preprocessor accepts both).
    public var stringArray: [String]? {
        switch self {
        case .array(let a): return a.compactMap(\.stringValue)
        case .string(let s): return s.split(separator: ",").map(String.init).filter { !$0.isEmpty }
        default: return nil
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }
}

/// `{ az, ru, en }` localized text from the API (catalog names, CMS pages, …).
public struct LocalizedText: Codable, Sendable, Hashable {
    public var az: String
    public var ru: String
    public var en: String

    public init(az: String, ru: String, en: String) {
        self.az = az
        self.ru = ru
        self.en = en
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        az = try c.decodeIfPresent(String.self, forKey: .az) ?? ""
        ru = try c.decodeIfPresent(String.self, forKey: .ru) ?? ""
        en = try c.decodeIfPresent(String.self, forKey: .en) ?? ""
    }

    /// The text in `lang`, falling back to Azerbaijani (the default locale) when empty.
    public func resolve(_ lang: Lang) -> String {
        let v: String
        switch lang {
        case .az: v = az
        case .ru: v = ru
        case .en: v = en
        }
        return v.isEmpty ? az : v
    }
}

public struct OkResponse: Codable, Sendable, Hashable { public let ok: Bool }
public struct IdResponse: Codable, Sendable, Hashable { public let id: String }
public struct CountResponse: Codable, Sendable, Hashable { public let count: Int }
public struct PhoneResponse: Codable, Sendable, Hashable { public let phone: String }
public struct EmptyBody: Codable, Sendable, Hashable { public init() {} }

public struct Paginated<T: Decodable & Sendable>: Decodable, Sendable {
    public let items: [T]
    public let total: Int
    public let page: Int
    public let pageSize: Int

    public init(items: [T], total: Int, page: Int, pageSize: Int) {
        self.items = items
        self.total = total
        self.page = page
        self.pageSize = pageSize
    }

    public var hasMore: Bool { page * pageSize < total }
}
