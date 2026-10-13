import Foundation

/// Build-configuration values (Config/*.xcconfig → Info.plist → here).
enum AppConfig {
    /// API origin without `/api/v1`: Debug `http://localhost:4000`, Release `https://api.evtap.az`.
    static let apiOrigin: URL = url(forKey: "API_BASE_URL") ?? URL(string: "http://localhost:4000")!

    /// Public website (share links, universal links).
    static let webOrigin: URL = url(forKey: "WEB_BASE_URL") ?? URL(string: "https://evtap.az")!

    static let version: String = {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(v) (\(b))"
    }()

    static let isDebug = buildIsDebug

    static func listingWebURL(_ id: String) -> URL { webOrigin.appendingPathComponent("listing").appendingPathComponent(id) }

    private static func url(forKey key: String) -> URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: key) as? String, !s.isEmpty, !s.hasPrefix("$(") else { return nil }
        return URL(string: s.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")))
    }
}

#if DEBUG
private let buildIsDebug = true
#else
private let buildIsDebug = false
#endif
