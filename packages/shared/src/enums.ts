/**
 * Domain enums. Declared as `const` objects + union types so they work the same
 * in Node (API), browsers (web/admin) and React Native (mobile) without TS `enum` quirks.
 */

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as T[keyof T][];

export const Locale = { AZ: 'az', RU: 'ru', EN: 'en' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
export const LOCALES = values(Locale);
export const DEFAULT_LOCALE: Locale = 'az';

export const Currency = { AZN: 'AZN', USD: 'USD', EUR: 'EUR', GEL: 'GEL' } as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
export const CURRENCIES = values(Currency);

export const CountryCode = { AZ: 'AZ', GE: 'GE' } as const;
export type CountryCode = (typeof CountryCode)[keyof typeof CountryCode];

export const UserRole = { USER: 'USER', MODERATOR: 'MODERATOR', ADMIN: 'ADMIN' } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES = values(UserRole);

export const AccountType = { INDIVIDUAL: 'INDIVIDUAL', BUSINESS: 'BUSINESS' } as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const UserStatus = { ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED', DELETED: 'DELETED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = values(UserStatus);

export const AgencyType = { AGENCY: 'AGENCY', DEVELOPER: 'DEVELOPER' } as const;
export type AgencyType = (typeof AgencyType)[keyof typeof AgencyType];

export const AgencyMemberRole = { OWNER: 'OWNER', AGENT: 'AGENT' } as const;
export type AgencyMemberRole = (typeof AgencyMemberRole)[keyof typeof AgencyMemberRole];

/** Sale, long-term rent (monthly) and daily / short-term rent (Airbnb-style, bookable online). */
export const DealType = { SALE: 'SALE', RENT_LONG: 'RENT_LONG', RENT_DAILY: 'RENT_DAILY' } as const;
export type DealType = (typeof DealType)[keyof typeof DealType];
export const DEAL_TYPES = values(DealType);

export const PropertyType = {
  APARTMENT: 'APARTMENT',
  HOUSE: 'HOUSE', // həyət evi / villa / bağ evi
  OFFICE: 'OFFICE',
  COMMERCIAL: 'COMMERCIAL', // obyekt: shop, restaurant, warehouse
  LAND: 'LAND',
  GARAGE: 'GARAGE',
  ROOM: 'ROOM',
} as const;
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];
export const PROPERTY_TYPES = values(PropertyType);

/** For apartments: new building (yeni tikili) vs secondary market (köhnə tikili). */
export const BuildingType = { NEW: 'NEW', SECONDARY: 'SECONDARY' } as const;
export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export const RepairType = { NONE: 'NONE', COSMETIC: 'COSMETIC', EURO: 'EURO', DESIGNER: 'DESIGNER' } as const;
export type RepairType = (typeof RepairType)[keyof typeof RepairType];
export const REPAIR_TYPES = values(RepairType);

export const PricePeriod = { TOTAL: 'TOTAL', MONTH: 'MONTH', DAY: 'DAY' } as const;
export type PricePeriod = (typeof PricePeriod)[keyof typeof PricePeriod];

export const ListingStatus = {
  DRAFT: 'DRAFT', // created but waiting for listing-fee payment
  PENDING: 'PENDING', // waiting for moderation
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED', // removed by owner
  SOLD: 'SOLD', // sold / rented out
  BLOCKED: 'BLOCKED', // blocked by admin
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];
export const LISTING_STATUSES = values(ListingStatus);

export const Amenity = {
  BALCONY: 'BALCONY',
  PARKING: 'PARKING',
  ELEVATOR: 'ELEVATOR',
  FURNITURE: 'FURNITURE',
  KITCHEN_FURNITURE: 'KITCHEN_FURNITURE',
  INTERNET: 'INTERNET',
  WIFI: 'WIFI',
  AIR_CONDITIONER: 'AIR_CONDITIONER',
  CENTRAL_HEATING: 'CENTRAL_HEATING',
  KOMBI: 'KOMBI',
  GAS: 'GAS',
  WATER: 'WATER',
  ELECTRICITY: 'ELECTRICITY',
  WASHING_MACHINE: 'WASHING_MACHINE',
  DISHWASHER: 'DISHWASHER',
  REFRIGERATOR: 'REFRIGERATOR',
  TV: 'TV',
  POOL: 'POOL',
  GARDEN: 'GARDEN',
  SECURITY: 'SECURITY',
  CCTV: 'CCTV',
  SEA_VIEW: 'SEA_VIEW',
  PETS_ALLOWED: 'PETS_ALLOWED',
  KIDS_ALLOWED: 'KIDS_ALLOWED',
  SMOKING_ALLOWED: 'SMOKING_ALLOWED',
  SAUNA: 'SAUNA',
  BBQ: 'BBQ',
} as const;
export type Amenity = (typeof Amenity)[keyof typeof Amenity];
export const AMENITIES = values(Amenity);

export const ListingSort = {
  DATE_DESC: 'date_desc', // default: by bumpedAt desc
  PRICE_ASC: 'price_asc',
  PRICE_DESC: 'price_desc',
  AREA_ASC: 'area_asc',
  AREA_DESC: 'area_desc',
} as const;
export type ListingSort = (typeof ListingSort)[keyof typeof ListingSort];

/** Paid services that can be applied to a listing. */
export const PromotionType = {
  BUMP: 'BUMP', // "Yuxarı qaldır" — moves listing to the top of results (bumpedAt = now)
  AUTO_BUMP: 'AUTO_BUMP', // automatic bump once a day for N days
  VIP: 'VIP', // shown in the VIP block above regular results
  PREMIUM: 'PREMIUM', // homepage carousel + top of VIP block
  HIGHLIGHT: 'HIGHLIGHT', // coloured card in results
  URGENT: 'URGENT', // "Təcili" badge
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];
export const PROMOTION_TYPES = values(PromotionType);

export const PaymentPurpose = {
  WALLET_TOPUP: 'WALLET_TOPUP',
  PROMOTION: 'PROMOTION',
  LISTING_FEE: 'LISTING_FEE',
  SUBSCRIPTION: 'SUBSCRIPTION',
  BOOKING: 'BOOKING',
  VERIFICATION: 'VERIFICATION',
} as const;
export type PaymentPurpose = (typeof PaymentPurpose)[keyof typeof PaymentPurpose];
export const PAYMENT_PURPOSES = values(PaymentPurpose);

export const PaymentMethod = { CARD: 'CARD', WALLET: 'WALLET' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING', // redirected to the bank
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUSES = values(PaymentStatus);

export const WalletTxType = {
  TOPUP: 'TOPUP',
  BONUS: 'BONUS',
  SPEND: 'SPEND',
  REFUND: 'REFUND',
  PAYOUT: 'PAYOUT', // host earnings for daily rentals credited to wallet
  ADJUSTMENT: 'ADJUSTMENT', // manual admin correction
} as const;
export type WalletTxType = (typeof WalletTxType)[keyof typeof WalletTxType];

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED', // auto-renew off, valid until period end
  EXPIRED: 'EXPIRED',
  PAST_DUE: 'PAST_DUE', // renewal charge failed
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const BillingPeriod = { MONTH: 'MONTH', YEAR: 'YEAR' } as const;
export type BillingPeriod = (typeof BillingPeriod)[keyof typeof BillingPeriod];

export const BookingStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  REFUNDED: 'REFUNDED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];
export const BOOKING_STATUSES = values(BookingStatus);

export const PayoutStatus = { NOT_DUE: 'NOT_DUE', PENDING: 'PENDING', PAID: 'PAID', CANCELLED: 'CANCELLED' } as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const ReportReason = {
  FAKE: 'FAKE', // not real / does not exist
  WRONG_PRICE: 'WRONG_PRICE',
  WRONG_PHOTOS: 'WRONG_PHOTOS',
  ALREADY_SOLD: 'ALREADY_SOLD',
  AGENT_AS_OWNER: 'AGENT_AS_OWNER', // agency posting as private owner
  DUPLICATE: 'DUPLICATE',
  FRAUD: 'FRAUD',
  OTHER: 'OTHER',
} as const;
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];
export const REPORT_REASONS = values(ReportReason);

export const ReportStatus = { OPEN: 'OPEN', RESOLVED: 'RESOLVED', DISMISSED: 'DISMISSED' } as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const NotificationType = {
  LISTING_APPROVED: 'LISTING_APPROVED',
  LISTING_REJECTED: 'LISTING_REJECTED',
  LISTING_EXPIRING: 'LISTING_EXPIRING',
  LISTING_EXPIRED: 'LISTING_EXPIRED',
  NEW_MESSAGE: 'NEW_MESSAGE',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  BOOKING_NEW: 'BOOKING_NEW',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  PAYOUT: 'PAYOUT',
  SAVED_SEARCH_MATCH: 'SAVED_SEARCH_MATCH',
  PROMOTION_EXPIRED: 'PROMOTION_EXPIRED',
  SUBSCRIPTION_RENEWED: 'SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const BannerPlacement = {
  HOME_TOP: 'HOME_TOP',
  SEARCH_TOP: 'SEARCH_TOP',
  SEARCH_SIDEBAR: 'SEARCH_SIDEBAR',
  LISTING_SIDEBAR: 'LISTING_SIDEBAR',
  MOBILE_HOME: 'MOBILE_HOME',
} as const;
export type BannerPlacement = (typeof BannerPlacement)[keyof typeof BannerPlacement];
export const BANNER_PLACEMENTS = values(BannerPlacement);

export const DevicePlatform = { IOS: 'ios', ANDROID: 'android', WEB: 'web' } as const;
export type DevicePlatform = (typeof DevicePlatform)[keyof typeof DevicePlatform];

export const MortgageLeadStatus = { NEW: 'NEW', SENT_TO_BANK: 'SENT_TO_BANK', CLOSED: 'CLOSED' } as const;
export type MortgageLeadStatus = (typeof MortgageLeadStatus)[keyof typeof MortgageLeadStatus];
