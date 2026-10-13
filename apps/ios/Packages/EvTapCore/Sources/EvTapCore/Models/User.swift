import Foundation

public struct User: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let phone: String?
    public let email: String?
    public let avatarUrl: String?
    public let role: UserRole
    public let accountType: AccountType
    public let status: UserStatus
    public let locale: Lang
    public let isPhoneVerified: Bool
    public let isEmailVerified: Bool
    public let agencyId: String?
    public let createdAt: Date
}

public struct PublicUser: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let avatarUrl: String?
    public let accountType: AccountType
    public let agency: AgencySummary?
    public let memberSince: Date
    public let activeListings: Int
    public let rating: Double?
    public let reviewsCount: Int
}

public struct WalletSummary: Codable, Sendable, Hashable {
    public let balance: Int
    public let bonusBalance: Int
    public let currency: Currency
    /// Spendable total (minor units): bonus balance is spent first.
    public var spendable: Int { balance + bonusBalance }
}

public struct ListingQuota: Codable, Sendable, Hashable {
    /// Free listings per 30 days (individual) or plan quota (business, -1 unlimited).
    public let freeLimit: Int
    public let used: Int
    /// -1 = unlimited.
    public let remaining: Int
    /// Minor units, charged when `remaining == 0`.
    public let listingFee: Int
    public var isUnlimited: Bool { remaining == -1 }
}

/// `GET /auth/me` — `User` plus wallet, subscription, quota and unread counters (flat JSON).
@dynamicMemberLookup
public struct Me: Decodable, Sendable, Hashable {
    public let user: User
    public let wallet: WalletSummary
    public let subscription: Subscription?
    public let quota: ListingQuota
    public let unreadMessages: Int
    public let unreadNotifications: Int

    enum CodingKeys: String, CodingKey { case wallet, subscription, quota, unreadMessages, unreadNotifications }

    public init(from decoder: Decoder) throws {
        user = try User(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        wallet = try c.decode(WalletSummary.self, forKey: .wallet)
        subscription = try c.decodeIfPresent(Subscription.self, forKey: .subscription)
        quota = try c.decode(ListingQuota.self, forKey: .quota)
        unreadMessages = try c.decodeIfPresent(Int.self, forKey: .unreadMessages) ?? 0
        unreadNotifications = try c.decodeIfPresent(Int.self, forKey: .unreadNotifications) ?? 0
    }

    public subscript<T>(dynamicMember keyPath: KeyPath<User, T>) -> T { user[keyPath: keyPath] }

    public var isBusiness: Bool { user.accountType == .BUSINESS }

    /// Subscription that still grants credits (active or cancelled-but-not-ended).
    public var activeSubscription: Subscription? {
        guard let s = subscription, s.status != .EXPIRED else { return nil }
        return s
    }
}

public struct AuthTokens: Codable, Sendable, Hashable {
    public let accessToken: String
    public let refreshToken: String
    public init(accessToken: String, refreshToken: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
}

public struct AuthResponse: Decodable, Sendable, Hashable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public let user: User
    public let isNew: Bool?

    public var tokens: AuthTokens { AuthTokens(accessToken: accessToken, refreshToken: refreshToken) }
}

public struct OtpRequestResponse: Decodable, Sendable, Hashable {
    public let sent: Bool
    public let retryAfter: Int?
    /// Only when the API runs with NODE_ENV != production.
    public let devCode: String?
}

// MARK: - Agencies

public struct AgencySummary: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let slug: String
    public let logoUrl: String?
    public let type: AgencyType
    public let verified: Bool
}

public struct Agency: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let slug: String
    public let logoUrl: String?
    public let type: AgencyType
    public let verified: Bool
    public let description: String?
    public let phone: String?
    public let email: String?
    public let website: String?
    public let address: String?
    public let cityId: String?
    public let ownerId: String
    public let activeListings: Int
    public let createdAt: Date
}

public struct AgencyMember: Codable, Sendable, Hashable, Identifiable {
    public var id: String { userId }
    public let userId: String
    public let name: String
    public let phone: String?
    public let email: String?
    public let avatarUrl: String?
    public let role: AgencyMemberRole
    public let activeListings: Int
    public let joinedAt: Date
}

public struct TimeseriesPoint: Decodable, Sendable, Hashable {
    public let date: String
    public let value: Double
}

public struct AgencyStats: Decodable, Sendable, Hashable {
    public let views: Int
    public let phoneViews: Int
    public let messages: Int
    public let listings: Int
    public let daily: [TimeseriesPoint]
}
