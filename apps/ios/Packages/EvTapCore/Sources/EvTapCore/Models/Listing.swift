import Foundation

public struct ListingImage: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    /// Send back in `imageIds` when editing (contract v2).
    public let uploadId: String?
    public let url: String
    public let thumbUrl: String
    public let order: Int
}

public struct Upload: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let url: String
    public let thumbUrl: String
    public let mime: String
    public let size: Int
}

/// Compact representation for result lists, cards, carousels.
public struct ListingCard: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let dealType: DealType
    public let propertyType: PropertyType
    public let buildingType: BuildingType?
    /// MAJOR units (whole AZN / USD …).
    public let price: Int
    public let currency: Currency
    public let pricePeriod: PricePeriod
    public let country: CountryCode
    public let cityId: String
    public let districtId: String?
    public let metroId: String?
    public let address: String?
    /// m²
    public let area: Double
    /// sot (100 m²)
    public let landArea: Double?
    public let rooms: Int?
    public let floor: Int?
    public let totalFloors: Int?
    public let coverUrl: String?
    public let imagesCount: Int
    public let lat: Double?
    public let lng: Double?
    public let isVip: Bool
    public let isPremium: Bool
    public let isHighlighted: Bool
    public let isUrgent: Bool
    public let isVerified: Bool
    public let hasDocument: Bool
    public let mortgageAvailable: Bool
    public let isBusiness: Bool
    public let rating: Double?
    public let status: ListingStatus
    public let bumpedAt: Date
    public let publishedAt: Date?
    public let createdAt: Date
}

public struct ActivePromotion: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let type: PromotionType
    public let serviceCode: String
    public let startsAt: Date
    public let endsAt: Date?
    public let bumpsLeft: Int?
}

/// `GET /listings/:id` — card fields + detail fields (flat JSON).
@dynamicMemberLookup
public struct ListingDetail: Decodable, Sendable, Hashable, Identifiable {
    public let card: ListingCard
    public let description: String
    public let images: [ListingImage]
    public let bathrooms: Int?
    public let yearBuilt: Int?
    public let ceilingHeight: Double?
    public let repair: RepairType?
    public let amenities: [Amenity]
    public let maxGuests: Int?
    public let minNights: Int?
    public let checkInTime: String?
    public let checkOutTime: String?
    public let houseRules: String?
    public let contactName: String
    public let contactPhoneMasked: String
    /// Full number — only for the owner / admins; others use `POST /listings/:id/phone`.
    public let contactPhone: String?
    public let owner: PublicUser
    public let agency: AgencySummary?
    public let views: Int
    public let favoritesCount: Int
    public let reviewsCount: Int
    public let expiresAt: Date?
    public let rejectionReason: String?
    public let promotions: [ActivePromotion]
    public let isOwner: Bool
    public let isFavorite: Bool
    public let updatedAt: Date

    public var id: String { card.id }

    enum CodingKeys: String, CodingKey {
        case description, images, bathrooms, yearBuilt, ceilingHeight, repair, amenities, maxGuests, minNights
        case checkInTime, checkOutTime, houseRules, contactName, contactPhoneMasked, contactPhone, owner, agency
        case views, favoritesCount, reviewsCount, expiresAt, rejectionReason, promotions, isOwner, isFavorite, updatedAt
    }

    public init(from decoder: Decoder) throws {
        card = try ListingCard(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        images = try c.decodeIfPresent([ListingImage].self, forKey: .images) ?? []
        bathrooms = try c.decodeIfPresent(Int.self, forKey: .bathrooms)
        yearBuilt = try c.decodeIfPresent(Int.self, forKey: .yearBuilt)
        ceilingHeight = try c.decodeIfPresent(Double.self, forKey: .ceilingHeight)
        repair = try c.decodeIfPresent(RepairType.self, forKey: .repair)
        // Unknown amenity codes (newer API) are skipped instead of failing the whole listing.
        amenities = (try c.decodeIfPresent([String].self, forKey: .amenities) ?? []).compactMap(Amenity.init(rawValue:))
        maxGuests = try c.decodeIfPresent(Int.self, forKey: .maxGuests)
        minNights = try c.decodeIfPresent(Int.self, forKey: .minNights)
        checkInTime = try c.decodeIfPresent(String.self, forKey: .checkInTime)
        checkOutTime = try c.decodeIfPresent(String.self, forKey: .checkOutTime)
        houseRules = try c.decodeIfPresent(String.self, forKey: .houseRules)
        contactName = try c.decodeIfPresent(String.self, forKey: .contactName) ?? ""
        contactPhoneMasked = try c.decodeIfPresent(String.self, forKey: .contactPhoneMasked) ?? ""
        contactPhone = try c.decodeIfPresent(String.self, forKey: .contactPhone)
        owner = try c.decode(PublicUser.self, forKey: .owner)
        agency = try c.decodeIfPresent(AgencySummary.self, forKey: .agency)
        views = try c.decodeIfPresent(Int.self, forKey: .views) ?? 0
        favoritesCount = try c.decodeIfPresent(Int.self, forKey: .favoritesCount) ?? 0
        reviewsCount = try c.decodeIfPresent(Int.self, forKey: .reviewsCount) ?? 0
        expiresAt = try c.decodeIfPresent(Date.self, forKey: .expiresAt)
        rejectionReason = try c.decodeIfPresent(String.self, forKey: .rejectionReason)
        promotions = try c.decodeIfPresent([ActivePromotion].self, forKey: .promotions) ?? []
        isOwner = try c.decodeIfPresent(Bool.self, forKey: .isOwner) ?? false
        isFavorite = try c.decodeIfPresent(Bool.self, forKey: .isFavorite) ?? false
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? card.createdAt
    }

    public subscript<T>(dynamicMember keyPath: KeyPath<ListingCard, T>) -> T { card[keyPath: keyPath] }

    /// Images in display order (first = cover).
    public var orderedImages: [ListingImage] { images.sorted { $0.order < $1.order } }
}

/// Owner view in "My listings".
@dynamicMemberLookup
public struct MyListing: Decodable, Sendable, Hashable, Identifiable {
    public let card: ListingCard
    public let views: Int
    public let phoneViews: Int
    public let favoritesCount: Int
    public let expiresAt: Date?
    public let rejectionReason: String?
    public let promotions: [ActivePromotion]
    /// DRAFT waiting for the listing fee.
    public let requiresPayment: Bool

    public var id: String { card.id }

    enum CodingKeys: String, CodingKey { case views, phoneViews, favoritesCount, expiresAt, rejectionReason, promotions, requiresPayment }

    public init(from decoder: Decoder) throws {
        card = try ListingCard(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        views = try c.decodeIfPresent(Int.self, forKey: .views) ?? 0
        phoneViews = try c.decodeIfPresent(Int.self, forKey: .phoneViews) ?? 0
        favoritesCount = try c.decodeIfPresent(Int.self, forKey: .favoritesCount) ?? 0
        expiresAt = try c.decodeIfPresent(Date.self, forKey: .expiresAt)
        rejectionReason = try c.decodeIfPresent(String.self, forKey: .rejectionReason)
        promotions = try c.decodeIfPresent([ActivePromotion].self, forKey: .promotions) ?? []
        requiresPayment = try c.decodeIfPresent(Bool.self, forKey: .requiresPayment) ?? false
    }

    public subscript<T>(dynamicMember keyPath: KeyPath<ListingCard, T>) -> T { card[keyPath: keyPath] }
}

public struct ListingStats: Decodable, Sendable, Hashable {
    public struct Day: Decodable, Sendable, Hashable {
        /// YYYY-MM-DD
        public let date: String
        public let views: Int
        public let phoneViews: Int
    }

    public let views: Int
    public let phoneViews: Int
    public let favorites: Int
    public let messages: Int
    public let daily: [Day]
}

public struct MapPoint: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let lat: Double
    public let lng: Double
    public let price: Int
    public let currency: Currency
    public let pricePeriod: PricePeriod
    public let isVip: Bool
    public let isPremium: Bool
    public let title: String
    public let coverUrl: String?
}

public struct Availability: Codable, Sendable, Hashable {
    public struct BookedRange: Codable, Sendable, Hashable {
        /// YYYY-MM-DD (inclusive)
        public let checkIn: String
        /// YYYY-MM-DD (exclusive — the guest leaves that morning)
        public let checkOut: String
    }

    public let listingId: String
    /// YYYY-MM-DD dates blocked by the host.
    public let blockedDates: [String]
    public let bookedRanges: [BookedRange]

    /// Nights that cannot be booked: host-blocked dates + existing bookings (checkIn ≤ night < checkOut).
    public var unavailableNights: Set<String> {
        var s = Set(blockedDates)
        for r in bookedRanges {
            var d = r.checkIn
            var guardCounter = 0
            while d < r.checkOut, guardCounter < 1000 {
                s.insert(d)
                d = ISODay.adding(1, to: d)
                guardCounter += 1
            }
        }
        return s
    }

    /// Nights covered by bookings only (host calendar shows them as non-editable).
    public var bookedNights: Set<String> {
        Availability(listingId: listingId, blockedDates: [], bookedRanges: bookedRanges).unavailableNights
    }

    public init(listingId: String, blockedDates: [String], bookedRanges: [BookedRange]) {
        self.listingId = listingId
        self.blockedDates = blockedDates
        self.bookedRanges = bookedRanges
    }
}

public struct Review: Codable, Sendable, Hashable, Identifiable {
    public struct Author: Codable, Sendable, Hashable {
        public let id: String
        public let name: String
        public let avatarUrl: String?
    }

    public let id: String
    public let listingId: String
    public let bookingId: String
    public let author: Author
    public let rating: Int
    public let comment: String
    public let createdAt: Date
    public let hostReply: String?
}

public struct SavedSearch: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let query: [String: JSONValue]
    public let notify: Bool
    public let newMatches: Int
    public let createdAt: Date
}

public struct Banner: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let placement: BannerPlacement
    public let title: String
    public let imageUrl: String
    public let linkUrl: String
}
