import Foundation

/// Outcome of a refresh attempt.
public enum RefreshOutcome: Sendable, Equatable {
    /// New tokens stored.
    case refreshed
    /// Refresh token rejected (invalid / reused) — the session was cleared.
    case loggedOut
    /// Network / 5xx — tokens kept, only the current request fails.
    case failed
}

/// Owns the session tokens. Refresh is single-flight: concurrent 401s share one `POST /auth/refresh`.
public actor TokenManager {
    public typealias Refresher = @Sendable (_ refreshToken: String) async throws -> AuthTokens

    private let store: AuthStore
    private var tokens: AuthTokens?
    private var inFlight: Task<RefreshOutcome, Never>?
    private var observers: [UUID: @Sendable (AuthTokens?) -> Void] = [:]

    public init(store: AuthStore) {
        self.store = store
        self.tokens = store.load()
    }

    public var current: AuthTokens? { tokens }
    public var accessToken: String? { tokens?.accessToken }
    public var isSignedIn: Bool { tokens != nil }

    public func set(_ new: AuthTokens?) {
        tokens = new
        if let new { store.save(new) } else { store.clear() }
        for o in observers.values { o(new) }
    }

    /// Called with the new tokens (or nil on logout) after every change. Returns a token for `removeObserver`.
    @discardableResult
    public func addObserver(_ fn: @escaping @Sendable (AuthTokens?) -> Void) -> UUID {
        let id = UUID()
        observers[id] = fn
        return id
    }

    public func removeObserver(_ id: UUID) { observers[id] = nil }

    /// Refreshes the session. `failedAccessToken` is the token the caller got a 401 with: when another request
    /// already rotated it, this returns `.refreshed` immediately without a second network call.
    public func refresh(failedAccessToken: String?, using refresher: @escaping Refresher) async -> RefreshOutcome {
        if let failedAccessToken, let current = tokens?.accessToken, current != failedAccessToken { return .refreshed }
        if let inFlight { return await inFlight.value }
        guard let refreshToken = tokens?.refreshToken else { return .loggedOut }
        let task = Task<RefreshOutcome, Never> {
            do {
                let new = try await refresher(refreshToken)
                await self.set(new)
                return .refreshed
            } catch let e as APIError where !e.isNetwork && e.status > 0 && e.status < 500 {
                // 400/401/403: refresh token invalid or reused → the session is over.
                await self.set(nil)
                return .loggedOut
            } catch {
                return .failed
            }
        }
        inFlight = task
        let outcome = await task.value
        inFlight = nil
        return outcome
    }
}
