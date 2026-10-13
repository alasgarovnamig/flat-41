/**
 * zod RESPONSE schemas mirroring every DTO in packages/shared/src/types.ts.
 * Rules: required keys and types must match exactly (nullables are `T | null`, never missing); unknown extra keys are
 * allowed (z.object strips them); timestamps are ISO-8601 date-times, booking/calendar dates are `YYYY-MM-DD`.
 * Fields added by the v2 contract (MapPoint.title/coverUrl, ListingImage.uploadId, ListingDetail.contactPhone) are
 * NOT part of these base schemas — dedicated `[v2]` tests assert them, so `SKIP_V2=1` runs stay meaningful.
 */
import { z } from 'zod';
import {
  AccountType, AgencyMemberRole, AgencyType, AMENITIES, BANNER_PLACEMENTS, BillingPeriod, BOOKING_STATUSES, BuildingType, CountryCode,
  CURRENCIES, DEAL_TYPES, LISTING_STATUSES, LOCALES, MortgageLeadStatus, NotificationType, PAYMENT_PURPOSES, PAYMENT_STATUSES,
  PaymentMethod, PayoutStatus, PricePeriod, PROMOTION_TYPES, PROPERTY_TYPES, REPAIR_TYPES, REPORT_REASONS, ReportStatus,
  SubscriptionStatus, USER_ROLES, USER_STATUSES, WalletTxType, ERROR_CODES,
} from '@evtap/shared';

const en = (values: readonly string[] | Record<string, string>) =>
  z.enum((Array.isArray(values) ? values : Object.values(values)) as [string, ...string[]]);

// ───────────── primitives ─────────────
export const isoDateTime = z.iso.datetime({ offset: true });
export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const id = z.guid();
export const int = z.number().int();
export const nonNegInt = int.min(0);
/** Minor-unit amount (qəpik). */
export const minor = int;
const localized = z.object({ az: z.string(), ru: z.string(), en: z.string() });

export const DealTypeE = en(DEAL_TYPES);
export const PropertyTypeE = en(PROPERTY_TYPES);
export const ListingStatusE = en(LISTING_STATUSES);
export const CurrencyE = en(CURRENCIES);
export const ErrorCodeE = en(ERROR_CODES);

export const Ok = z.object({ ok: z.literal(true) });

export const ApiError = z.object({
  statusCode: int,
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
  code: z.string().optional(),
});

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: nonNegInt, page: int.min(1), pageSize: int.min(1) });

// ───────────── users & auth ─────────────
export const User = z.object({
  id,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: en(USER_ROLES),
  accountType: en(AccountType),
  status: en(USER_STATUSES),
  locale: en(LOCALES),
  isPhoneVerified: z.boolean(),
  isEmailVerified: z.boolean(),
  agencyId: id.nullable(),
  createdAt: isoDateTime,
});

export const AgencySummary = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  type: en(AgencyType),
  verified: z.boolean(),
});

export const PublicUser = z.object({
  id,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  accountType: en(AccountType),
  agency: AgencySummary.nullable(),
  memberSince: isoDateTime,
  activeListings: nonNegInt,
  rating: z.number().nullable(),
  reviewsCount: nonNegInt,
});

export const ListingQuota = z.object({ freeLimit: int, used: nonNegInt, remaining: int, listingFee: minor });

export const Subscription = z.object({
  id,
  planCode: z.enum(['START', 'PRO', 'ENTERPRISE']),
  period: en(BillingPeriod),
  status: en(SubscriptionStatus),
  autoRenew: z.boolean(),
  currentPeriodStart: isoDateTime,
  currentPeriodEnd: isoDateTime,
  usage: z.object({ activeListings: nonNegInt, listingQuota: int, bumpsLeft: nonNegInt, vipCreditsLeft: nonNegInt, premiumCreditsLeft: nonNegInt }),
  cardMask: z.string().nullable(),
});

export const Wallet = z.object({ balance: minor, bonusBalance: minor, currency: CurrencyE });

export const Me = User.extend({
  wallet: Wallet,
  subscription: Subscription.nullable(),
  quota: ListingQuota,
  unreadMessages: nonNegInt,
  unreadNotifications: nonNegInt,
});

export const AuthTokens = z.object({ accessToken: z.string().min(10), refreshToken: z.string().min(10), expiresIn: z.number().positive() });
export const AuthResponse = AuthTokens.extend({ user: User, isNew: z.boolean().optional() });
export const OtpRequestResponse = z.object({ sent: z.literal(true), retryAfter: z.number().positive(), devCode: z.string().optional() });

// ───────────── agencies ─────────────
export const Agency = AgencySummary.extend({
  description: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  cityId: z.string().nullable(),
  ownerId: id,
  activeListings: nonNegInt,
  createdAt: isoDateTime,
});
export const AgencyMember = z.object({
  userId: id,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: en(AgencyMemberRole),
  activeListings: nonNegInt,
  joinedAt: isoDateTime,
});

// ───────────── listings ─────────────
export const ListingImage = z.object({ id, url: z.string().min(1), thumbUrl: z.string().min(1), order: nonNegInt });
export const Upload = z.object({ id, url: z.string().min(1), thumbUrl: z.string().min(1), mime: z.string(), size: z.number().int().positive() });

export const ListingCard = z.object({
  id,
  title: z.string(),
  dealType: DealTypeE,
  propertyType: PropertyTypeE,
  buildingType: en(BuildingType).nullable(),
  price: int,
  currency: CurrencyE,
  pricePeriod: en(PricePeriod),
  country: en(CountryCode),
  cityId: z.string(),
  districtId: z.string().nullable(),
  metroId: z.string().nullable(),
  address: z.string().nullable(),
  area: z.number(),
  landArea: z.number().nullable(),
  rooms: int.nullable(),
  floor: int.nullable(),
  totalFloors: int.nullable(),
  coverUrl: z.string().nullable(),
  imagesCount: nonNegInt,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isVip: z.boolean(),
  isPremium: z.boolean(),
  isHighlighted: z.boolean(),
  isUrgent: z.boolean(),
  isVerified: z.boolean(),
  hasDocument: z.boolean(),
  mortgageAvailable: z.boolean(),
  isBusiness: z.boolean(),
  rating: z.number().nullable(),
  status: ListingStatusE,
  bumpedAt: isoDateTime,
  publishedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const ActivePromotion = z.object({
  id,
  type: en(PROMOTION_TYPES),
  serviceCode: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable(),
  bumpsLeft: int.optional(),
});

export const ListingDetail = ListingCard.extend({
  description: z.string(),
  images: z.array(ListingImage),
  bathrooms: int.nullable(),
  yearBuilt: int.nullable(),
  ceilingHeight: z.number().nullable(),
  repair: en(REPAIR_TYPES).nullable(),
  amenities: z.array(en(AMENITIES)),
  maxGuests: int.nullable(),
  minNights: int.nullable(),
  checkInTime: z.string().nullable(),
  checkOutTime: z.string().nullable(),
  houseRules: z.string().nullable(),
  contactName: z.string(),
  contactPhoneMasked: z.string(),
  owner: PublicUser,
  agency: AgencySummary.nullable(),
  views: nonNegInt,
  favoritesCount: nonNegInt,
  reviewsCount: nonNegInt,
  expiresAt: isoDateTime.nullable(),
  rejectionReason: z.string().nullable(),
  promotions: z.array(ActivePromotion),
  isOwner: z.boolean(),
  isFavorite: z.boolean(),
  updatedAt: isoDateTime,
});

export const MyListing = ListingCard.extend({
  views: nonNegInt,
  phoneViews: nonNegInt,
  favoritesCount: nonNegInt,
  expiresAt: isoDateTime.nullable(),
  rejectionReason: z.string().nullable(),
  promotions: z.array(ActivePromotion),
  requiresPayment: z.boolean(),
});

export const ListingStats = z.object({
  views: nonNegInt,
  phoneViews: nonNegInt,
  favorites: nonNegInt,
  messages: nonNegInt,
  daily: z.array(z.object({ date: ymd, views: nonNegInt, phoneViews: nonNegInt })),
});

export const MapPoint = z.object({
  id,
  lat: z.number(),
  lng: z.number(),
  price: int,
  currency: CurrencyE,
  pricePeriod: en(PricePeriod),
  isVip: z.boolean(),
  isPremium: z.boolean(),
});
/** v2 additions. */
export const MapPointV2 = MapPoint.extend({ title: z.string(), coverUrl: z.string().nullable() });
export const ListingImageV2 = ListingImage.extend({ uploadId: id.nullable() });

export const Availability = z.object({
  listingId: id,
  blockedDates: z.array(ymd),
  bookedRanges: z.array(z.object({ checkIn: ymd, checkOut: ymd })),
});

export const Review = z.object({
  id,
  listingId: id,
  bookingId: id,
  author: z.object({ id, name: z.string(), avatarUrl: z.string().nullable() }),
  rating: int.min(1).max(5),
  comment: z.string(),
  createdAt: isoDateTime,
  hostReply: z.string().nullable(),
});

// ───────────── favorites / saved searches ─────────────
export const SavedSearch = z.object({
  id,
  name: z.string(),
  query: z.record(z.string(), z.unknown()),
  notify: z.boolean(),
  newMatches: nonNegInt,
  createdAt: isoDateTime,
});

// ───────────── messaging ─────────────
export const Message = z.object({
  id,
  conversationId: id,
  senderId: id,
  body: z.string(),
  createdAt: isoDateTime,
  readAt: isoDateTime.nullable(),
});
export const Conversation = z.object({
  id,
  listing: z.object({ id, title: z.string(), coverUrl: z.string().nullable(), price: int, currency: CurrencyE, pricePeriod: en(PricePeriod), status: ListingStatusE }),
  otherUser: z.object({ id, name: z.string(), avatarUrl: z.string().nullable() }),
  lastMessage: Message.nullable(),
  unreadCount: nonNegInt,
  updatedAt: isoDateTime,
});

// ───────────── bookings ─────────────
export const BookingQuote = z.object({
  listingId: id,
  checkIn: ymd,
  checkOut: ymd,
  nights: int.min(1),
  guests: int.min(1),
  nightlyPrice: int,
  currency: CurrencyE,
  subtotal: minor,
  guestFee: minor,
  total: minor,
  available: z.boolean(),
  unavailableReason: z.string().optional(),
});

const BookingParty = z.object({ id, name: z.string(), phone: z.string().nullable(), avatarUrl: z.string().nullable() });
export const Booking = z.object({
  id,
  listing: z.object({ id, title: z.string(), coverUrl: z.string().nullable(), cityId: z.string(), address: z.string().nullable() }),
  guest: BookingParty,
  host: BookingParty,
  checkIn: ymd,
  checkOut: ymd,
  nights: int.min(1),
  guests: int.min(1),
  nightlyPrice: int,
  currency: CurrencyE,
  subtotal: minor,
  guestFee: minor,
  hostFee: minor,
  total: minor,
  hostPayout: minor,
  status: en(BOOKING_STATUSES),
  payoutStatus: en(PayoutStatus),
  refundedAmount: minor,
  paymentId: id.nullable(),
  cancelledBy: z.enum(['GUEST', 'HOST', 'ADMIN']).nullable(),
  cancelReason: z.string().nullable(),
  canReview: z.boolean(),
  createdAt: isoDateTime,
});

// ───────────── money ─────────────
export const ServiceDef = z.object({
  code: z.string(),
  promotionType: en(PROMOTION_TYPES).nullable(),
  durationDays: nonNegInt,
  price: minor,
  active: z.boolean(),
  sortOrder: int,
  name: localized,
  description: localized,
});
export const BundleDef = z.object({ code: z.string(), serviceCodes: z.array(z.string()).min(1), price: minor, name: localized });
export const PlanDef = z.object({
  code: z.enum(['START', 'PRO', 'ENTERPRISE']),
  priceMonthly: minor,
  priceYearly: minor,
  listingQuota: int,
  monthlyBumps: nonNegInt,
  monthlyVipCredits: nonNegInt,
  monthlyPremiumCredits: nonNegInt,
  maxAgents: int.min(1),
  features: z.array(z.string()),
  active: z.boolean(),
  name: localized,
});
const TopupBonus = z.object({ minAmount: minor, bonusPercent: z.number() });
export const PlatformSettings = z.object({
  freeListingsPerMonth: nonNegInt,
  listingFee: minor,
  listingLifetimeDays: int.min(1),
  dailyRentGuestFeePercent: z.number(),
  dailyRentHostFeePercent: z.number(),
  payoutDelayHours: nonNegInt,
  freeCancellationHours: nonNegInt,
  topupBonuses: z.array(TopupBonus),
  minTopup: minor,
  maxTopup: minor,
  moderationEnabled: z.boolean(),
});
export const Catalog = z.object({
  services: z.array(ServiceDef),
  bundles: z.array(BundleDef),
  plans: z.array(PlanDef),
  settings: PlatformSettings.pick({
    freeListingsPerMonth: true, listingFee: true, listingLifetimeDays: true, dailyRentGuestFeePercent: true, dailyRentHostFeePercent: true,
    freeCancellationHours: true, topupBonuses: true, minTopup: true, maxTopup: true,
  }),
});

export const Payment = z.object({
  id,
  userId: id,
  purpose: en(PAYMENT_PURPOSES),
  method: en(PaymentMethod),
  amount: minor,
  currency: CurrencyE,
  status: en(PAYMENT_STATUSES),
  description: z.string(),
  listingId: id.nullable(),
  bookingId: id.nullable(),
  items: z.array(z.object({ code: z.string(), name: z.string(), amount: minor })),
  provider: z.string().nullable(),
  providerOrderId: z.string().nullable(),
  cardMask: z.string().nullable(),
  refundedAmount: minor,
  failureReason: z.string().nullable(),
  createdAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
});

export const CheckoutResponse = z.object({
  paymentId: id,
  status: en(PAYMENT_STATUSES),
  amount: minor,
  currency: CurrencyE,
  paymentUrl: z.string().nullable(),
});

export const WalletTransaction = z.object({
  id,
  type: en(WalletTxType),
  amount: minor,
  balanceAfter: minor,
  description: z.string(),
  paymentId: id.nullable(),
  createdAt: isoDateTime,
});

// ───────────── misc ─────────────
export const AppNotification = z.object({
  id,
  type: en(NotificationType),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()),
  readAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const Banner = z.object({
  id,
  placement: en(BANNER_PLACEMENTS),
  title: z.string(),
  imageUrl: z.string(),
  linkUrl: z.string(),
  active: z.boolean(),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  impressions: nonNegInt,
  clicks: nonNegInt,
  sortOrder: int,
});

export const CmsPage = z.object({ slug: z.string(), title: localized, body: localized, updatedAt: isoDateTime });
/** v2: GET /pages → { slug, title }[] with title localised by ?locale. */
export const CmsPageSummary = z.object({ slug: z.string(), title: z.string() });

export const MortgageBank = z.object({
  code: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  annualRate: z.number(),
  maxTermYears: int,
  minDownPaymentPercent: z.number(),
});
export const MortgageLead = z.object({
  id,
  name: z.string(),
  phone: z.string(),
  listingId: id.nullable(),
  price: int,
  downPayment: int,
  termYears: int,
  bankCode: z.string().nullable(),
  status: en(MortgageLeadStatus),
  createdAt: isoDateTime,
});

export const ListingReport = z.object({
  id,
  listingId: id,
  listingTitle: z.string(),
  reporter: z.object({ id, name: z.string() }).nullable(),
  reason: en(REPORT_REASONS),
  comment: z.string().nullable(),
  status: en(ReportStatus),
  createdAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
});

// ───────────── admin ─────────────
const byPurpose = z.object(Object.fromEntries(PAYMENT_PURPOSES.map((p) => [p, minor])) as Record<string, typeof minor>);
export const AdminOverview = z.object({
  users: z.object({ total: nonNegInt, newToday: nonNegInt, new30d: nonNegInt, business: nonNegInt }),
  listings: z.object({ active: nonNegInt, pending: nonNegInt, total: nonNegInt, newToday: nonNegInt }),
  revenue: z.object({ today: minor, last30d: minor, total: minor, byPurpose30d: byPurpose }),
  payments: z.object({ succeeded30d: nonNegInt, failed30d: nonNegInt }),
  bookings: z.object({ confirmed: nonNegInt, upcoming: nonNegInt, gmv30d: minor }),
  subscriptions: z.object({ active: nonNegInt, mrr: z.number() }),
  reports: z.object({ open: nonNegInt }),
});
export const TimeseriesPoint = z.object({ date: ymd, value: z.number() }).catchall(z.union([z.number(), z.string()]));

export const AdminUser = User.extend({ walletBalance: minor, activeListings: nonNegInt, totalSpent: minor, lastLoginAt: isoDateTime.nullable() });
export const AdminListing = ListingCard.extend({
  ownerId: id,
  ownerName: z.string(),
  ownerPhone: z.string().nullable(),
  views: nonNegInt,
  rejectionReason: z.string().nullable(),
  reportsCount: nonNegInt,
  updatedAt: isoDateTime,
});
export const AdminListingDetail = ListingDetail.extend({ reports: z.array(ListingReport), ownerPhone: z.string().nullable() });
export const AdminUserDetail = AdminUser.extend({ listings: z.array(AdminListing), payments: z.array(Payment), walletTransactions: z.array(WalletTransaction) });
export const AdminPayment = Payment.extend({ userName: z.string() });
export const AdminPaymentDetail = Payment.extend({ user: z.object({ id, name: z.string() }), providerData: z.unknown() });
export const AdminSubscription = Subscription.extend({ user: z.object({ id, name: z.string() }), agency: z.object({ id, name: z.string() }).nullable() });
export const AuditLog = z.object({
  id,
  actor: z.object({ id, name: z.string() }).nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: isoDateTime,
});
export const AgencyStats = z.object({ views: nonNegInt, phoneViews: nonNegInt, messages: nonNegInt, listings: nonNegInt, daily: z.array(TimeseriesPoint) });

// ───────────── reference data ─────────────
export const Locations = z.object({
  countries: z.array(z.object({ code: en(CountryCode), name: localized, currency: z.string(), phonePrefix: z.string() })),
  cities: z.array(z.object({ id: z.string(), country: en(CountryCode), name: localized, lat: z.number(), lng: z.number(), popular: z.boolean().optional() })),
  districts: z.array(z.object({ id: z.string(), cityId: z.string(), name: localized })),
  metroStations: z.array(z.object({ id: z.string(), cityId: z.string(), line: z.string(), name: localized, lat: z.number(), lng: z.number() })),
});
