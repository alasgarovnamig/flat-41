package az.evtap.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/*
 * DTOs returned by the API — mirror of packages/shared/src/types.ts.
 * Dates are ISO-8601 strings. Money: listing `price` is in MAJOR units; every other amount (`amount`, `total`,
 * `fee`, `balance`, `subtotal`…) is in MINOR units (qəpik, 1 AZN = 100).
 * Defaults keep decoding tolerant of fields an older/newer server omits.
 */

@Serializable
data class Paginated<T>(val items: List<T> = emptyList(), val total: Int = 0, val page: Int = 1, val pageSize: Int = 20) {
    val hasMore: Boolean get() = page * pageSize < total
}

@Serializable
data class ApiErrorBody(val statusCode: Int? = null, val message: JsonElement? = null, val error: String? = null, val code: String? = null)

@Serializable data class Ok(val ok: Boolean = true)

// ───────────────────────────── Users & auth ─────────────────────────────

@Serializable
data class User(
    val id: String,
    val name: String = "",
    val phone: String? = null,
    val email: String? = null,
    val avatarUrl: String? = null,
    val role: UserRole = UserRole.USER,
    val accountType: AccountType = AccountType.INDIVIDUAL,
    val status: UserStatus = UserStatus.ACTIVE,
    val locale: AppLocale = AppLocale.AZ,
    val isPhoneVerified: Boolean = false,
    val isEmailVerified: Boolean = false,
    val agencyId: String? = null,
    val createdAt: String = "",
)

@Serializable
data class PublicUser(
    val id: String,
    val name: String = "",
    val avatarUrl: String? = null,
    val accountType: AccountType = AccountType.INDIVIDUAL,
    val agency: AgencySummary? = null,
    val memberSince: String = "",
    val activeListings: Int = 0,
    val rating: Double? = null,
    val reviewsCount: Int = 0,
)

@Serializable data class WalletBalance(val balance: Long = 0, val bonusBalance: Long = 0, val currency: Currency = Currency.AZN)

@Serializable
data class ListingQuota(val freeLimit: Int = 0, val used: Int = 0, val remaining: Int = 0, val listingFee: Long = 0) {
    val unlimited: Boolean get() = remaining == -1 || freeLimit == -1
}

/** GET /auth/me — `Me extends User`. */
@Serializable
data class Me(
    val id: String,
    val name: String = "",
    val phone: String? = null,
    val email: String? = null,
    val avatarUrl: String? = null,
    val role: UserRole = UserRole.USER,
    val accountType: AccountType = AccountType.INDIVIDUAL,
    val status: UserStatus = UserStatus.ACTIVE,
    val locale: AppLocale = AppLocale.AZ,
    val isPhoneVerified: Boolean = false,
    val isEmailVerified: Boolean = false,
    val agencyId: String? = null,
    val createdAt: String = "",
    val wallet: WalletBalance = WalletBalance(),
    val subscription: Subscription? = null,
    val quota: ListingQuota = ListingQuota(),
    val unreadMessages: Int = 0,
    val unreadNotifications: Int = 0,
) {
    /** Subscription that still grants credits (ACTIVE, or CANCELLED = valid until period end). */
    val activeSubscription: Subscription?
        get() = subscription?.takeIf { it.status == SubscriptionStatus.ACTIVE || it.status == SubscriptionStatus.CANCELLED }
}

@Serializable
data class AuthResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Long = 900,
    val user: User,
    val isNew: Boolean = false,
)

@Serializable data class OtpRequestResult(val sent: Boolean = true, val retryAfter: Int = 60, val devCode: String? = null)

// ───────────────────────────── Agencies ─────────────────────────────

@Serializable
data class AgencySummary(
    val id: String,
    val name: String = "",
    val slug: String = "",
    val logoUrl: String? = null,
    val type: AgencyType = AgencyType.AGENCY,
    val verified: Boolean = false,
)

@Serializable
data class Agency(
    val id: String,
    val name: String = "",
    val slug: String = "",
    val logoUrl: String? = null,
    val type: AgencyType = AgencyType.AGENCY,
    val verified: Boolean = false,
    val description: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val website: String? = null,
    val address: String? = null,
    val cityId: String? = null,
    val ownerId: String = "",
    val activeListings: Int = 0,
    val createdAt: String = "",
)

@Serializable
data class AgencyMember(
    val userId: String,
    val name: String = "",
    val phone: String? = null,
    val email: String? = null,
    val avatarUrl: String? = null,
    val role: AgencyMemberRole = AgencyMemberRole.AGENT,
    val activeListings: Int = 0,
    val joinedAt: String = "",
)

@Serializable data class TimeseriesPoint(val date: String, val value: Double = 0.0)

@Serializable
data class AgencyStats(val views: Long = 0, val phoneViews: Long = 0, val messages: Long = 0, val listings: Long = 0, val daily: List<TimeseriesPoint> = emptyList())

// ───────────────────────────── Listings ─────────────────────────────

@Serializable data class ListingImage(val id: String, val uploadId: String? = null, val url: String, val thumbUrl: String = "", val order: Int = 0)

@Serializable data class Upload(val id: String, val url: String, val thumbUrl: String = "", val mime: String = "", val size: Long = 0)

/** Fields every listing representation shares — what a [ListingCard] shows. */
interface ListingLike {
    val id: String
    val title: String
    val dealType: DealType
    val propertyType: PropertyType
    val buildingType: BuildingType?
    val price: Long
    val currency: Currency
    val pricePeriod: PricePeriod
    val country: CountryCode
    val cityId: String
    val districtId: String?
    val metroId: String?
    val address: String?
    val area: Double
    val landArea: Double?
    val rooms: Int?
    val floor: Int?
    val totalFloors: Int?
    val coverUrl: String?
    val imagesCount: Int
    val lat: Double?
    val lng: Double?
    val isVip: Boolean
    val isPremium: Boolean
    val isHighlighted: Boolean
    val isUrgent: Boolean
    val isVerified: Boolean
    val hasDocument: Boolean
    val mortgageAvailable: Boolean
    val isBusiness: Boolean
    val rating: Double?
    val status: ListingStatus
    val bumpedAt: String
    val publishedAt: String?
    val createdAt: String
}

@Serializable
data class ListingCard(
    override val id: String,
    override val title: String = "",
    override val dealType: DealType = DealType.SALE,
    override val propertyType: PropertyType = PropertyType.APARTMENT,
    override val buildingType: BuildingType? = null,
    override val price: Long = 0,
    override val currency: Currency = Currency.AZN,
    override val pricePeriod: PricePeriod = PricePeriod.TOTAL,
    override val country: CountryCode = CountryCode.AZ,
    override val cityId: String = "",
    override val districtId: String? = null,
    override val metroId: String? = null,
    override val address: String? = null,
    override val area: Double = 0.0,
    override val landArea: Double? = null,
    override val rooms: Int? = null,
    override val floor: Int? = null,
    override val totalFloors: Int? = null,
    override val coverUrl: String? = null,
    override val imagesCount: Int = 0,
    override val lat: Double? = null,
    override val lng: Double? = null,
    override val isVip: Boolean = false,
    override val isPremium: Boolean = false,
    override val isHighlighted: Boolean = false,
    override val isUrgent: Boolean = false,
    override val isVerified: Boolean = false,
    override val hasDocument: Boolean = false,
    override val mortgageAvailable: Boolean = false,
    override val isBusiness: Boolean = false,
    override val rating: Double? = null,
    override val status: ListingStatus = ListingStatus.ACTIVE,
    override val bumpedAt: String = "",
    override val publishedAt: String? = null,
    override val createdAt: String = "",
) : ListingLike

@Serializable
data class ActivePromotion(
    val id: String,
    val type: PromotionType,
    val serviceCode: String = "",
    val startsAt: String = "",
    val endsAt: String? = null,
    val bumpsLeft: Int? = null,
)

@Serializable
data class ListingDetail(
    override val id: String,
    override val title: String = "",
    override val dealType: DealType = DealType.SALE,
    override val propertyType: PropertyType = PropertyType.APARTMENT,
    override val buildingType: BuildingType? = null,
    override val price: Long = 0,
    override val currency: Currency = Currency.AZN,
    override val pricePeriod: PricePeriod = PricePeriod.TOTAL,
    override val country: CountryCode = CountryCode.AZ,
    override val cityId: String = "",
    override val districtId: String? = null,
    override val metroId: String? = null,
    override val address: String? = null,
    override val area: Double = 0.0,
    override val landArea: Double? = null,
    override val rooms: Int? = null,
    override val floor: Int? = null,
    override val totalFloors: Int? = null,
    override val coverUrl: String? = null,
    override val imagesCount: Int = 0,
    override val lat: Double? = null,
    override val lng: Double? = null,
    override val isVip: Boolean = false,
    override val isPremium: Boolean = false,
    override val isHighlighted: Boolean = false,
    override val isUrgent: Boolean = false,
    override val isVerified: Boolean = false,
    override val hasDocument: Boolean = false,
    override val mortgageAvailable: Boolean = false,
    override val isBusiness: Boolean = false,
    override val rating: Double? = null,
    override val status: ListingStatus = ListingStatus.ACTIVE,
    override val bumpedAt: String = "",
    override val publishedAt: String? = null,
    override val createdAt: String = "",
    val description: String = "",
    val images: List<ListingImage> = emptyList(),
    val bathrooms: Int? = null,
    val yearBuilt: Int? = null,
    val ceilingHeight: Double? = null,
    val repair: RepairType? = null,
    val amenities: List<Amenity> = emptyList(),
    val maxGuests: Int? = null,
    val minNights: Int? = null,
    val checkInTime: String? = null,
    val checkOutTime: String? = null,
    val houseRules: String? = null,
    val contactName: String = "",
    val contactPhoneMasked: String = "",
    val contactPhone: String? = null,
    val owner: PublicUser? = null,
    val agency: AgencySummary? = null,
    val views: Long = 0,
    val favoritesCount: Int = 0,
    val reviewsCount: Int = 0,
    val expiresAt: String? = null,
    val rejectionReason: String? = null,
    val promotions: List<ActivePromotion> = emptyList(),
    val isOwner: Boolean = false,
    val isFavorite: Boolean = false,
    val updatedAt: String = "",
) : ListingLike {
    val sortedImages: List<ListingImage> get() = images.sortedBy { it.order }
}

@Serializable
data class MyListing(
    override val id: String,
    override val title: String = "",
    override val dealType: DealType = DealType.SALE,
    override val propertyType: PropertyType = PropertyType.APARTMENT,
    override val buildingType: BuildingType? = null,
    override val price: Long = 0,
    override val currency: Currency = Currency.AZN,
    override val pricePeriod: PricePeriod = PricePeriod.TOTAL,
    override val country: CountryCode = CountryCode.AZ,
    override val cityId: String = "",
    override val districtId: String? = null,
    override val metroId: String? = null,
    override val address: String? = null,
    override val area: Double = 0.0,
    override val landArea: Double? = null,
    override val rooms: Int? = null,
    override val floor: Int? = null,
    override val totalFloors: Int? = null,
    override val coverUrl: String? = null,
    override val imagesCount: Int = 0,
    override val lat: Double? = null,
    override val lng: Double? = null,
    override val isVip: Boolean = false,
    override val isPremium: Boolean = false,
    override val isHighlighted: Boolean = false,
    override val isUrgent: Boolean = false,
    override val isVerified: Boolean = false,
    override val hasDocument: Boolean = false,
    override val mortgageAvailable: Boolean = false,
    override val isBusiness: Boolean = false,
    override val rating: Double? = null,
    override val status: ListingStatus = ListingStatus.ACTIVE,
    override val bumpedAt: String = "",
    override val publishedAt: String? = null,
    override val createdAt: String = "",
    val views: Long = 0,
    val phoneViews: Long = 0,
    val favoritesCount: Int = 0,
    val expiresAt: String? = null,
    val rejectionReason: String? = null,
    val promotions: List<ActivePromotion> = emptyList(),
    val requiresPayment: Boolean = false,
) : ListingLike

@Serializable data class DailyStat(val date: String, val views: Long = 0, val phoneViews: Long = 0)

@Serializable
data class ListingStats(val views: Long = 0, val phoneViews: Long = 0, val favorites: Long = 0, val messages: Long = 0, val daily: List<DailyStat> = emptyList())

@Serializable
data class MapPoint(
    val id: String,
    val lat: Double,
    val lng: Double,
    val price: Long = 0,
    val currency: Currency = Currency.AZN,
    val pricePeriod: PricePeriod = PricePeriod.TOTAL,
    val isVip: Boolean = false,
    val isPremium: Boolean = false,
    val title: String = "",
    val coverUrl: String? = null,
)

@Serializable data class BookedRange(val checkIn: String, val checkOut: String)

@Serializable
data class Availability(val listingId: String = "", val blockedDates: List<String> = emptyList(), val bookedRanges: List<BookedRange> = emptyList())

@Serializable data class ReviewAuthor(val id: String, val name: String = "", val avatarUrl: String? = null)

@Serializable
data class Review(
    val id: String,
    val listingId: String = "",
    val bookingId: String = "",
    val author: ReviewAuthor,
    val rating: Int = 5,
    val comment: String = "",
    val createdAt: String = "",
    val hostReply: String? = null,
)

// ───────────────────────────── Favorites / saved searches ─────────────────────────────

@Serializable
data class SavedSearch(
    val id: String,
    val name: String = "",
    val query: JsonObject = JsonObject(emptyMap()),
    val notify: Boolean = true,
    val newMatches: Int = 0,
    val createdAt: String = "",
)

// ───────────────────────────── Messaging ─────────────────────────────

@Serializable
data class ConversationListing(
    val id: String,
    val title: String = "",
    val coverUrl: String? = null,
    val price: Long = 0,
    val currency: Currency = Currency.AZN,
    val pricePeriod: PricePeriod = PricePeriod.TOTAL,
    val status: ListingStatus = ListingStatus.ACTIVE,
)

@Serializable data class ChatUser(val id: String, val name: String = "", val avatarUrl: String? = null)

@Serializable
data class Conversation(
    val id: String,
    val listing: ConversationListing,
    val otherUser: ChatUser,
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    val updatedAt: String = "",
)

@Serializable
data class Message(
    val id: String,
    val conversationId: String = "",
    val senderId: String = "",
    val body: String = "",
    val createdAt: String = "",
    val readAt: String? = null,
)

@Serializable data class UnreadCount(val count: Int = 0)

// ───────────────────────────── Bookings ─────────────────────────────

@Serializable
data class BookingQuote(
    val listingId: String = "",
    val checkIn: String = "",
    val checkOut: String = "",
    val nights: Int = 0,
    val guests: Int = 1,
    val nightlyPrice: Long = 0,
    val currency: Currency = Currency.AZN,
    val subtotal: Long = 0,
    val guestFee: Long = 0,
    val total: Long = 0,
    val available: Boolean = true,
    val unavailableReason: String? = null,
)

@Serializable
data class BookingListing(val id: String, val title: String = "", val coverUrl: String? = null, val cityId: String = "", val address: String? = null)

@Serializable data class BookingParty(val id: String, val name: String = "", val phone: String? = null, val avatarUrl: String? = null)

@Serializable
data class Booking(
    val id: String,
    val listing: BookingListing,
    val guest: BookingParty,
    val host: BookingParty,
    val checkIn: String,
    val checkOut: String,
    val nights: Int = 0,
    val guests: Int = 1,
    val nightlyPrice: Long = 0,
    val currency: Currency = Currency.AZN,
    val subtotal: Long = 0,
    val guestFee: Long = 0,
    val hostFee: Long = 0,
    val total: Long = 0,
    val hostPayout: Long = 0,
    val status: BookingStatus = BookingStatus.PENDING_PAYMENT,
    val payoutStatus: PayoutStatus = PayoutStatus.NOT_DUE,
    val refundedAmount: Long = 0,
    val paymentId: String? = null,
    val cancelledBy: CancelledBy? = null,
    val cancelReason: String? = null,
    val canReview: Boolean = false,
    val createdAt: String = "",
)

@Serializable data class BookingCheckout(val booking: Booking, val checkout: CheckoutResponse)

// ───────────────────────────── Money ─────────────────────────────

@Serializable data class LocalizedText(val az: String = "", val ru: String = "", val en: String = "") {
    fun get(locale: AppLocale): String = when (locale) {
        AppLocale.AZ -> az
        AppLocale.RU -> ru.ifBlank { az }
        AppLocale.EN -> en.ifBlank { az }
    }
}

@Serializable
data class ServiceDef(
    val code: String,
    val promotionType: PromotionType? = null,
    val durationDays: Int = 0,
    val price: Long = 0,
    val active: Boolean = true,
    val sortOrder: Int = 0,
    val name: LocalizedText = LocalizedText(),
    val description: LocalizedText = LocalizedText(),
)

@Serializable data class BundleDef(val code: String, val serviceCodes: List<String> = emptyList(), val price: Long = 0, val name: LocalizedText = LocalizedText())

@Serializable
data class PlanDef(
    val code: PlanCode,
    val priceMonthly: Long = 0,
    val priceYearly: Long = 0,
    val listingQuota: Int = 0,
    val monthlyBumps: Int = 0,
    val monthlyVipCredits: Int = 0,
    val monthlyPremiumCredits: Int = 0,
    val maxAgents: Int = 1,
    val features: List<String> = emptyList(),
    val active: Boolean = true,
    val name: LocalizedText = LocalizedText(),
)

@Serializable data class TopupBonusTier(val minAmount: Long, val bonusPercent: Double)

@Serializable
data class CatalogSettings(
    val freeListingsPerMonth: Int = 2,
    val listingFee: Long = 300,
    val listingLifetimeDays: Int = 30,
    val dailyRentGuestFeePercent: Double = 8.0,
    val dailyRentHostFeePercent: Double = 3.0,
    val freeCancellationHours: Int = 48,
    val topupBonuses: List<TopupBonusTier> = emptyList(),
    val minTopup: Long = 100,
    val maxTopup: Long = 500_000,
)

@Serializable
data class Catalog(
    val services: List<ServiceDef> = emptyList(),
    val bundles: List<BundleDef> = emptyList(),
    val plans: List<PlanDef> = emptyList(),
    val settings: CatalogSettings = CatalogSettings(),
)

@Serializable data class PaymentItem(val code: String = "", val name: String = "", val amount: Long = 0)

@Serializable
data class Payment(
    val id: String,
    val userId: String = "",
    val purpose: PaymentPurpose,
    val method: PaymentMethod = PaymentMethod.CARD,
    val amount: Long = 0,
    val currency: Currency = Currency.AZN,
    val status: PaymentStatus = PaymentStatus.CREATED,
    val description: String = "",
    val listingId: String? = null,
    val bookingId: String? = null,
    val items: List<PaymentItem> = emptyList(),
    val provider: String? = null,
    val providerOrderId: String? = null,
    val cardMask: String? = null,
    val refundedAmount: Long = 0,
    val failureReason: String? = null,
    val createdAt: String = "",
    val paidAt: String? = null,
)

@Serializable
data class CheckoutResponse(
    val paymentId: String,
    val status: PaymentStatus = PaymentStatus.PENDING,
    val amount: Long = 0,
    val currency: Currency = Currency.AZN,
    val paymentUrl: String? = null,
)

@Serializable data class Wallet(val balance: Long = 0, val bonusBalance: Long = 0, val currency: Currency = Currency.AZN)

@Serializable
data class WalletTransaction(
    val id: String,
    val type: WalletTxType,
    val amount: Long = 0,
    val balanceAfter: Long = 0,
    val description: String = "",
    val paymentId: String? = null,
    val createdAt: String = "",
)

@Serializable
data class SubscriptionUsage(
    val activeListings: Int = 0,
    val listingQuota: Int = 0,
    val bumpsLeft: Int = 0,
    val vipCreditsLeft: Int = 0,
    val premiumCreditsLeft: Int = 0,
)

@Serializable
data class Subscription(
    val id: String,
    val planCode: PlanCode,
    val period: BillingPeriod = BillingPeriod.MONTH,
    val status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    val autoRenew: Boolean = true,
    val currentPeriodStart: String = "",
    val currentPeriodEnd: String = "",
    val usage: SubscriptionUsage = SubscriptionUsage(),
    val cardMask: String? = null,
)

// ───────────────────────────── Misc ─────────────────────────────

@Serializable
data class AppNotification(
    val id: String,
    val type: NotificationType = NotificationType.SYSTEM,
    val title: String = "",
    val body: String = "",
    val data: JsonObject = JsonObject(emptyMap()),
    val readAt: String? = null,
    val createdAt: String = "",
)

@Serializable
data class Banner(
    val id: String,
    val placement: BannerPlacement = BannerPlacement.MOBILE_HOME,
    val title: String = "",
    val imageUrl: String,
    val linkUrl: String = "",
    val active: Boolean = true,
    val sortOrder: Int = 0,
)

@Serializable data class PageSummary(val slug: String, val title: String = "")

@Serializable
data class CmsPage(val slug: String, val title: LocalizedText = LocalizedText(), val body: LocalizedText = LocalizedText(), val updatedAt: String = "")

@Serializable
data class MortgageBank(
    val code: String,
    val name: String = "",
    val logoUrl: String? = null,
    val annualRate: Double = 0.0,
    val maxTermYears: Int = 25,
    val minDownPaymentPercent: Double = 0.0,
)

@Serializable data class IdResponse(val id: String)

@Serializable data class PhoneResponse(val phone: String)
