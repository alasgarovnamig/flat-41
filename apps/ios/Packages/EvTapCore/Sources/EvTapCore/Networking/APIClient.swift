import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Typed async/await client for the EvTap API.
///  - base: `${API_BASE_URL}/api/v1`, JSON in/out, `Accept-Language` from the app language
///  - bearer auth; on 401 the token is refreshed once (single-flight, see `TokenManager`) and the request retried
///  - errors are thrown as `APIError` (with the contract's `code`)
public final class APIClient: Sendable {
    /// API origin, e.g. `http://localhost:4000` (no `/api/v1`).
    public let origin: URL
    public let tokens: TokenManager
    private let transport: HTTPTransport
    private let language: @Sendable () -> String
    private let timeout: TimeInterval

    public init(origin: URL, tokens: TokenManager, transport: HTTPTransport = URLSessionTransport(), timeout: TimeInterval = 30,
                language: @escaping @Sendable () -> String = { Lang.default.rawValue }) {
        self.origin = origin
        self.tokens = tokens
        self.transport = transport
        self.timeout = timeout
        self.language = language
    }

    // MARK: Requests

    /// Performs `endpoint` and decodes its response.
    public func send<T>(_ endpoint: Endpoint<T>) async throws -> T {
        let body = try endpoint.body.map { try JSONCoding.encoder().encode($0) }
        let data = try await perform(method: endpoint.method, path: endpoint.path, query: endpoint.query, auth: endpoint.auth) { request in
            if let body {
                request.httpBody = body
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }
        return try decode(T.self, from: data)
    }

    /// `POST /uploads` — multipart field `file` (jpeg/png/webp ≤ 10MB).
    public func upload(_ data: Data, filename: String = "photo.jpg", mimeType: String = "image/jpeg") async throws -> Upload {
        let form = MultipartForm(fileField: "file", filename: filename, mimeType: mimeType, data: data)
        let out = try await perform(method: .POST, path: "/uploads", query: [], auth: .required) { request in
            request.httpBody = form.body
            request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        }
        return try decode(Upload.self, from: out)
    }

    /// Resolves API-relative media paths (`/uploads/…` when the API stores files locally) to absolute URLs.
    public func mediaURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") || path.hasPrefix("file:") || path.hasPrefix("data:") {
            return URL(string: path)
        }
        let rel = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return URL(string: rel, relativeTo: origin.appendingPathComponent(""))?.absoluteURL
    }

    /// The URL a request for `path` + `query` goes to (exposed for tests and debugging).
    public func url(path: String, query: [QueryParam]) -> URL? {
        var comps = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        let basePath = comps?.path.hasSuffix("/") == true ? String(comps!.path.dropLast()) : (comps?.path ?? "")
        comps?.path = basePath + API.prefix + path
        if !query.isEmpty {
            comps?.queryItems = query.map { URLQueryItem(name: $0.name, value: $0.value) }
            // URLComponents leaves "+" and "," as-is; encode "+" so phone numbers / ISO dates survive.
            comps?.percentEncodedQuery = comps?.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        return comps?.url
    }

    // MARK: Internals

    private func perform(method: HTTPMethod, path: String, query: [QueryParam], auth: AuthRequirement,
                         configure: (inout URLRequest) -> Void) async throws -> Data {
        guard let url = url(path: path, query: query) else { throw APIError(status: -1, code: "BAD_URL", messages: [path]) }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(language(), forHTTPHeaderField: "Accept-Language")
        configure(&request)

        let token = auth == .none ? nil : await tokens.accessToken
        if auth == .required, token == nil { throw APIError(status: 401, code: "UNAUTHORIZED", messages: ["Not signed in"]) }

        var (data, response) = try await execute(request, token: token)
        if response.statusCode == 401, auth != .none, let token {
            let outcome = await tokens.refresh(failedAccessToken: token) { [weak self] refreshToken in
                guard let self else { throw APIError.network }
                return try await self.refreshCall(refreshToken)
            }
            let fresh = await tokens.accessToken
            if outcome == .refreshed, let fresh {
                (data, response) = try await execute(request, token: fresh)
            }
        }
        guard (200..<300).contains(response.statusCode) else { throw Self.error(status: response.statusCode, data: data) }
        return data
    }

    private func execute(_ base: URLRequest, token: String?) async throws -> (Data, HTTPURLResponse) {
        var request = base
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        do {
            return try await transport.perform(request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as URLError where e.code == .cancelled {
            throw CancellationError()
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError.network
        }
    }

    /// `POST /auth/refresh` without the auth/retry machinery (used by `TokenManager`).
    private func refreshCall(_ refreshToken: String) async throws -> AuthTokens {
        let endpoint = API.refresh(refreshToken: refreshToken)
        guard let url = url(path: endpoint.path, query: []) else { throw APIError.network }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONCoding.encoder().encode(RefreshBody(refreshToken: refreshToken))
        let (data, response) = try await execute(request, token: nil)
        guard (200..<300).contains(response.statusCode) else { throw Self.error(status: response.statusCode, data: data) }
        return try decode(AuthResponse.self, from: data).tokens
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        // `null` / empty bodies decode as Optional.none.
        let payload = data.isEmpty ? Data("null".utf8) : data
        do {
            return try JSONCoding.decoder().decode(T.self, from: payload)
        } catch {
            throw APIError(status: -1, code: "DECODING", messages: [String(describing: error)])
        }
    }

    static func error(status: Int, data: Data) -> APIError {
        let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
        return APIError(status: status, code: body?.code, messages: body?.message ?? [])
    }
}
