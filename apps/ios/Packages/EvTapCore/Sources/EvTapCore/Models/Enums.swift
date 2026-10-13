import Foundation

// Domain enums — mirror `packages/shared/src/enums.ts` (raw values are the wire values).

public enum Lang: String, Codable, Sendable, CaseIterable, Identifiable {
    case az, ru, en
    public var id: String { rawValue }
    public static let `default`: Lang = .az

    /// Pick the best supported language for a list of preferred BCP-47 identifiers (e.g. `Locale.preferredLanguages`).
    public static func best(for preferred: [String]) -> Lang {
        for id in preferred {
            let code = id.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init)?.lowercased() ?? ""
            if let lang = Lang(rawValue: code) { return lang }
        }
        return .default
    }

    /// Native name shown in the language picker.
    public var nativeName: String {
        switch self {
        case .az: return "Azərbaycanca"
        case .ru: return "Русский"
        case .en: return "English"
        }
    }
}

public enum Currency: String, Codable, Sendable, CaseIterable, Identifiable {
    case AZN, USD, EUR, GEL
    public var id: String { rawValue }
    public var symbol: String {
        switch self {
        case .AZN: return "₼"
        case .USD: return "$"
        case .EUR: return "€"
        case .GEL: return "₾"
        }
    }
}

public enum CountryCode: String, Codable, Sendable, CaseIterable { case AZ, GE }

public enum UserRole: String, Codable, Sendable, CaseIterable { case USER, MODERATOR, ADMIN }
public enum AccountType: String, Codable, Sendable, CaseIterable { case INDIVIDUAL, BUSINESS }
public enum UserStatus: String, Codable, Sendable, CaseIterable { case ACTIVE, BLOCKED, DELETED }
public enum AgencyType: String, Codable, Sendable, CaseIterable { case AGENCY, DEVELOPER }
public enum AgencyMemberRole: String, Codable, Sendable, CaseIterable { case OWNER, AGENT }

/// Sale, long-term rent (monthly) and daily / short-term rent (Airbnb-style, bookable online).
public enum DealType: String, Codable, Sendable, CaseIterable, Identifiable {
    case SALE, RENT_LONG, RENT_DAILY
    public var id: String { rawValue }
}

public enum PropertyType: String, Codable, Sendable, CaseIterable, Identifiable {
    case APARTMENT, HOUSE, OFFICE, COMMERCIAL, LAND, GARAGE, ROOM
    public var id: String { rawValue }
    /// Types for which the schema requires `rooms`.
    public var requiresRooms: Bool { self == .APARTMENT || self == .HOUSE || self == .ROOM }
}

public enum BuildingType: String, Codable, Sendable, CaseIterable, Identifiable {
    case NEW, SECONDARY
    public var id: String { rawValue }
}

public enum RepairType: String, Codable, Sendable, CaseIterable, Identifiable {
    case NONE, COSMETIC, EURO, DESIGNER
    public var id: String { rawValue }
}

public enum PricePeriod: String, Codable, Sendable, CaseIterable { case TOTAL, MONTH, DAY }

public enum ListingStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case DRAFT, PENDING, ACTIVE, REJECTED, EXPIRED, ARCHIVED, SOLD, BLOCKED
    public var id: String { rawValue }
}

public enum Amenity: String, Codable, Sendable, CaseIterable, Identifiable {
    case BALCONY, PARKING, ELEVATOR, FURNITURE, KITCHEN_FURNITURE, INTERNET, WIFI, AIR_CONDITIONER, CENTRAL_HEATING
    case KOMBI, GAS, WATER, ELECTRICITY, WASHING_MACHINE, DISHWASHER, REFRIGERATOR, TV, POOL, GARDEN, SECURITY
    case CCTV, SEA_VIEW, PETS_ALLOWED, KIDS_ALLOWED, SMOKING_ALLOWED, SAUNA, BBQ
    public var id: String { rawValue }
}

public enum ListingSort: String, Codable, Sendable, CaseIterable, Identifiable {
    case dateDesc = "date_desc"
    case priceAsc = "price_asc"
    case priceDesc = "price_desc"
    case areaAsc = "area_asc"
    case areaDesc = "area_desc"
    public var id: String { rawValue }
}

public enum PromotionType: String, Codable, Sendable, CaseIterable { case BUMP, AUTO_BUMP, VIP, PREMIUM, HIGHLIGHT, URGENT }

public enum PaymentPurpose: String, Codable, Sendable, CaseIterable {
    case WALLET_TOPUP, PROMOTION, LISTING_FEE, SUBSCRIPTION, BOOKING, VERIFICATION
}

public enum PaymentMethod: String, Codable, Sendable, CaseIterable, Identifiable {
    case CARD, WALLET
    public var id: String { rawValue }
}

public enum PaymentStatus: String, Codable, Sendable, CaseIterable {
    case CREATED, PENDING, SUCCEEDED, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED
    /// Statuses after which polling stops.
    public var isFinal: Bool {
        switch self {
        case .SUCCEEDED, .FAILED, .CANCELLED, .REFUNDED, .PARTIALLY_REFUNDED: return true
        case .CREATED, .PENDING: return false
        }
    }
}

public enum WalletTxType: String, Codable, Sendable, CaseIterable { case TOPUP, BONUS, SPEND, REFUND, PAYOUT, ADJUSTMENT }
public enum SubscriptionStatus: String, Codable, Sendable, CaseIterable { case ACTIVE, CANCELLED, EXPIRED, PAST_DUE }

public enum BillingPeriod: String, Codable, Sendable, CaseIterable, Identifiable {
    case MONTH, YEAR
    public var id: String { rawValue }
}

public enum BookingStatus: String, Codable, Sendable, CaseIterable { case PENDING_PAYMENT, CONFIRMED, CANCELLED, COMPLETED, REFUNDED }
public enum PayoutStatus: String, Codable, Sendable, CaseIterable { case NOT_DUE, PENDING, PAID, CANCELLED }
public enum CancelledBy: String, Codable, Sendable, CaseIterable { case GUEST, HOST, ADMIN }

public enum ReportReason: String, Codable, Sendable, CaseIterable, Identifiable {
    case FAKE, WRONG_PRICE, WRONG_PHOTOS, ALREADY_SOLD, AGENT_AS_OWNER, DUPLICATE, FRAUD, OTHER
    public var id: String { rawValue }
}

public enum NotificationType: String, Codable, Sendable, CaseIterable {
    case LISTING_APPROVED, LISTING_REJECTED, LISTING_EXPIRING, LISTING_EXPIRED, NEW_MESSAGE, PAYMENT_SUCCEEDED, PAYMENT_FAILED
    case BOOKING_NEW, BOOKING_CONFIRMED, BOOKING_CANCELLED, PAYOUT, SAVED_SEARCH_MATCH, PROMOTION_EXPIRED
    case SUBSCRIPTION_RENEWED, SUBSCRIPTION_EXPIRED, SYSTEM
}

public enum BannerPlacement: String, Codable, Sendable, CaseIterable { case HOME_TOP, SEARCH_TOP, SEARCH_SIDEBAR, LISTING_SIDEBAR, MOBILE_HOME }

public enum DevicePlatform: String, Codable, Sendable { case ios, android, web }

public enum PlanCode: String, Codable, Sendable, CaseIterable { case START, PRO, ENTERPRISE }

/// Subscription credits that can be spent on a listing (`POST /listings/:id/apply-credit`).
public enum CreditKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case BUMP, VIP_7, PREMIUM_7
    public var id: String { rawValue }
}

public enum ListingAction: String, Codable, Sendable, CaseIterable { case MARK_SOLD, ARCHIVE, RENEW, RESTORE }

public enum OwnerType: String, Codable, Sendable, CaseIterable, Identifiable {
    case OWNER, BUSINESS
    public var id: String { rawValue }
}

public enum BookingRole: String, Codable, Sendable, CaseIterable, Identifiable {
    case guest, host
    public var id: String { rawValue }
}

public enum FeaturedKind: String, Codable, Sendable { case vip, premium }
