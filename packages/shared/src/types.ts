/**
 * DTOs returned by the API. Dates are ISO-8601 strings. IDs are UUID strings.
 * Money: `price` on listings is in MAJOR units (whole AZN/USD...). Every other amount
 * (payments, wallet, fees, bookings) is in MINOR units (qəpik) — fields are named `amount`, `total`, `fee`, `balance`.
 */
import type {
  AccountType, AgencyMemberRole, AgencyType, Amenity, BannerPlacement, BillingPeriod, BookingStatus, BuildingType,
  CountryCode, Currency, DealType, ListingStatus, Locale, MortgageLeadStatus, NotificationType, PaymentMethod,
  PaymentPurpose, PaymentStatus, PayoutStatus, PricePeriod, PromotionType, PropertyType, RepairType, ReportReason,
  ReportStatus, SubscriptionStatus, UserRole, UserStatus, WalletTxType,
} from './enums';
import type { PlanDef, PlatformSettings, ServiceDef, BundleDef } from './pricing';

export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number }

export interface ApiError { statusCode: number; message: string | string[]; error?: string; code?: string }

// ───────────────────────────── Users & auth ─────────────────────────────
export interface User {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  accountType: AccountType;
  status: UserStatus;
  locale: Locale;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  agencyId: string | null;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  accountType: AccountType;
  agency: AgencySummary | null;
  memberSince: string;
  activeListings: number;
  rating: number | null; // avg review rating as a daily-rent host
  reviewsCount: number;
}

export interface Me extends User {
  wallet: { balance: number; bonusBalance: number; currency: Currency };
  subscription: Subscription | null;
  quota: ListingQuota;
  unreadMessages: number;
  unreadNotifications: number;
}

export interface ListingQuota {
  freeLimit: number; // free listings per 30 days (individual) or plan quota (business, -1 unlimited)
  used: number;
  remaining: number; // -1 = unlimited
  listingFee: number; // minor units, charged when remaining === 0
}

export interface AuthTokens { accessToken: string; refreshToken: string; expiresIn: number }
export interface AuthResponse extends AuthTokens { user: User; isNew?: boolean }

// ───────────────────────────── Agencies ─────────────────────────────
export interface AgencySummary { id: string; name: string; slug: string; logoUrl: string | null; type: AgencyType; verified: boolean }
export interface Agency extends AgencySummary {
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  cityId: string | null;
  ownerId: string;
  activeListings: number;
  createdAt: string;
}
export interface AgencyMember { userId: string; name: string; phone: string | null; email: string | null; avatarUrl: string | null; role: AgencyMemberRole; activeListings: number; joinedAt: string }

// ───────────────────────────── Listings ─────────────────────────────
export interface ListingImage { id: string; uploadId: string | null; url: string; thumbUrl: string; order: number } // send uploadId back in imageIds when editing
export interface Upload { id: string; url: string; thumbUrl: string; mime: string; size: number }

/** Compact representation for result lists, cards, carousels. */
export interface ListingCard {
  id: string;
  title: string;
  dealType: DealType;
  propertyType: PropertyType;
  buildingType: BuildingType | null;
  price: number; // major units
  currency: Currency;
  pricePeriod: PricePeriod;
  country: CountryCode;
  cityId: string;
  districtId: string | null;
  metroId: string | null;
  address: string | null;
  area: number; // m²
  landArea: number | null; // sot (100 m²)
  rooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  coverUrl: string | null;
  imagesCount: number;
  lat: number | null;
  lng: number | null;
  isVip: boolean;
  isPremium: boolean;
  isHighlighted: boolean;
  isUrgent: boolean;
  isVerified: boolean;
  hasDocument: boolean;
  mortgageAvailable: boolean;
  isBusiness: boolean; // posted by agency / developer
  rating: number | null; // daily rent only
  status: ListingStatus;
  bumpedAt: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface ListingDetail extends ListingCard {
  description: string;
  images: ListingImage[];
  bathrooms: number | null;
  yearBuilt: number | null;
  ceilingHeight: number | null;
  repair: RepairType | null;
  amenities: Amenity[];
  // daily rent specifics
  maxGuests: number | null;
  minNights: number | null;
  checkInTime: string | null; // "14:00"
  checkOutTime: string | null; // "12:00"
  houseRules: string | null;
  // contact (phone is masked: "+994 50 123 ** **"; reveal via POST /listings/:id/phone)
  contactName: string;
  contactPhoneMasked: string;
  contactPhone: string | null; // full number — only for the owner / admins (others: null, use POST /listings/:id/phone)
  owner: PublicUser;
  agency: AgencySummary | null;
  views: number;
  favoritesCount: number;
  reviewsCount: number;
  expiresAt: string | null;
  rejectionReason: string | null; // visible to owner only
  promotions: ActivePromotion[]; // visible to owner only (empty for others)
  isOwner: boolean;
  isFavorite: boolean;
  updatedAt: string;
}

/** Owner view in "My listings". */
export interface MyListing extends ListingCard {
  views: number;
  phoneViews: number;
  favoritesCount: number;
  expiresAt: string | null;
  rejectionReason: string | null;
  promotions: ActivePromotion[];
  requiresPayment: boolean; // DRAFT waiting for listing fee
}

export interface ActivePromotion { id: string; type: PromotionType; serviceCode: string; startsAt: string; endsAt: string | null; bumpsLeft?: number }

export interface ListingStats { views: number; phoneViews: number; favorites: number; messages: number; daily: { date: string; views: number; phoneViews: number }[] }

export interface MapPoint { id: string; lat: number; lng: number; price: number; currency: Currency; pricePeriod: PricePeriod; isVip: boolean; isPremium: boolean; title: string; coverUrl: string | null }

export interface Availability { listingId: string; blockedDates: string[]; bookedRanges: { checkIn: string; checkOut: string }[] }

export interface Review { id: string; listingId: string; bookingId: string; author: { id: string; name: string; avatarUrl: string | null }; rating: number; comment: string; createdAt: string; hostReply: string | null }

// ───────────────────────────── Favorites / saved searches ─────────────────────────────
export interface SavedSearch { id: string; name: string; query: Record<string, unknown>; notify: boolean; newMatches: number; createdAt: string }

// ───────────────────────────── Messaging ─────────────────────────────
export interface Conversation {
  id: string;
  listing: Pick<ListingCard, 'id' | 'title' | 'coverUrl' | 'price' | 'currency' | 'pricePeriod' | 'status'>;
  otherUser: { id: string; name: string; avatarUrl: string | null };
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: string;
}
export interface Message { id: string; conversationId: string; senderId: string; body: string; createdAt: string; readAt: string | null }

// ───────────────────────────── Bookings ─────────────────────────────
export interface BookingQuote {
  listingId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightlyPrice: number; // major units
  currency: Currency;
  subtotal: number; // minor
  guestFee: number; // minor
  total: number; // minor — what the guest pays
  available: boolean;
  unavailableReason?: string;
}

export interface Booking {
  id: string;
  listing: Pick<ListingCard, 'id' | 'title' | 'coverUrl' | 'cityId' | 'address'>;
  guest: { id: string; name: string; phone: string | null; avatarUrl: string | null };
  host: { id: string; name: string; phone: string | null; avatarUrl: string | null };
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightlyPrice: number; // major
  currency: Currency;
  subtotal: number;
  guestFee: number;
  hostFee: number;
  total: number;
  hostPayout: number;
  status: BookingStatus;
  payoutStatus: PayoutStatus;
  refundedAmount: number;
  paymentId: string | null;
  cancelledBy: 'GUEST' | 'HOST' | 'ADMIN' | null;
  cancelReason: string | null;
  canReview: boolean;
  createdAt: string;
}

// ───────────────────────────── Money ─────────────────────────────
export interface Catalog {
  services: ServiceDef[];
  bundles: BundleDef[];
  plans: PlanDef[];
  settings: Pick<PlatformSettings, 'freeListingsPerMonth' | 'listingFee' | 'listingLifetimeDays' | 'dailyRentGuestFeePercent' | 'dailyRentHostFeePercent' | 'freeCancellationHours' | 'topupBonuses' | 'minTopup' | 'maxTopup'>;
}

export interface Payment {
  id: string;
  userId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: number; // minor
  currency: Currency;
  status: PaymentStatus;
  description: string;
  listingId: string | null;
  bookingId: string | null;
  items: { code: string; name: string; amount: number }[];
  provider: string | null; // "mockbank"
  providerOrderId: string | null;
  cardMask: string | null;
  refundedAmount: number;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface CheckoutResponse {
  paymentId: string;
  status: PaymentStatus; // SUCCEEDED immediately for WALLET, PENDING for CARD
  amount: number;
  currency: Currency;
  paymentUrl: string | null; // CARD: open this URL (browser / WebView); bank redirects back to returnUrl
}

export interface Wallet { balance: number; bonusBalance: number; currency: Currency }
export interface WalletTransaction { id: string; type: WalletTxType; amount: number; balanceAfter: number; description: string; paymentId: string | null; createdAt: string }

export interface Subscription {
  id: string;
  planCode: PlanDef['code'];
  period: BillingPeriod;
  status: SubscriptionStatus;
  autoRenew: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  usage: { activeListings: number; listingQuota: number; bumpsLeft: number; vipCreditsLeft: number; premiumCreditsLeft: number };
  cardMask: string | null;
}

// ───────────────────────────── Misc ─────────────────────────────
export interface AppNotification { id: string; type: NotificationType; title: string; body: string; data: Record<string, unknown>; readAt: string | null; createdAt: string }

export interface Banner { id: string; placement: BannerPlacement; title: string; imageUrl: string; linkUrl: string; active: boolean; startsAt: string | null; endsAt: string | null; impressions: number; clicks: number; sortOrder: number }

export interface CmsPage { slug: string; title: Record<Locale, string>; body: Record<Locale, string>; updatedAt: string }

export interface MortgageBank { code: string; name: string; logoUrl: string | null; annualRate: number; maxTermYears: number; minDownPaymentPercent: number }
export interface MortgageLead { id: string; name: string; phone: string; listingId: string | null; price: number; downPayment: number; termYears: number; bankCode: string | null; status: MortgageLeadStatus; createdAt: string }

export interface ListingReport { id: string; listingId: string; listingTitle: string; reporter: { id: string; name: string } | null; reason: ReportReason; comment: string | null; status: ReportStatus; createdAt: string; resolvedAt: string | null }

// ───────────────────────────── Admin ─────────────────────────────
export interface AdminOverview {
  users: { total: number; newToday: number; new30d: number; business: number };
  listings: { active: number; pending: number; total: number; newToday: number };
  revenue: { today: number; last30d: number; total: number; byPurpose30d: Record<PaymentPurpose, number> };
  payments: { succeeded30d: number; failed30d: number };
  bookings: { confirmed: number; upcoming: number; gmv30d: number };
  subscriptions: { active: number; mrr: number };
  reports: { open: number };
}
export interface TimeseriesPoint { date: string; value: number; [k: string]: number | string }

export interface AdminUser extends User { walletBalance: number; activeListings: number; totalSpent: number; lastLoginAt: string | null }
export interface AdminListing extends ListingCard { ownerId: string; ownerName: string; ownerPhone: string | null; views: number; rejectionReason: string | null; reportsCount: number; updatedAt: string }
export interface AuditLog { id: string; actor: { id: string; name: string } | null; action: string; entity: string; entityId: string | null; data: Record<string, unknown>; ip: string | null; createdAt: string }
