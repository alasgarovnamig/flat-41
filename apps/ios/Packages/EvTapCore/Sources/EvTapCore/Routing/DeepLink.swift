import Foundation

/// Incoming links: `evtap://…` (custom scheme, push payloads) and `https://evtap.az/…` (universal links).
public enum DeepLink: Sendable, Equatable {
    case listing(id: String)
    /// `evtap://payment/result?paymentId=..&status=..` — `status` is only a hint, the app polls `GET /payments/:id`.
    case paymentResult(paymentId: String, status: String?)
    case booking(id: String)
    case conversation(id: String)
    case search(ListingFilters)
    case page(slug: String)
    case notifications
    case wallet
    case myListings

    public static let scheme = "evtap"
    public static let paymentReturnURL = "evtap://payment/result"
    public static let webHosts: Set<String> = ["evtap.az", "www.evtap.az"]

    public static func parse(_ url: URL) -> DeepLink? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        var segments: [String]
        switch comps.scheme?.lowercased() {
        case scheme:
            // evtap://listing/<id> → host = "listing", path = "/<id>"
            segments = [comps.host].compactMap { $0 } + comps.path.split(separator: "/").map(String.init)
        case "https", "http":
            guard let host = comps.host?.lowercased(), webHosts.contains(host) else { return nil }
            segments = comps.path.split(separator: "/").map(String.init)
            // Localised web routes: /ru/listing/<id>, /en/…
            if let first = segments.first, Lang(rawValue: first) != nil { segments.removeFirst() }
        default:
            return nil
        }
        let query = Dictionary((comps.queryItems ?? []).compactMap { item in item.value.map { (item.name, $0) } }, uniquingKeysWith: { a, _ in a })
        return route(segments: segments, query: query)
    }

    /// Notification payload `data` → link. The API sends one of: `url`, `conversationId`, `paymentId`, `bookingId`, `listingId`.
    public static func from(notificationData data: [String: JSONValue]) -> DeepLink? {
        if let s = data["url"]?.stringValue, let url = URL(string: s), let link = parse(url) { return link }
        if let id = data["conversationId"]?.stringValue { return .conversation(id: id) }
        if let id = data["paymentId"]?.stringValue { return .paymentResult(paymentId: id, status: data["status"]?.stringValue) }
        if let id = data["bookingId"]?.stringValue { return .booking(id: id) }
        if let id = data["listingId"]?.stringValue { return .listing(id: id) }
        return nil
    }

    static func route(segments: [String], query: [String: String]) -> DeepLink? {
        switch (segments.first, segments.count) {
        case ("listing"?, 2), ("listings"?, 2), ("elan"?, 2):
            return .listing(id: segments[1])
        case ("payment"?, 2) where segments[1] == "result":
            guard let id = query["paymentId"], !id.isEmpty else { return nil }
            return .paymentResult(paymentId: id, status: query["status"])
        case ("booking"?, 2), ("bookings"?, 2):
            return .booking(id: segments[1])
        case ("chat"?, 2), ("messages"?, 2), ("conversations"?, 2):
            return .conversation(id: segments[1])
        case ("page"?, 2), ("pages"?, 2):
            return .page(slug: segments[1])
        case ("search"?, 1):
            return .search(ListingFilters(savedQuery: query.mapValues { JSONValue.string($0) }))
        case ("notifications"?, 1):
            return .notifications
        case ("wallet"?, 1):
            return .wallet
        case ("me"?, 2):
            switch segments[1] {
            case "notifications": return .notifications
            case "wallet": return .wallet
            case "listings": return .myListings
            default: return nil
            }
        default:
            return nil
        }
    }
}
