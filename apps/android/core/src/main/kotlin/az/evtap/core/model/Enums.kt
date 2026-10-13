package az.evtap.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Domain enums — mirror of packages/shared/src/enums.ts. Constant names equal the wire values unless a
 * [SerialName] says otherwise, so `name` can be used for query parameters.
 */

@Serializable
enum class AppLocale(val tag: String) {
    @SerialName("az") AZ("az"),
    @SerialName("ru") RU("ru"),
    @SerialName("en") EN("en");

    companion object {
        val DEFAULT = AZ
        fun fromTag(tag: String?): AppLocale = entries.firstOrNull { tag?.startsWith(it.tag, ignoreCase = true) == true } ?: DEFAULT
    }
}

@Serializable enum class Currency(val symbol: String) { AZN("₼"), USD("$"), EUR("€"), GEL("₾") }

@Serializable enum class CountryCode { AZ, GE }

@Serializable enum class UserRole { USER, MODERATOR, ADMIN }

@Serializable enum class AccountType { INDIVIDUAL, BUSINESS }

@Serializable enum class UserStatus { ACTIVE, BLOCKED, DELETED }

@Serializable enum class AgencyType { AGENCY, DEVELOPER }

@Serializable enum class AgencyMemberRole { OWNER, AGENT }

@Serializable enum class DealType { SALE, RENT_LONG, RENT_DAILY }

@Serializable enum class PropertyType { APARTMENT, HOUSE, OFFICE, COMMERCIAL, LAND, GARAGE, ROOM }

@Serializable enum class BuildingType { NEW, SECONDARY }

@Serializable enum class RepairType { NONE, COSMETIC, EURO, DESIGNER }

@Serializable enum class PricePeriod { TOTAL, MONTH, DAY }

@Serializable enum class ListingStatus { DRAFT, PENDING, ACTIVE, REJECTED, EXPIRED, ARCHIVED, SOLD, BLOCKED }

@Serializable
enum class Amenity {
    BALCONY, PARKING, ELEVATOR, FURNITURE, KITCHEN_FURNITURE, INTERNET, WIFI, AIR_CONDITIONER, CENTRAL_HEATING, KOMBI,
    GAS, WATER, ELECTRICITY, WASHING_MACHINE, DISHWASHER, REFRIGERATOR, TV, POOL, GARDEN, SECURITY, CCTV, SEA_VIEW,
    PETS_ALLOWED, KIDS_ALLOWED, SMOKING_ALLOWED, SAUNA, BBQ,
}

@Serializable
enum class ListingSort(val wire: String) {
    @SerialName("date_desc") DATE_DESC("date_desc"),
    @SerialName("price_asc") PRICE_ASC("price_asc"),
    @SerialName("price_desc") PRICE_DESC("price_desc"),
    @SerialName("area_asc") AREA_ASC("area_asc"),
    @SerialName("area_desc") AREA_DESC("area_desc");

    companion object {
        fun fromWire(v: String?): ListingSort = entries.firstOrNull { it.wire == v } ?: DATE_DESC
    }
}

@Serializable enum class PromotionType { BUMP, AUTO_BUMP, VIP, PREMIUM, HIGHLIGHT, URGENT }

@Serializable enum class PaymentPurpose { WALLET_TOPUP, PROMOTION, LISTING_FEE, SUBSCRIPTION, BOOKING, VERIFICATION }

@Serializable enum class PaymentMethod { CARD, WALLET }

@Serializable
enum class PaymentStatus {
    CREATED, PENDING, SUCCEEDED, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED;

    val isFinal: Boolean get() = this != CREATED && this != PENDING
}

@Serializable enum class WalletTxType { TOPUP, BONUS, SPEND, REFUND, PAYOUT, ADJUSTMENT }

@Serializable enum class SubscriptionStatus { ACTIVE, CANCELLED, EXPIRED, PAST_DUE }

@Serializable enum class BillingPeriod { MONTH, YEAR }

@Serializable enum class BookingStatus { PENDING_PAYMENT, CONFIRMED, CANCELLED, COMPLETED, REFUNDED }

@Serializable enum class PayoutStatus { NOT_DUE, PENDING, PAID, CANCELLED }

@Serializable enum class CancelledBy { GUEST, HOST, ADMIN }

@Serializable enum class ReportReason { FAKE, WRONG_PRICE, WRONG_PHOTOS, ALREADY_SOLD, AGENT_AS_OWNER, DUPLICATE, FRAUD, OTHER }

@Serializable
enum class NotificationType {
    LISTING_APPROVED, LISTING_REJECTED, LISTING_EXPIRING, LISTING_EXPIRED, NEW_MESSAGE, PAYMENT_SUCCEEDED, PAYMENT_FAILED,
    BOOKING_NEW, BOOKING_CONFIRMED, BOOKING_CANCELLED, PAYOUT, SAVED_SEARCH_MATCH, PROMOTION_EXPIRED, SUBSCRIPTION_RENEWED,
    SUBSCRIPTION_EXPIRED, SYSTEM,
}

@Serializable enum class BannerPlacement { HOME_TOP, SEARCH_TOP, SEARCH_SIDEBAR, LISTING_SIDEBAR, MOBILE_HOME }

@Serializable enum class PlanCode { START, PRO, ENTERPRISE }

/** Subscription credits that can be spent on a listing (POST /listings/:id/apply-credit). */
@Serializable enum class CreditType { BUMP, VIP_7, PREMIUM_7 }

/** POST /listings/:id/actions. */
@Serializable enum class ListingAction { MARK_SOLD, ARCHIVE, RENEW, RESTORE }

@Serializable enum class OwnerType { OWNER, BUSINESS }

@Serializable enum class MetroLine { @SerialName("red") RED, @SerialName("green") GREEN, @SerialName("purple") PURPLE }
