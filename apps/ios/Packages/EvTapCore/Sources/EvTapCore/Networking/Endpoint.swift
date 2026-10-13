import Foundation

public enum HTTPMethod: String, Sendable { case GET, POST, PATCH, PUT, DELETE }

/// Whether a request carries the bearer token.
public enum AuthRequirement: Sendable {
    /// Never sends a token (login, OTP, refresh).
    case none
    /// Sends the token when signed in (e.g. listing detail → `isFavorite`, `isOwner`).
    case optional
    /// Requires a session.
    case required
}

public struct QueryParam: Sendable, Hashable {
    public let name: String
    public let value: String
    public init(_ name: String, _ value: String) {
        self.name = name
        self.value = value
    }
}

/// One API call: method + path (relative to `/api/v1`) + query + JSON body, typed by its response.
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    public var method: HTTPMethod
    public var path: String
    public var query: [QueryParam]
    public var body: (any Encodable & Sendable)?
    public var auth: AuthRequirement

    public init(_ method: HTTPMethod, _ path: String, query: [QueryParam] = [], body: (any Encodable & Sendable)? = nil, auth: AuthRequirement = .required) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.auth = auth
    }
}

/// Builds query parameters the way the API's zod preprocessors expect them: arrays → CSV, nil/empty skipped.
public struct QueryBuilder: Sendable {
    public private(set) var params: [QueryParam] = []
    public init() {}

    public mutating func add(_ name: String, _ value: String?) {
        guard let value, !value.isEmpty else { return }
        params.append(QueryParam(name, value))
    }

    public mutating func add(_ name: String, _ value: Int?) { add(name, value.map(String.init)) }

    public mutating func add(_ name: String, _ value: Double?) {
        guard let value else { return }
        add(name, value.rounded() == value ? String(Int(value)) : String(value))
    }

    /// Only `true` is sent (the API treats a missing flag as "don't filter").
    public mutating func add(_ name: String, flag: Bool?) {
        if flag == true { add(name, "true") }
    }

    public mutating func add(_ name: String, csv values: [String]?) {
        guard let values, !values.isEmpty else { return }
        add(name, values.joined(separator: ","))
    }

    public mutating func add<E: RawRepresentable>(_ name: String, _ value: E?) where E.RawValue == String {
        add(name, value?.rawValue)
    }
}

/// Percent-encodes a path segment (ids are UUIDs, slugs are `[a-z0-9-]`, but tokens may contain anything).
func seg(_ s: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?#")
    return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
}
