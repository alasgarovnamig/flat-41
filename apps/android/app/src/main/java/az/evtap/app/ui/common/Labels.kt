package az.evtap.app.ui.common

import androidx.annotation.StringRes
import az.evtap.app.R
import az.evtap.core.model.*

/** Enum → string resource. Kept as plain functions so they work in composition and in view models (UiText). */
object Labels {
    @StringRes fun deal(d: DealType) = when (d) {
        DealType.SALE -> R.string.enum_deal_type_sale
        DealType.RENT_LONG -> R.string.enum_deal_type_rent_long
        DealType.RENT_DAILY -> R.string.enum_deal_type_rent_daily
    }

    @StringRes fun dealShort(d: DealType) = when (d) {
        DealType.SALE -> R.string.enum_deal_type_short_sale
        DealType.RENT_LONG -> R.string.enum_deal_type_short_rent_long
        DealType.RENT_DAILY -> R.string.enum_deal_type_short_rent_daily
    }

    @StringRes fun property(p: PropertyType) = when (p) {
        PropertyType.APARTMENT -> R.string.enum_property_type_apartment
        PropertyType.HOUSE -> R.string.enum_property_type_house
        PropertyType.OFFICE -> R.string.enum_property_type_office
        PropertyType.COMMERCIAL -> R.string.enum_property_type_commercial
        PropertyType.LAND -> R.string.enum_property_type_land
        PropertyType.GARAGE -> R.string.enum_property_type_garage
        PropertyType.ROOM -> R.string.enum_property_type_room
    }

    @StringRes fun building(b: BuildingType) = when (b) {
        BuildingType.NEW -> R.string.enum_building_type_new
        BuildingType.SECONDARY -> R.string.enum_building_type_secondary
    }

    @StringRes fun repair(r: RepairType) = when (r) {
        RepairType.NONE -> R.string.enum_repair_none
        RepairType.COSMETIC -> R.string.enum_repair_cosmetic
        RepairType.EURO -> R.string.enum_repair_euro
        RepairType.DESIGNER -> R.string.enum_repair_designer
    }

    @StringRes fun owner(o: OwnerType) = when (o) {
        OwnerType.OWNER -> R.string.enum_owner_type_owner
        OwnerType.BUSINESS -> R.string.enum_owner_type_business
    }

    @StringRes fun agencyType(t: AgencyType) = when (t) {
        AgencyType.AGENCY -> R.string.enum_agency_type_agency
        AgencyType.DEVELOPER -> R.string.enum_agency_type_developer
    }

    @StringRes fun amenity(a: Amenity) = when (a) {
        Amenity.BALCONY -> R.string.enum_amenity_balcony
        Amenity.PARKING -> R.string.enum_amenity_parking
        Amenity.ELEVATOR -> R.string.enum_amenity_elevator
        Amenity.FURNITURE -> R.string.enum_amenity_furniture
        Amenity.KITCHEN_FURNITURE -> R.string.enum_amenity_kitchen_furniture
        Amenity.INTERNET -> R.string.enum_amenity_internet
        Amenity.WIFI -> R.string.enum_amenity_wifi
        Amenity.AIR_CONDITIONER -> R.string.enum_amenity_air_conditioner
        Amenity.CENTRAL_HEATING -> R.string.enum_amenity_central_heating
        Amenity.KOMBI -> R.string.enum_amenity_kombi
        Amenity.GAS -> R.string.enum_amenity_gas
        Amenity.WATER -> R.string.enum_amenity_water
        Amenity.ELECTRICITY -> R.string.enum_amenity_electricity
        Amenity.WASHING_MACHINE -> R.string.enum_amenity_washing_machine
        Amenity.DISHWASHER -> R.string.enum_amenity_dishwasher
        Amenity.REFRIGERATOR -> R.string.enum_amenity_refrigerator
        Amenity.TV -> R.string.enum_amenity_tv
        Amenity.POOL -> R.string.enum_amenity_pool
        Amenity.GARDEN -> R.string.enum_amenity_garden
        Amenity.SECURITY -> R.string.enum_amenity_security
        Amenity.CCTV -> R.string.enum_amenity_cctv
        Amenity.SEA_VIEW -> R.string.enum_amenity_sea_view
        Amenity.PETS_ALLOWED -> R.string.enum_amenity_pets_allowed
        Amenity.KIDS_ALLOWED -> R.string.enum_amenity_kids_allowed
        Amenity.SMOKING_ALLOWED -> R.string.enum_amenity_smoking_allowed
        Amenity.SAUNA -> R.string.enum_amenity_sauna
        Amenity.BBQ -> R.string.enum_amenity_bbq
    }

    @StringRes fun listingStatus(s: ListingStatus) = when (s) {
        ListingStatus.DRAFT -> R.string.enum_listing_status_draft
        ListingStatus.PENDING -> R.string.enum_listing_status_pending
        ListingStatus.ACTIVE -> R.string.enum_listing_status_active
        ListingStatus.REJECTED -> R.string.enum_listing_status_rejected
        ListingStatus.EXPIRED -> R.string.enum_listing_status_expired
        ListingStatus.ARCHIVED -> R.string.enum_listing_status_archived
        ListingStatus.SOLD -> R.string.enum_listing_status_sold
        ListingStatus.BLOCKED -> R.string.enum_listing_status_blocked
    }

    @StringRes fun bookingStatus(s: BookingStatus) = when (s) {
        BookingStatus.PENDING_PAYMENT -> R.string.enum_booking_status_pending_payment
        BookingStatus.CONFIRMED -> R.string.enum_booking_status_confirmed
        BookingStatus.CANCELLED -> R.string.enum_booking_status_cancelled
        BookingStatus.COMPLETED -> R.string.enum_booking_status_completed
        BookingStatus.REFUNDED -> R.string.enum_booking_status_refunded
    }

    @StringRes fun payout(s: PayoutStatus) = when (s) {
        PayoutStatus.NOT_DUE -> R.string.enum_payout_status_not_due
        PayoutStatus.PENDING -> R.string.enum_payout_status_pending
        PayoutStatus.PAID -> R.string.enum_payout_status_paid
        PayoutStatus.CANCELLED -> R.string.enum_payout_status_cancelled
    }

    @StringRes fun paymentStatus(s: PaymentStatus) = when (s) {
        PaymentStatus.CREATED -> R.string.enum_payment_status_created
        PaymentStatus.PENDING -> R.string.enum_payment_status_pending
        PaymentStatus.SUCCEEDED -> R.string.enum_payment_status_succeeded
        PaymentStatus.FAILED -> R.string.enum_payment_status_failed
        PaymentStatus.CANCELLED -> R.string.enum_payment_status_cancelled
        PaymentStatus.REFUNDED -> R.string.enum_payment_status_refunded
        PaymentStatus.PARTIALLY_REFUNDED -> R.string.enum_payment_status_partially_refunded
    }

    @StringRes fun purpose(p: PaymentPurpose) = when (p) {
        PaymentPurpose.WALLET_TOPUP -> R.string.enum_payment_purpose_wallet_topup
        PaymentPurpose.PROMOTION -> R.string.enum_payment_purpose_promotion
        PaymentPurpose.LISTING_FEE -> R.string.enum_payment_purpose_listing_fee
        PaymentPurpose.SUBSCRIPTION -> R.string.enum_payment_purpose_subscription
        PaymentPurpose.BOOKING -> R.string.enum_payment_purpose_booking
        PaymentPurpose.VERIFICATION -> R.string.enum_payment_purpose_verification
    }

    @StringRes fun method(m: PaymentMethod) = when (m) {
        PaymentMethod.CARD -> R.string.enum_payment_method_card
        PaymentMethod.WALLET -> R.string.enum_payment_method_wallet
    }

    @StringRes fun walletTx(t: WalletTxType) = when (t) {
        WalletTxType.TOPUP -> R.string.enum_wallet_tx_topup
        WalletTxType.BONUS -> R.string.enum_wallet_tx_bonus
        WalletTxType.SPEND -> R.string.enum_wallet_tx_spend
        WalletTxType.REFUND -> R.string.enum_wallet_tx_refund
        WalletTxType.PAYOUT -> R.string.enum_wallet_tx_payout
        WalletTxType.ADJUSTMENT -> R.string.enum_wallet_tx_adjustment
    }

    @StringRes fun report(r: ReportReason) = when (r) {
        ReportReason.FAKE -> R.string.enum_report_reason_fake
        ReportReason.WRONG_PRICE -> R.string.enum_report_reason_wrong_price
        ReportReason.WRONG_PHOTOS -> R.string.enum_report_reason_wrong_photos
        ReportReason.ALREADY_SOLD -> R.string.enum_report_reason_already_sold
        ReportReason.AGENT_AS_OWNER -> R.string.enum_report_reason_agent_as_owner
        ReportReason.DUPLICATE -> R.string.enum_report_reason_duplicate
        ReportReason.FRAUD -> R.string.enum_report_reason_fraud
        ReportReason.OTHER -> R.string.enum_report_reason_other
    }

    @StringRes fun subscription(s: SubscriptionStatus) = when (s) {
        SubscriptionStatus.ACTIVE -> R.string.enum_subscription_status_active
        SubscriptionStatus.CANCELLED -> R.string.enum_subscription_status_cancelled
        SubscriptionStatus.EXPIRED -> R.string.enum_subscription_status_expired
        SubscriptionStatus.PAST_DUE -> R.string.enum_subscription_status_past_due
    }

    @StringRes fun cancelledBy(c: CancelledBy) = when (c) {
        CancelledBy.GUEST -> R.string.enum_cancelled_by_guest
        CancelledBy.HOST -> R.string.enum_cancelled_by_host
        CancelledBy.ADMIN -> R.string.enum_cancelled_by_admin
    }

    @StringRes fun credit(c: CreditType) = when (c) {
        CreditType.BUMP -> R.string.enum_credit_bump
        CreditType.VIP_7 -> R.string.enum_credit_vip_7
        CreditType.PREMIUM_7 -> R.string.enum_credit_premium_7
    }

    @StringRes fun sort(s: ListingSort) = when (s) {
        ListingSort.DATE_DESC -> R.string.sort_date_desc
        ListingSort.PRICE_ASC -> R.string.sort_price_asc
        ListingSort.PRICE_DESC -> R.string.sort_price_desc
        ListingSort.AREA_ASC -> R.string.sort_area_asc
        ListingSort.AREA_DESC -> R.string.sort_area_desc
    }

    @StringRes fun planFeature(key: String) = when (key) {
        "agency_page" -> R.string.business_features_agency_page
        "business_badge" -> R.string.business_features_business_badge
        "basic_stats" -> R.string.business_features_basic_stats
        "advanced_stats" -> R.string.business_features_advanced_stats
        "leads_crm" -> R.string.business_features_leads_crm
        "priority_moderation" -> R.string.business_features_priority_moderation
        "xml_feed_import" -> R.string.business_features_xml_feed_import
        "dedicated_manager" -> R.string.business_features_dedicated_manager
        "developer_projects" -> R.string.business_features_developer_projects
        else -> null
    }

    @StringRes fun notificationType(t: NotificationType) = when (t) {
        NotificationType.NEW_MESSAGE -> R.string.tabs_messages
        NotificationType.BOOKING_NEW, NotificationType.BOOKING_CONFIRMED, NotificationType.BOOKING_CANCELLED -> R.string.bookings_title
        NotificationType.PAYMENT_SUCCEEDED, NotificationType.PAYMENT_FAILED, NotificationType.PAYOUT -> R.string.payments_title
        NotificationType.SAVED_SEARCH_MATCH -> R.string.saved_title
        NotificationType.SUBSCRIPTION_RENEWED, NotificationType.SUBSCRIPTION_EXPIRED -> R.string.business_title
        NotificationType.PROMOTION_EXPIRED -> R.string.promote_title
        NotificationType.SYSTEM -> R.string.notifications_title
        NotificationType.LISTING_APPROVED, NotificationType.LISTING_REJECTED, NotificationType.LISTING_EXPIRING,
        NotificationType.LISTING_EXPIRED -> R.string.my_listings_title
    }
}
