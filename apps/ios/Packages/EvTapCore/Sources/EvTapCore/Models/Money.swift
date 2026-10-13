import Foundation

// MARK: - Bookings

public struct BookingQuote: Codable, Sendable, Hashable {
    public let listingId: String
    public let checkIn: String
    public let checkOut: String
    public let nights: Int
    public let guests: Int
    /// MAJOR units.
    public let nightlyPrice: Int
    public let currency: Currency
    /// Minor units.
    public let subtotal: Int
    public let guestFee: Int
    /// What the guest pays (minor).
    public let total: Int
    public let available: Bool
    public let unavailableReason: String?
}

public struct Booking: Codable, Sendable, Hashable, Identifiable {
    public struct ListingRef: Codable, Sendable, Hashable {
        public let id: String
        public let title: String
        public let coverUrl: String?
        public let cityId: String
        public let address: String?
    }

    public struct Party: Codable, Sendable, Hashable {
        public let id: String
        public let name: String
        public let phone: String?
        public let avatarUrl: String?
    }

    public let id: String
    public let listing: ListingRef
    public let guest: Party
    public let host: Party
    public let checkIn: String
    public let checkOut: String
    public let nights: Int
    public let guests: Int
    public let nightlyPrice: Int
    public let currency: Currency
    public let subtotal: Int
    public let guestFee: Int
    public let hostFee: Int
    public let total: Int
    public let hostPayout: Int
    public let status: BookingStatus
    public let payoutStatus: PayoutStatus
    public let refundedAmount: Int
    public let paymentId: String?
    public let cancelledBy: CancelledBy?
    public let cancelReason: String?
    public let canReview: Bool
    public let createdAt: Date

    public var isCancellable: Bool { status == .CONFIRMED || status == .PENDING_PAYMENT }
}

public struct CreateBookingResponse: Decodable, Sendable, Hashable {
    public let booking: Booking
    public let checkout: CheckoutResponse
}

// MARK: - Payments / wallet / subscriptions

public struct PaymentItem: Codable, Sendable, Hashable {
    public let code: String
    public let name: String
    public let amount: Int
}

public struct Payment: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let userId: String
    public let purpose: PaymentPurpose
    public let method: PaymentMethod
    /// Minor units.
    public let amount: Int
    public let currency: Currency
    public let status: PaymentStatus
    public let description: String
    public let listingId: String?
    public let bookingId: String?
    public let items: [PaymentItem]
    public let provider: String?
    public let providerOrderId: String?
    public let cardMask: String?
    public let refundedAmount: Int
    public let failureReason: String?
    public let createdAt: Date
    public let paidAt: Date?
}

public struct CheckoutResponse: Codable, Sendable, Hashable {
    public let paymentId: String
    /// SUCCEEDED immediately for WALLET, PENDING for CARD.
    public let status: PaymentStatus
    public let amount: Int
    public let currency: Currency
    /// CARD: open this URL; the bank redirects back to `returnUrl`.
    public let paymentUrl: String?

    public init(paymentId: String, status: PaymentStatus, amount: Int, currency: Currency, paymentUrl: String?) {
        self.paymentId = paymentId
        self.status = status
        self.amount = amount
        self.currency = currency
        self.paymentUrl = paymentUrl
    }

    /// True when the browser step is needed (card payment that is not final yet).
    public var needsBrowser: Bool { paymentUrl != nil && !status.isFinal }
}

public struct Wallet: Codable, Sendable, Hashable {
    public let balance: Int
    public let bonusBalance: Int
    public let currency: Currency
}

public struct WalletTransaction: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let type: WalletTxType
    /// Signed minor units.
    public let amount: Int
    public let balanceAfter: Int
    public let description: String
    public let paymentId: String?
    public let createdAt: Date
}

public struct Subscription: Codable, Sendable, Hashable, Identifiable {
    public struct Usage: Codable, Sendable, Hashable {
        public let activeListings: Int
        /// -1 = unlimited.
        public let listingQuota: Int
        public let bumpsLeft: Int
        public let vipCreditsLeft: Int
        public let premiumCreditsLeft: Int

        /// Credits that can be applied to a listing right now.
        public var availableCredits: [CreditBalance] {
            [
                CreditBalance(kind: .BUMP, count: bumpsLeft),
                CreditBalance(kind: .VIP_7, count: vipCreditsLeft),
                CreditBalance(kind: .PREMIUM_7, count: premiumCreditsLeft),
            ].filter { $0.count > 0 }
        }
    }

    public let id: String
    public let planCode: PlanCode
    public let period: BillingPeriod
    public let status: SubscriptionStatus
    public let autoRenew: Bool
    public let currentPeriodStart: Date
    public let currentPeriodEnd: Date
    public let usage: Usage
    public let cardMask: String?
}

public struct CreditBalance: Sendable, Hashable, Identifiable {
    public var id: String { kind.rawValue }
    public let kind: CreditKind
    public let count: Int
    public init(kind: CreditKind, count: Int) {
        self.kind = kind
        self.count = count
    }
}

// MARK: - Catalog (prices from the DB)

public struct ServiceDef: Codable, Sendable, Hashable, Identifiable {
    public var id: String { code }
    public let code: String
    public let promotionType: PromotionType?
    /// BUMP: number of bumps; others: days.
    public let durationDays: Int
    /// Minor units.
    public let price: Int
    public let active: Bool
    public let sortOrder: Int
    public let name: LocalizedText
    public let description: LocalizedText

    public init(code: String, promotionType: PromotionType?, durationDays: Int, price: Int, active: Bool, sortOrder: Int, name: LocalizedText, description: LocalizedText) {
        self.code = code
        self.promotionType = promotionType
        self.durationDays = durationDays
        self.price = price
        self.active = active
        self.sortOrder = sortOrder
        self.name = name
        self.description = description
    }
}

public struct BundleDef: Codable, Sendable, Hashable, Identifiable {
    public var id: String { code }
    public let code: String
    public let serviceCodes: [String]
    public let price: Int
    public let name: LocalizedText

    public init(code: String, serviceCodes: [String], price: Int, name: LocalizedText) {
        self.code = code
        self.serviceCodes = serviceCodes
        self.price = price
        self.name = name
    }
}

public struct PlanDef: Codable, Sendable, Hashable, Identifiable {
    public var id: String { code.rawValue }
    public let code: PlanCode
    public let priceMonthly: Int
    public let priceYearly: Int
    /// -1 = unlimited.
    public let listingQuota: Int
    public let monthlyBumps: Int
    public let monthlyVipCredits: Int
    public let monthlyPremiumCredits: Int
    public let maxAgents: Int
    /// Feature keys, translated on clients (`business.features.<key>`).
    public let features: [String]
    public let active: Bool
    public let name: LocalizedText

    public init(code: PlanCode, priceMonthly: Int, priceYearly: Int, listingQuota: Int, monthlyBumps: Int, monthlyVipCredits: Int,
                monthlyPremiumCredits: Int, maxAgents: Int, features: [String], active: Bool, name: LocalizedText) {
        self.code = code
        self.priceMonthly = priceMonthly
        self.priceYearly = priceYearly
        self.listingQuota = listingQuota
        self.monthlyBumps = monthlyBumps
        self.monthlyVipCredits = monthlyVipCredits
        self.monthlyPremiumCredits = monthlyPremiumCredits
        self.maxAgents = maxAgents
        self.features = features
        self.active = active
        self.name = name
    }

    public func price(for period: BillingPeriod) -> Int { period == .YEAR ? priceYearly : priceMonthly }
}

public struct TopupBonusTier: Codable, Sendable, Hashable {
    /// Minor units.
    public let minAmount: Int
    public let bonusPercent: Double

    public init(minAmount: Int, bonusPercent: Double) {
        self.minAmount = minAmount
        self.bonusPercent = bonusPercent
    }
}

public struct CatalogSettings: Codable, Sendable, Hashable {
    public let freeListingsPerMonth: Int
    public let listingFee: Int
    public let listingLifetimeDays: Int
    public let dailyRentGuestFeePercent: Double
    public let dailyRentHostFeePercent: Double
    public let freeCancellationHours: Int
    public let topupBonuses: [TopupBonusTier]
    public let minTopup: Int
    public let maxTopup: Int

    public init(freeListingsPerMonth: Int, listingFee: Int, listingLifetimeDays: Int, dailyRentGuestFeePercent: Double,
                dailyRentHostFeePercent: Double, freeCancellationHours: Int, topupBonuses: [TopupBonusTier], minTopup: Int, maxTopup: Int) {
        self.freeListingsPerMonth = freeListingsPerMonth
        self.listingFee = listingFee
        self.listingLifetimeDays = listingLifetimeDays
        self.dailyRentGuestFeePercent = dailyRentGuestFeePercent
        self.dailyRentHostFeePercent = dailyRentHostFeePercent
        self.freeCancellationHours = freeCancellationHours
        self.topupBonuses = topupBonuses
        self.minTopup = minTopup
        self.maxTopup = maxTopup
    }
}

public struct Catalog: Codable, Sendable, Hashable {
    public let services: [ServiceDef]
    public let bundles: [BundleDef]
    public let plans: [PlanDef]
    public let settings: CatalogSettings

    public init(services: [ServiceDef], bundles: [BundleDef], plans: [PlanDef], settings: CatalogSettings) {
        self.services = services
        self.bundles = bundles
        self.plans = plans
        self.settings = settings
    }

    public func service(_ code: String) -> ServiceDef? { services.first { $0.code == code } }

    /// Sum of the individual service prices of a bundle (to show the saving).
    public func listPrice(of bundle: BundleDef) -> Int {
        bundle.serviceCodes.reduce(0) { $0 + (service($1)?.price ?? 0) }
    }
}
