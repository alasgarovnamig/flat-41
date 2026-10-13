package az.evtap.core.pricing

import az.evtap.core.model.*
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Port of packages/shared/src/pricing.ts. All money in MINOR units unless stated otherwise.
 * [DefaultCatalog] is shown while GET /catalog is loading or offline; the server is always authoritative.
 */
object Pricing {

    /** Bonus credited on a wallet top-up (minor units), best matching tier wins. */
    fun topupBonus(amountMinor: Long, tiers: List<TopupBonusTier>): Long {
        val tier = tiers.sortedByDescending { it.minAmount }.firstOrNull { amountMinor >= it.minAmount } ?: return 0
        return floor(amountMinor * tier.bonusPercent / 100.0).toLong()
    }

    fun planPrice(plan: PlanDef, period: BillingPeriod): Long = if (period == BillingPeriod.YEAR) plan.priceYearly else plan.priceMonthly

    /** Nights between two ISO dates (YYYY-MM-DD). */
    fun nightsBetween(checkIn: String, checkOut: String): Int =
        ChronoUnit.DAYS.between(LocalDate.parse(checkIn), LocalDate.parse(checkOut)).toInt()

    data class BookingPrice(val subtotal: Long, val guestFee: Long, val hostFee: Long, val total: Long, val hostPayout: Long)

    /** Identical to the server calculation: [nightlyPriceMajor] in MAJOR units → result in MINOR units. */
    fun calcBooking(nightlyPriceMajor: Long, nights: Int, guestFeePercent: Double, hostFeePercent: Double): BookingPrice {
        val subtotal = nightlyPriceMajor * 100 * nights
        val guestFee = jsRound(subtotal * guestFeePercent / 100.0)
        val hostFee = jsRound(subtotal * hostFeePercent / 100.0)
        return BookingPrice(subtotal, guestFee, hostFee, subtotal + guestFee, subtotal - hostFee)
    }

    /** Sum of the bundle's services at list price minus the bundle price (what the customer saves). */
    fun bundleSavings(bundle: BundleDef, services: List<ServiceDef>): Long {
        val sum = bundle.serviceCodes.sumOf { code -> services.firstOrNull { it.code == code }?.price ?: 0 }
        return (sum - bundle.price).coerceAtLeast(0)
    }

    /** JavaScript Math.round semantics (half up toward +∞). */
    private fun jsRound(v: Double): Long = floor(v + 0.5).toLong()

    fun yearlySavingMonths(plan: PlanDef): Double =
        if (plan.priceMonthly <= 0) 0.0 else ((plan.priceMonthly * 12 - plan.priceYearly).toDouble() / plan.priceMonthly * 10).roundToLong() / 10.0
}

object DefaultCatalog {
    private fun t(az: String, ru: String, en: String) = LocalizedText(az, ru, en)

    val services: List<ServiceDef> = listOf(
        ServiceDef("BUMP_1", PromotionType.BUMP, 0, 100, true, 10, t("Yuxarı qaldır", "Поднять в топ", "Bump to top"),
            t("Elanınız axtarışda ən yuxarıya qalxır", "Объявление поднимается на первое место в поиске", "Moves your listing to the top of search results")),
        ServiceDef("AUTO_BUMP_7", PromotionType.AUTO_BUMP, 7, 500, true, 20, t("Avto-qaldırma (7 gün)", "Автоподнятие (7 дней)", "Auto-bump (7 days)"),
            t("7 gün ərzində hər gün avtomatik yuxarı qalxır", "Каждый день в течение 7 дней поднимается автоматически", "Automatically bumped once a day for 7 days")),
        ServiceDef("VIP_1", PromotionType.VIP, 1, 150, true, 30, t("VIP (1 gün)", "VIP (1 день)", "VIP (1 day)"),
            t("Elan VIP blokunda göstərilir", "Показ в VIP-блоке", "Shown in the VIP block above regular results")),
        ServiceDef("VIP_7", PromotionType.VIP, 7, 700, true, 31, t("VIP (7 gün)", "VIP (7 дней)", "VIP (7 days)"),
            t("Elan 7 gün VIP blokunda göstərilir", "Показ в VIP-блоке 7 дней", "VIP block for 7 days")),
        ServiceDef("VIP_30", PromotionType.VIP, 30, 2000, true, 32, t("VIP (30 gün)", "VIP (30 дней)", "VIP (30 days)"),
            t("Elan 30 gün VIP blokunda göstərilir", "Показ в VIP-блоке 30 дней", "VIP block for 30 days")),
        ServiceDef("PREMIUM_1", PromotionType.PREMIUM, 1, 300, true, 40, t("Premium (1 gün)", "Премиум (1 день)", "Premium (1 day)"),
            t("Ana səhifədə və axtarışın ən başında", "На главной странице и в самом верху поиска", "Homepage carousel and the very top of search")),
        ServiceDef("PREMIUM_7", PromotionType.PREMIUM, 7, 1500, true, 41, t("Premium (7 gün)", "Премиум (7 дней)", "Premium (7 days)"),
            t("Ana səhifə + axtarışın başı, 7 gün", "Главная + верх поиска, 7 дней", "Homepage + top of search for 7 days")),
        ServiceDef("PREMIUM_30", PromotionType.PREMIUM, 30, 4500, true, 42, t("Premium (30 gün)", "Премиум (30 дней)", "Premium (30 days)"),
            t("Ana səhifə + axtarışın başı, 30 gün", "Главная + верх поиска, 30 дней", "Homepage + top of search for 30 days")),
        ServiceDef("HIGHLIGHT_7", PromotionType.HIGHLIGHT, 7, 200, true, 50, t("Rəngli fon (7 gün)", "Цветной фон (7 дней)", "Highlight (7 days)"),
            t("Elan rəngli fonla seçilir", "Объявление выделяется цветом", "Listing card stands out with a colour")),
        ServiceDef("URGENT_7", PromotionType.URGENT, 7, 200, true, 60, t("\"Təcili\" nişanı (7 gün)", "Значок «Срочно» (7 дней)", "\"Urgent\" badge (7 days)"),
            t("Elanda \"Təcili\" nişanı göstərilir", "Значок «Срочно» на объявлении", "Shows an \"Urgent\" badge")),
        ServiceDef("VERIFICATION", null, 0, 1500, true, 90, t("Yoxlanılmış elan", "Проверенное объявление", "Verified listing"),
            t("Əməkdaşımız əmlakı yerində yoxlayır, elan \"Yoxlanılıb\" nişanı alır", "Наш сотрудник проверяет объект на месте", "Our inspector visits the property; listing gets a \"Verified\" badge")),
    )

    val bundles: List<BundleDef> = listOf(
        BundleDef("FAST_SALE", listOf("VIP_7", "AUTO_BUMP_7", "URGENT_7"), 1100, t("Sürətli satış paketi", "Пакет «Быстрая продажа»", "Fast sale bundle")),
        BundleDef("MAX_VISIBILITY", listOf("PREMIUM_7", "VIP_7", "HIGHLIGHT_7", "AUTO_BUMP_7"), 2400, t("Maksimum görünmə", "Максимальный охват", "Maximum visibility")),
    )

    val plans: List<PlanDef> = listOf(
        PlanDef(PlanCode.START, 4900, 49000, 25, 30, 0, 0, 2, listOf("agency_page", "business_badge", "basic_stats"), true, t("Start", "Старт", "Start")),
        PlanDef(PlanCode.PRO, 12900, 129000, 100, 150, 5, 1, 10,
            listOf("agency_page", "business_badge", "advanced_stats", "leads_crm", "priority_moderation"), true, t("Pro", "Про", "Pro")),
        PlanDef(PlanCode.ENTERPRISE, 29900, 299000, -1, 600, 20, 5, 50,
            listOf("agency_page", "business_badge", "advanced_stats", "leads_crm", "priority_moderation", "xml_feed_import", "dedicated_manager", "developer_projects"),
            true, t("Enterprise", "Энтерпрайз", "Enterprise")),
    )

    val settings = CatalogSettings(
        freeListingsPerMonth = 2,
        listingFee = 300,
        listingLifetimeDays = 30,
        dailyRentGuestFeePercent = 8.0,
        dailyRentHostFeePercent = 3.0,
        freeCancellationHours = 48,
        topupBonuses = listOf(TopupBonusTier(5000, 5.0), TopupBonusTier(10000, 10.0), TopupBonusTier(30000, 15.0)),
        minTopup = 100,
        maxTopup = 500_000,
    )

    val catalog = Catalog(services, bundles, plans, settings)
}
