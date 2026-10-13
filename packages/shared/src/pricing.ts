/**
 * Monetization catalog — DEFAULT values. The API seeds these into the DB on first start;
 * admins can then change prices / durations / activation from the admin dashboard.
 *
 * All money amounts in this file are in MINOR units (qəpik: 1 AZN = 100).
 * See docs/BUSINESS_MODEL.md for the reasoning behind the numbers.
 */
import type { BillingPeriod, PromotionType } from './enums';

export interface ServiceDef {
  code: string;
  promotionType: PromotionType | null; // null => not a listing promotion (e.g. verification)
  /** For BUMP: number of bumps. For AUTO_BUMP/VIP/PREMIUM/HIGHLIGHT/URGENT: days. */
  durationDays: number;
  price: number; // minor units, AZN
  active: boolean;
  sortOrder: number;
  name: { az: string; ru: string; en: string };
  description: { az: string; ru: string; en: string };
}

export const SERVICE_CATALOG: ServiceDef[] = [
  { code: 'BUMP_1', promotionType: 'BUMP', durationDays: 0, price: 100, active: true, sortOrder: 10,
    name: { az: 'Yuxarı qaldır', ru: 'Поднять в топ', en: 'Bump to top' },
    description: { az: 'Elanınız axtarışda ən yuxarıya qalxır', ru: 'Объявление поднимается на первое место в поиске', en: 'Moves your listing to the top of search results' } },
  { code: 'AUTO_BUMP_7', promotionType: 'AUTO_BUMP', durationDays: 7, price: 500, active: true, sortOrder: 20,
    name: { az: 'Avto-qaldırma (7 gün)', ru: 'Автоподнятие (7 дней)', en: 'Auto-bump (7 days)' },
    description: { az: '7 gün ərzində hər gün avtomatik yuxarı qalxır', ru: 'Каждый день в течение 7 дней поднимается автоматически', en: 'Automatically bumped once a day for 7 days' } },
  { code: 'VIP_1', promotionType: 'VIP', durationDays: 1, price: 150, active: true, sortOrder: 30,
    name: { az: 'VIP (1 gün)', ru: 'VIP (1 день)', en: 'VIP (1 day)' },
    description: { az: 'Elan VIP blokunda göstərilir', ru: 'Показ в VIP-блоке', en: 'Shown in the VIP block above regular results' } },
  { code: 'VIP_7', promotionType: 'VIP', durationDays: 7, price: 700, active: true, sortOrder: 31,
    name: { az: 'VIP (7 gün)', ru: 'VIP (7 дней)', en: 'VIP (7 days)' },
    description: { az: 'Elan 7 gün VIP blokunda göstərilir', ru: 'Показ в VIP-блоке 7 дней', en: 'VIP block for 7 days' } },
  { code: 'VIP_30', promotionType: 'VIP', durationDays: 30, price: 2000, active: true, sortOrder: 32,
    name: { az: 'VIP (30 gün)', ru: 'VIP (30 дней)', en: 'VIP (30 days)' },
    description: { az: 'Elan 30 gün VIP blokunda göstərilir', ru: 'Показ в VIP-блоке 30 дней', en: 'VIP block for 30 days' } },
  { code: 'PREMIUM_1', promotionType: 'PREMIUM', durationDays: 1, price: 300, active: true, sortOrder: 40,
    name: { az: 'Premium (1 gün)', ru: 'Премиум (1 день)', en: 'Premium (1 day)' },
    description: { az: 'Ana səhifədə və axtarışın ən başında', ru: 'На главной странице и в самом верху поиска', en: 'Homepage carousel and the very top of search' } },
  { code: 'PREMIUM_7', promotionType: 'PREMIUM', durationDays: 7, price: 1500, active: true, sortOrder: 41,
    name: { az: 'Premium (7 gün)', ru: 'Премиум (7 дней)', en: 'Premium (7 days)' },
    description: { az: 'Ana səhifə + axtarışın başı, 7 gün', ru: 'Главная + верх поиска, 7 дней', en: 'Homepage + top of search for 7 days' } },
  { code: 'PREMIUM_30', promotionType: 'PREMIUM', durationDays: 30, price: 4500, active: true, sortOrder: 42,
    name: { az: 'Premium (30 gün)', ru: 'Премиум (30 дней)', en: 'Premium (30 days)' },
    description: { az: 'Ana səhifə + axtarışın başı, 30 gün', ru: 'Главная + верх поиска, 30 дней', en: 'Homepage + top of search for 30 days' } },
  { code: 'HIGHLIGHT_7', promotionType: 'HIGHLIGHT', durationDays: 7, price: 200, active: true, sortOrder: 50,
    name: { az: 'Rəngli fon (7 gün)', ru: 'Цветной фон (7 дней)', en: 'Highlight (7 days)' },
    description: { az: 'Elan rəngli fonla seçilir', ru: 'Объявление выделяется цветом', en: 'Listing card stands out with a colour' } },
  { code: 'URGENT_7', promotionType: 'URGENT', durationDays: 7, price: 200, active: true, sortOrder: 60,
    name: { az: '"Təcili" nişanı (7 gün)', ru: 'Значок «Срочно» (7 дней)', en: '"Urgent" badge (7 days)' },
    description: { az: 'Elanda "Təcili" nişanı göstərilir', ru: 'Значок «Срочно» на объявлении', en: 'Shows an "Urgent" badge' } },
  { code: 'VERIFICATION', promotionType: null, durationDays: 0, price: 1500, active: true, sortOrder: 90,
    name: { az: 'Yoxlanılmış elan', ru: 'Проверенное объявление', en: 'Verified listing' },
    description: { az: 'Əməkdaşımız əmlakı yerində yoxlayır, elan "Yoxlanılıb" nişanı alır', ru: 'Наш сотрудник проверяет объект на месте', en: 'Our inspector visits the property; listing gets a "Verified" badge' } },
];

/** Bundles = several service codes sold together at a discount. */
export interface BundleDef { code: string; serviceCodes: string[]; price: number; name: { az: string; ru: string; en: string } }
export const BUNDLES: BundleDef[] = [
  { code: 'FAST_SALE', serviceCodes: ['VIP_7', 'AUTO_BUMP_7', 'URGENT_7'], price: 1100,
    name: { az: 'Sürətli satış paketi', ru: 'Пакет «Быстрая продажа»', en: 'Fast sale bundle' } },
  { code: 'MAX_VISIBILITY', serviceCodes: ['PREMIUM_7', 'VIP_7', 'HIGHLIGHT_7', 'AUTO_BUMP_7'], price: 2400,
    name: { az: 'Maksimum görünmə', ru: 'Максимальный охват', en: 'Maximum visibility' } },
];

export interface PlanDef {
  code: 'START' | 'PRO' | 'ENTERPRISE';
  priceMonthly: number; // minor units
  priceYearly: number; // minor units (≈ 2 months free)
  listingQuota: number; // simultaneous active listings; -1 = unlimited
  monthlyBumps: number;
  monthlyVipCredits: number; // each credit = VIP_7
  monthlyPremiumCredits: number; // each credit = PREMIUM_7
  maxAgents: number;
  features: string[]; // feature keys, translated on clients
  active: boolean;
  name: { az: string; ru: string; en: string };
}

export const PLANS: PlanDef[] = [
  { code: 'START', priceMonthly: 4900, priceYearly: 49000, listingQuota: 25, monthlyBumps: 30, monthlyVipCredits: 0, monthlyPremiumCredits: 0, maxAgents: 2,
    features: ['agency_page', 'business_badge', 'basic_stats'], active: true,
    name: { az: 'Start', ru: 'Старт', en: 'Start' } },
  { code: 'PRO', priceMonthly: 12900, priceYearly: 129000, listingQuota: 100, monthlyBumps: 150, monthlyVipCredits: 5, monthlyPremiumCredits: 1, maxAgents: 10,
    features: ['agency_page', 'business_badge', 'advanced_stats', 'leads_crm', 'priority_moderation'], active: true,
    name: { az: 'Pro', ru: 'Про', en: 'Pro' } },
  { code: 'ENTERPRISE', priceMonthly: 29900, priceYearly: 299000, listingQuota: -1, monthlyBumps: 600, monthlyVipCredits: 20, monthlyPremiumCredits: 5, maxAgents: 50,
    features: ['agency_page', 'business_badge', 'advanced_stats', 'leads_crm', 'priority_moderation', 'xml_feed_import', 'dedicated_manager', 'developer_projects'], active: true,
    name: { az: 'Enterprise', ru: 'Энтерпрайз', en: 'Enterprise' } },
];

/** Platform-wide settings (editable in admin → Settings). */
export interface PlatformSettings {
  freeListingsPerMonth: number; // individuals: free SALE/RENT_LONG listings published per rolling 30 days
  listingFee: number; // minor units, paid listing once free quota is used
  listingLifetimeDays: number; // listing auto-expires after N days
  dailyRentGuestFeePercent: number; // service fee charged to guest on top of the price (Airbnb model)
  dailyRentHostFeePercent: number; // commission deducted from host payout
  payoutDelayHours: number; // hours after check-in before host payout is released
  freeCancellationHours: number; // guest cancels ≥ N hours before check-in → full refund, else 50%
  topupBonuses: { minAmount: number; bonusPercent: number }[]; // minor units
  minTopup: number;
  maxTopup: number;
  moderationEnabled: boolean;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  freeListingsPerMonth: 2,
  listingFee: 300,
  listingLifetimeDays: 30,
  dailyRentGuestFeePercent: 8,
  dailyRentHostFeePercent: 3,
  payoutDelayHours: 24,
  freeCancellationHours: 48,
  topupBonuses: [
    { minAmount: 5000, bonusPercent: 5 },
    { minAmount: 10000, bonusPercent: 10 },
    { minAmount: 30000, bonusPercent: 15 },
  ],
  minTopup: 100,
  maxTopup: 500000,
  moderationEnabled: true,
};

export const topupBonus = (amount: number, s: PlatformSettings = DEFAULT_SETTINGS) => {
  const tier = [...s.topupBonuses].sort((a, b) => b.minAmount - a.minAmount).find((t) => amount >= t.minAmount);
  return tier ? Math.floor((amount * tier.bonusPercent) / 100) : 0;
};

export const planPrice = (plan: Pick<PlanDef, 'priceMonthly' | 'priceYearly'>, period: BillingPeriod) =>
  period === 'YEAR' ? plan.priceYearly : plan.priceMonthly;

/** Nights between two ISO dates (YYYY-MM-DD). */
export const nightsBetween = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(checkOut + 'T00:00:00Z') - Date.parse(checkIn + 'T00:00:00Z')) / 86_400_000);

/**
 * Booking price calculation, identical on client (preview) and server (authoritative).
 * nightlyPrice is in MAJOR units (listing prices are whole AZN), result in minor units.
 */
export const calcBooking = (nightlyPriceMajor: number, nights: number, s: Pick<PlatformSettings, 'dailyRentGuestFeePercent' | 'dailyRentHostFeePercent'> = DEFAULT_SETTINGS) => {
  const subtotal = nightlyPriceMajor * 100 * nights;
  const guestFee = Math.round((subtotal * s.dailyRentGuestFeePercent) / 100);
  const hostFee = Math.round((subtotal * s.dailyRentHostFeePercent) / 100);
  return { subtotal, guestFee, hostFee, total: subtotal + guestFee, hostPayout: subtotal - hostFee };
};
