import Foundation

/// Port of `packages/shared/src/pricing.ts` — identical math on client (preview) and server (authoritative).
public enum Pricing {
    public struct BookingBreakdown: Sendable, Hashable {
        public let subtotal: Int
        public let guestFee: Int
        public let hostFee: Int
        public let total: Int
        public let hostPayout: Int
    }

    /// `nightlyPriceMajor` in MAJOR units; result in MINOR units. JS `Math.round` semantics (half up).
    public static func calcBooking(nightlyPriceMajor: Int, nights: Int, guestFeePercent: Double, hostFeePercent: Double) -> BookingBreakdown {
        let subtotal = nightlyPriceMajor * 100 * nights
        let guestFee = jsRound(Double(subtotal) * guestFeePercent / 100)
        let hostFee = jsRound(Double(subtotal) * hostFeePercent / 100)
        return BookingBreakdown(subtotal: subtotal, guestFee: guestFee, hostFee: hostFee, total: subtotal + guestFee, hostPayout: subtotal - hostFee)
    }

    public static func calcBooking(nightlyPriceMajor: Int, nights: Int, settings: CatalogSettings) -> BookingBreakdown {
        calcBooking(nightlyPriceMajor: nightlyPriceMajor, nights: nights, guestFeePercent: settings.dailyRentGuestFeePercent,
                    hostFeePercent: settings.dailyRentHostFeePercent)
    }

    /// Wallet top-up bonus (minor): highest tier whose `minAmount ≤ amount`, floored like the server.
    public static func topupBonus(amount: Int, tiers: [TopupBonusTier]) -> Int {
        guard let tier = tiers.sorted(by: { $0.minAmount > $1.minAmount }).first(where: { amount >= $0.minAmount }) else { return 0 }
        return Int((Double(amount) * tier.bonusPercent / 100).rounded(.down))
    }

    /// The tier that applies to `amount` (for highlighting in the UI).
    public static func topupTier(amount: Int, tiers: [TopupBonusTier]) -> TopupBonusTier? {
        tiers.sorted(by: { $0.minAmount > $1.minAmount }).first(where: { amount >= $0.minAmount })
    }

    /// `Math.round`: rounds .5 towards +∞.
    static func jsRound(_ v: Double) -> Int { Int((v + 0.5).rounded(.down)) }
}

public extension Catalog {
    /// Shared defaults (DB seed values) — used until `GET /catalog` answers or when offline.
    static let fallback = Catalog(
        services: [
            ServiceDef(code: "BUMP_1", promotionType: .BUMP, durationDays: 0, price: 100, active: true, sortOrder: 10,
                       name: .init(az: "Yuxarı qaldır", ru: "Поднять в топ", en: "Bump to top"),
                       description: .init(az: "Elanınız axtarışda ən yuxarıya qalxır", ru: "Объявление поднимается на первое место в поиске", en: "Moves your listing to the top of search results")),
            ServiceDef(code: "AUTO_BUMP_7", promotionType: .AUTO_BUMP, durationDays: 7, price: 500, active: true, sortOrder: 20,
                       name: .init(az: "Avto-qaldırma (7 gün)", ru: "Автоподнятие (7 дней)", en: "Auto-bump (7 days)"),
                       description: .init(az: "7 gün ərzində hər gün avtomatik yuxarı qalxır", ru: "Каждый день в течение 7 дней поднимается автоматически", en: "Automatically bumped once a day for 7 days")),
            ServiceDef(code: "VIP_1", promotionType: .VIP, durationDays: 1, price: 150, active: true, sortOrder: 30,
                       name: .init(az: "VIP (1 gün)", ru: "VIP (1 день)", en: "VIP (1 day)"),
                       description: .init(az: "Elan VIP blokunda göstərilir", ru: "Показ в VIP-блоке", en: "Shown in the VIP block above regular results")),
            ServiceDef(code: "VIP_7", promotionType: .VIP, durationDays: 7, price: 700, active: true, sortOrder: 31,
                       name: .init(az: "VIP (7 gün)", ru: "VIP (7 дней)", en: "VIP (7 days)"),
                       description: .init(az: "Elan 7 gün VIP blokunda göstərilir", ru: "Показ в VIP-блоке 7 дней", en: "VIP block for 7 days")),
            ServiceDef(code: "VIP_30", promotionType: .VIP, durationDays: 30, price: 2000, active: true, sortOrder: 32,
                       name: .init(az: "VIP (30 gün)", ru: "VIP (30 дней)", en: "VIP (30 days)"),
                       description: .init(az: "Elan 30 gün VIP blokunda göstərilir", ru: "Показ в VIP-блоке 30 дней", en: "VIP block for 30 days")),
            ServiceDef(code: "PREMIUM_1", promotionType: .PREMIUM, durationDays: 1, price: 300, active: true, sortOrder: 40,
                       name: .init(az: "Premium (1 gün)", ru: "Премиум (1 день)", en: "Premium (1 day)"),
                       description: .init(az: "Ana səhifədə və axtarışın ən başında", ru: "На главной странице и в самом верху поиска", en: "Homepage carousel and the very top of search")),
            ServiceDef(code: "PREMIUM_7", promotionType: .PREMIUM, durationDays: 7, price: 1500, active: true, sortOrder: 41,
                       name: .init(az: "Premium (7 gün)", ru: "Премиум (7 дней)", en: "Premium (7 days)"),
                       description: .init(az: "Ana səhifə + axtarışın başı, 7 gün", ru: "Главная + верх поиска, 7 дней", en: "Homepage + top of search for 7 days")),
            ServiceDef(code: "PREMIUM_30", promotionType: .PREMIUM, durationDays: 30, price: 4500, active: true, sortOrder: 42,
                       name: .init(az: "Premium (30 gün)", ru: "Премиум (30 дней)", en: "Premium (30 days)"),
                       description: .init(az: "Ana səhifə + axtarışın başı, 30 gün", ru: "Главная + верх поиска, 30 дней", en: "Homepage + top of search for 30 days")),
            ServiceDef(code: "HIGHLIGHT_7", promotionType: .HIGHLIGHT, durationDays: 7, price: 200, active: true, sortOrder: 50,
                       name: .init(az: "Rəngli fon (7 gün)", ru: "Цветной фон (7 дней)", en: "Highlight (7 days)"),
                       description: .init(az: "Elan rəngli fonla seçilir", ru: "Объявление выделяется цветом", en: "Listing card stands out with a colour")),
            ServiceDef(code: "URGENT_7", promotionType: .URGENT, durationDays: 7, price: 200, active: true, sortOrder: 60,
                       name: .init(az: "\"Təcili\" nişanı (7 gün)", ru: "Значок «Срочно» (7 дней)", en: "\"Urgent\" badge (7 days)"),
                       description: .init(az: "Elanda \"Təcili\" nişanı göstərilir", ru: "Значок «Срочно» на объявлении", en: "Shows an \"Urgent\" badge")),
            ServiceDef(code: "VERIFICATION", promotionType: nil, durationDays: 0, price: 1500, active: true, sortOrder: 90,
                       name: .init(az: "Yoxlanılmış elan", ru: "Проверенное объявление", en: "Verified listing"),
                       description: .init(az: "Əməkdaşımız əmlakı yerində yoxlayır, elan \"Yoxlanılıb\" nişanı alır", ru: "Наш сотрудник проверяет объект на месте", en: "Our inspector visits the property; listing gets a \"Verified\" badge")),
        ],
        bundles: [
            BundleDef(code: "FAST_SALE", serviceCodes: ["VIP_7", "AUTO_BUMP_7", "URGENT_7"], price: 1100,
                      name: .init(az: "Sürətli satış paketi", ru: "Пакет «Быстрая продажа»", en: "Fast sale bundle")),
            BundleDef(code: "MAX_VISIBILITY", serviceCodes: ["PREMIUM_7", "VIP_7", "HIGHLIGHT_7", "AUTO_BUMP_7"], price: 2400,
                      name: .init(az: "Maksimum görünmə", ru: "Максимальный охват", en: "Maximum visibility")),
        ],
        plans: [
            PlanDef(code: .START, priceMonthly: 4900, priceYearly: 49000, listingQuota: 25, monthlyBumps: 30, monthlyVipCredits: 0,
                    monthlyPremiumCredits: 0, maxAgents: 2, features: ["agency_page", "business_badge", "basic_stats"], active: true,
                    name: .init(az: "Start", ru: "Старт", en: "Start")),
            PlanDef(code: .PRO, priceMonthly: 12900, priceYearly: 129000, listingQuota: 100, monthlyBumps: 150, monthlyVipCredits: 5,
                    monthlyPremiumCredits: 1, maxAgents: 10,
                    features: ["agency_page", "business_badge", "advanced_stats", "leads_crm", "priority_moderation"], active: true,
                    name: .init(az: "Pro", ru: "Про", en: "Pro")),
            PlanDef(code: .ENTERPRISE, priceMonthly: 29900, priceYearly: 299000, listingQuota: -1, monthlyBumps: 600, monthlyVipCredits: 20,
                    monthlyPremiumCredits: 5, maxAgents: 50,
                    features: ["agency_page", "business_badge", "advanced_stats", "leads_crm", "priority_moderation", "xml_feed_import",
                               "dedicated_manager", "developer_projects"],
                    active: true, name: .init(az: "Enterprise", ru: "Энтерпрайз", en: "Enterprise")),
        ],
        settings: CatalogSettings(
            freeListingsPerMonth: 2, listingFee: 300, listingLifetimeDays: 30, dailyRentGuestFeePercent: 8, dailyRentHostFeePercent: 3,
            freeCancellationHours: 48,
            topupBonuses: [TopupBonusTier(minAmount: 5000, bonusPercent: 5), TopupBonusTier(minAmount: 10000, bonusPercent: 10),
                           TopupBonusTier(minAmount: 30000, bonusPercent: 15)],
            minTopup: 100, maxTopup: 500_000
        )
    )
}
