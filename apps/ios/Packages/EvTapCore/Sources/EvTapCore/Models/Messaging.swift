import Foundation

public struct Message: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let conversationId: String
    public let senderId: String
    public let body: String
    public let createdAt: Date
    public var readAt: Date?

    public init(id: String, conversationId: String, senderId: String, body: String, createdAt: Date, readAt: Date?) {
        self.id = id
        self.conversationId = conversationId
        self.senderId = senderId
        self.body = body
        self.createdAt = createdAt
        self.readAt = readAt
    }
}

public struct Conversation: Codable, Sendable, Hashable, Identifiable {
    public struct ListingRef: Codable, Sendable, Hashable {
        public let id: String
        public let title: String
        public let coverUrl: String?
        public let price: Int
        public let currency: Currency
        public let pricePeriod: PricePeriod
        public let status: ListingStatus
    }

    public struct OtherUser: Codable, Sendable, Hashable {
        public let id: String
        public let name: String
        public let avatarUrl: String?
    }

    public let id: String
    public let listing: ListingRef
    public let otherUser: OtherUser
    public var lastMessage: Message?
    public var unreadCount: Int
    public var updatedAt: Date
}

// MARK: - Notifications

public struct AppNotification: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    /// Raw type (unknown future types still decode); see `kind`.
    public let type: String
    public let title: String
    public let body: String
    public let data: [String: JSONValue]
    public var readAt: Date?
    public let createdAt: Date

    public var kind: NotificationType? { NotificationType(rawValue: type) }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decode(String.self, forKey: .type)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        data = (try? c.decodeIfPresent([String: JSONValue].self, forKey: .data)) ?? [:]
        readAt = try c.decodeIfPresent(Date.self, forKey: .readAt)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
    }
}

// MARK: - Realtime payloads

public struct ConversationReadEvent: Codable, Sendable, Hashable {
    public let conversationId: String
    public let readerId: String
    public let readAt: Date
}

public struct TypingEvent: Codable, Sendable, Hashable {
    public let conversationId: String
    public let userId: String?
}

// MARK: - CMS

public struct CmsPage: Codable, Sendable, Hashable {
    public let slug: String
    public let title: LocalizedText
    /// Markdown.
    public let body: LocalizedText
    public let updatedAt: Date
}

/// `GET /pages` row (title already localised by `?locale=`).
public struct CmsPageSummary: Codable, Sendable, Hashable, Identifiable {
    public var id: String { slug }
    public let slug: String
    public let title: String
}

// MARK: - Mortgage

public struct MortgageBank: Codable, Sendable, Hashable, Identifiable {
    public var id: String { code }
    public let code: String
    public let name: String
    public let logoUrl: String?
    public let annualRate: Double
    public let maxTermYears: Int
    public let minDownPaymentPercent: Double
}
