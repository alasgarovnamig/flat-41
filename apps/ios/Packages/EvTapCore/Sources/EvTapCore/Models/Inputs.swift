import Foundation

// Request bodies — mirror the zod schemas in `packages/shared/src/schemas.ts`.

public struct PhoneBody: Encodable, Sendable { public let phone: String }

public struct OtpVerifyInput: Encodable, Sendable {
    public let phone: String
    public let code: String
    public let name: String?
    public init(phone: String, code: String, name: String?) {
        self.phone = phone
        self.code = code
        self.name = name
    }
}

public struct RegisterInput: Encodable, Sendable {
    public let name: String
    public let email: String
    public let password: String
    public let phone: String?
    public init(name: String, email: String, password: String, phone: String? = nil) {
        self.name = name
        self.email = email
        self.password = password
        self.phone = phone
    }
}

public struct LoginInput: Encodable, Sendable {
    public let login: String
    public let password: String
    public init(login: String, password: String) {
        self.login = login
        self.password = password
    }
}

public struct RefreshBody: Encodable, Sendable { public let refreshToken: String }

public struct UpdateMeInput: Encodable, Sendable {
    public var name: String?
    public var email: String?
    /// `.some(nil)` clears the avatar.
    public var avatarUrl: String??
    public var locale: Lang?

    public init(name: String? = nil, email: String? = nil, avatarUrl: String?? = nil, locale: Lang? = nil) {
        self.name = name
        self.email = email
        self.avatarUrl = avatarUrl
        self.locale = locale
    }

    enum CodingKeys: String, CodingKey { case name, email, avatarUrl, locale }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(email, forKey: .email)
        if let avatarUrl { try c.encode(avatarUrl, forKey: .avatarUrl) }
        try c.encodeIfPresent(locale, forKey: .locale)
    }
}

public struct ChangePasswordInput: Encodable, Sendable {
    public let currentPassword: String?
    public let newPassword: String
}

public struct PushTokenInput: Encodable, Sendable {
    public let token: String
    public let platform: DevicePlatform
    public init(token: String, platform: DevicePlatform) {
        self.token = token
        self.platform = platform
    }
}

/// Create (`POST /listings`) and edit (`PATCH /listings/:id`) payload. Optional fields are sent as explicit
/// `null` so editing can clear them (the PATCH schema is `partial()` of the nullable base).
public struct ListingInput: Encodable, Sendable, Equatable {
    public var dealType: DealType
    public var propertyType: PropertyType
    public var buildingType: BuildingType?
    public var title: String
    public var description: String
    public var price: Int
    public var currency: Currency
    public var cityId: String
    public var districtId: String?
    public var metroId: String?
    public var address: String?
    public var lat: Double?
    public var lng: Double?
    public var area: Double
    public var landArea: Double?
    public var rooms: Int?
    public var bathrooms: Int?
    public var floor: Int?
    public var totalFloors: Int?
    public var yearBuilt: Int?
    public var ceilingHeight: Double?
    public var repair: RepairType?
    public var hasDocument: Bool
    public var mortgageAvailable: Bool
    public var amenities: [Amenity]
    public var maxGuests: Int?
    public var minNights: Int?
    public var checkInTime: String?
    public var checkOutTime: String?
    public var houseRules: String?
    public var contactName: String
    public var contactPhone: String
    /// Ordered upload ids; first = cover.
    public var imageIds: [String]

    public init(dealType: DealType, propertyType: PropertyType, buildingType: BuildingType? = nil, title: String, description: String,
                price: Int, currency: Currency = .AZN, cityId: String, districtId: String? = nil, metroId: String? = nil,
                address: String? = nil, lat: Double? = nil, lng: Double? = nil, area: Double, landArea: Double? = nil,
                rooms: Int? = nil, bathrooms: Int? = nil, floor: Int? = nil, totalFloors: Int? = nil, yearBuilt: Int? = nil,
                ceilingHeight: Double? = nil, repair: RepairType? = nil, hasDocument: Bool = false, mortgageAvailable: Bool = false,
                amenities: [Amenity] = [], maxGuests: Int? = nil, minNights: Int? = nil, checkInTime: String? = nil,
                checkOutTime: String? = nil, houseRules: String? = nil, contactName: String, contactPhone: String, imageIds: [String]) {
        self.dealType = dealType
        self.propertyType = propertyType
        self.buildingType = buildingType
        self.title = title
        self.description = description
        self.price = price
        self.currency = currency
        self.cityId = cityId
        self.districtId = districtId
        self.metroId = metroId
        self.address = address
        self.lat = lat
        self.lng = lng
        self.area = area
        self.landArea = landArea
        self.rooms = rooms
        self.bathrooms = bathrooms
        self.floor = floor
        self.totalFloors = totalFloors
        self.yearBuilt = yearBuilt
        self.ceilingHeight = ceilingHeight
        self.repair = repair
        self.hasDocument = hasDocument
        self.mortgageAvailable = mortgageAvailable
        self.amenities = amenities
        self.maxGuests = maxGuests
        self.minNights = minNights
        self.checkInTime = checkInTime
        self.checkOutTime = checkOutTime
        self.houseRules = houseRules
        self.contactName = contactName
        self.contactPhone = contactPhone
        self.imageIds = imageIds
    }

    enum CodingKeys: String, CodingKey {
        case dealType, propertyType, buildingType, title, description, price, currency, cityId, districtId, metroId, address, lat, lng
        case area, landArea, rooms, bathrooms, floor, totalFloors, yearBuilt, ceilingHeight, repair, hasDocument, mortgageAvailable
        case amenities, maxGuests, minNights, checkInTime, checkOutTime, houseRules, contactName, contactPhone, imageIds
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(dealType, forKey: .dealType)
        try c.encode(propertyType, forKey: .propertyType)
        try c.encode(buildingType, forKey: .buildingType)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(price, forKey: .price)
        try c.encode(currency, forKey: .currency)
        try c.encode(cityId, forKey: .cityId)
        try c.encode(districtId, forKey: .districtId)
        try c.encode(metroId, forKey: .metroId)
        try c.encode(address, forKey: .address)
        try c.encode(lat, forKey: .lat)
        try c.encode(lng, forKey: .lng)
        try c.encode(area, forKey: .area)
        try c.encode(landArea, forKey: .landArea)
        try c.encode(rooms, forKey: .rooms)
        try c.encode(bathrooms, forKey: .bathrooms)
        try c.encode(floor, forKey: .floor)
        try c.encode(totalFloors, forKey: .totalFloors)
        try c.encode(yearBuilt, forKey: .yearBuilt)
        try c.encode(ceilingHeight, forKey: .ceilingHeight)
        try c.encode(repair, forKey: .repair)
        try c.encode(hasDocument, forKey: .hasDocument)
        try c.encode(mortgageAvailable, forKey: .mortgageAvailable)
        try c.encode(amenities, forKey: .amenities)
        try c.encode(maxGuests, forKey: .maxGuests)
        try c.encode(minNights, forKey: .minNights)
        try c.encode(checkInTime, forKey: .checkInTime)
        try c.encode(checkOutTime, forKey: .checkOutTime)
        try c.encode(houseRules, forKey: .houseRules)
        try c.encode(contactName, forKey: .contactName)
        try c.encode(contactPhone, forKey: .contactPhone)
        try c.encode(imageIds, forKey: .imageIds)
    }
}

public struct ListingActionBody: Encodable, Sendable { public let action: ListingAction }
public struct ApplyCreditBody: Encodable, Sendable { public let credit: CreditKind }

public struct ReportInput: Encodable, Sendable {
    public let reason: ReportReason
    public let comment: String?
    public init(reason: ReportReason, comment: String?) {
        self.reason = reason
        self.comment = comment
    }
}

public struct AvailabilityInput: Encodable, Sendable { public let blockedDates: [String] }

public struct SavedSearchInput: Encodable, Sendable {
    public let name: String
    public let query: [String: JSONValue]
    public let notify: Bool
    public init(name: String, query: [String: JSONValue], notify: Bool) {
        self.name = name
        self.query = query
        self.notify = notify
    }
}

public struct SavedSearchPatch: Encodable, Sendable {
    public let name: String?
    public let notify: Bool?
    public init(name: String? = nil, notify: Bool? = nil) {
        self.name = name
        self.notify = notify
    }
}

public struct StartConversationInput: Encodable, Sendable {
    public let listingId: String
    public let message: String
}

public struct MessageBody: Encodable, Sendable { public let body: String }

public struct BookingQuoteInput: Encodable, Sendable, Hashable {
    public let listingId: String
    public let checkIn: String
    public let checkOut: String
    public let guests: Int
    public init(listingId: String, checkIn: String, checkOut: String, guests: Int) {
        self.listingId = listingId
        self.checkIn = checkIn
        self.checkOut = checkOut
        self.guests = guests
    }
}

public struct CreateBookingInput: Encodable, Sendable {
    public let listingId: String
    public let checkIn: String
    public let checkOut: String
    public let guests: Int
    public let method: PaymentMethod
    public let returnUrl: String?
    public init(listingId: String, checkIn: String, checkOut: String, guests: Int, method: PaymentMethod, returnUrl: String?) {
        self.listingId = listingId
        self.checkIn = checkIn
        self.checkOut = checkOut
        self.guests = guests
        self.method = method
        self.returnUrl = returnUrl
    }
}

public struct PayBookingInput: Encodable, Sendable {
    public let method: PaymentMethod
    public let returnUrl: String?
}

public struct CancelBookingInput: Encodable, Sendable { public let reason: String? }

public struct ReviewInput: Encodable, Sendable {
    public let rating: Int
    public let comment: String
    public init(rating: Int, comment: String) {
        self.rating = rating
        self.comment = comment
    }
}

public struct ReviewReplyInput: Encodable, Sendable { public let reply: String }

/// `POST /checkout` — discriminated by `purpose`.
public enum CheckoutInput: Encodable, Sendable {
    case walletTopup(amount: Int, returnUrl: String?)
    case promotion(listingId: String, serviceCodes: [String]?, bundleCode: String?, method: PaymentMethod, returnUrl: String?)
    case listingFee(listingId: String, method: PaymentMethod, returnUrl: String?)
    case verification(listingId: String, method: PaymentMethod, returnUrl: String?)
    case subscription(plan: PlanCode, period: BillingPeriod, method: PaymentMethod, autoRenew: Bool, returnUrl: String?)

    enum CodingKeys: String, CodingKey { case purpose, amount, method, returnUrl, listingId, serviceCodes, bundleCode, planCode, period, autoRenew }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .walletTopup(amount, returnUrl):
            try c.encode(PaymentPurpose.WALLET_TOPUP, forKey: .purpose)
            try c.encode(amount, forKey: .amount)
            try c.encode(PaymentMethod.CARD, forKey: .method)
            try c.encodeIfPresent(returnUrl, forKey: .returnUrl)
        case let .promotion(listingId, serviceCodes, bundleCode, method, returnUrl):
            try c.encode(PaymentPurpose.PROMOTION, forKey: .purpose)
            try c.encode(listingId, forKey: .listingId)
            try c.encodeIfPresent(serviceCodes, forKey: .serviceCodes)
            try c.encodeIfPresent(bundleCode, forKey: .bundleCode)
            try c.encode(method, forKey: .method)
            try c.encodeIfPresent(returnUrl, forKey: .returnUrl)
        case let .listingFee(listingId, method, returnUrl):
            try c.encode(PaymentPurpose.LISTING_FEE, forKey: .purpose)
            try c.encode(listingId, forKey: .listingId)
            try c.encode(method, forKey: .method)
            try c.encodeIfPresent(returnUrl, forKey: .returnUrl)
        case let .verification(listingId, method, returnUrl):
            try c.encode(PaymentPurpose.VERIFICATION, forKey: .purpose)
            try c.encode(listingId, forKey: .listingId)
            try c.encode(method, forKey: .method)
            try c.encodeIfPresent(returnUrl, forKey: .returnUrl)
        case let .subscription(plan, period, method, autoRenew, returnUrl):
            try c.encode(PaymentPurpose.SUBSCRIPTION, forKey: .purpose)
            try c.encode(plan, forKey: .planCode)
            try c.encode(period, forKey: .period)
            try c.encode(method, forKey: .method)
            try c.encode(autoRenew, forKey: .autoRenew)
            try c.encodeIfPresent(returnUrl, forKey: .returnUrl)
        }
    }
}

public struct AgencyInput: Encodable, Sendable, Equatable {
    public var name: String
    public var type: AgencyType
    public var description: String?
    public var phone: String?
    public var email: String?
    public var website: String?
    public var address: String?
    public var cityId: String?
    public var logoUrl: String?

    public init(name: String, type: AgencyType, description: String? = nil, phone: String? = nil, email: String? = nil,
                website: String? = nil, address: String? = nil, cityId: String? = nil, logoUrl: String? = nil) {
        self.name = name
        self.type = type
        self.description = description
        self.phone = phone
        self.email = email
        self.website = website
        self.address = address
        self.cityId = cityId
        self.logoUrl = logoUrl
    }

    enum CodingKeys: String, CodingKey { case name, type, description, phone, email, website, address, cityId, logoUrl }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(type, forKey: .type)
        try c.encode(description, forKey: .description)
        try c.encode(phone, forKey: .phone)
        try c.encode(email, forKey: .email)
        try c.encode(website, forKey: .website)
        try c.encode(address, forKey: .address)
        try c.encode(cityId, forKey: .cityId)
        try c.encode(logoUrl, forKey: .logoUrl)
    }
}

public struct MortgageLeadInput: Encodable, Sendable {
    public let name: String
    public let phone: String
    public let listingId: String?
    public let price: Int
    public let downPayment: Int
    public let termYears: Int
    public let bankCode: String?
    public init(name: String, phone: String, listingId: String?, price: Int, downPayment: Int, termYears: Int, bankCode: String?) {
        self.name = name
        self.phone = phone
        self.listingId = listingId
        self.price = price
        self.downPayment = downPayment
        self.termYears = termYears
        self.bankCode = bankCode
    }
}
