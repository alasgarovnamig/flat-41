import Foundation
#if canImport(Security)
import Security
#endif

/// Persists the session tokens. Keychain on Apple platforms, in-memory elsewhere (tests / Linux).
public protocol AuthStore: Sendable {
    func load() -> AuthTokens?
    func save(_ tokens: AuthTokens)
    func clear()
}

/// Thread-safe in-memory store (unit tests, previews, Linux).
public final class InMemoryAuthStore: AuthStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: AuthTokens?

    public init(_ tokens: AuthTokens? = nil) { self.tokens = tokens }

    public func load() -> AuthTokens? {
        lock.lock(); defer { lock.unlock() }
        return tokens
    }

    public func save(_ tokens: AuthTokens) {
        lock.lock(); defer { lock.unlock() }
        self.tokens = tokens
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        tokens = nil
    }
}

#if canImport(Security)
/// Keychain-backed store (`kSecClassGenericPassword`, this-device-only, available after first unlock so
/// background refreshes / push handling still work while the phone is locked).
public final class KeychainAuthStore: AuthStore, @unchecked Sendable {
    private let service: String
    private let account = "session"

    public init(service: String = "az.evtap.app.auth") { self.service = service }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() -> AuthTokens? {
        var q = baseQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(AuthTokens.self, from: data)
    }

    public func save(_ tokens: AuthTokens) {
        guard let data = try? JSONEncoder().encode(tokens) else { return }
        let attrs: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(baseQuery as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery
            add.merge(attrs) { _, new in new }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
#endif
