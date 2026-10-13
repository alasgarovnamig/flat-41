/**
 * Database schema (PostgreSQL, Drizzle ORM).
 * Money: listings.price = MAJOR units (whole AZN); every other money column = MINOR units (qəpik, integer).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, varchar, integer, bigint, boolean, timestamp, jsonb, doublePrecision, date, real,
  primaryKey, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ───────────────────────────── Users & auth ─────────────────────────────
export const users = pgTable('users', {
  id: id(),
  name: varchar('name', { length: 80 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 160 }),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  role: varchar('role', { length: 16 }).notNull().default('USER'), // UserRole
  accountType: varchar('account_type', { length: 16 }).notNull().default('INDIVIDUAL'), // AccountType
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'), // UserStatus
  locale: varchar('locale', { length: 2 }).notNull().default('az'),
  isPhoneVerified: boolean('is_phone_verified').notNull().default(false),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  agencyId: uuid('agency_id'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('users_phone_uq').on(t.phone),
  uniqueIndex('users_email_uq').on(t.email),
  index('users_created_idx').on(t.createdAt),
]);

export const refreshSessions = pgTable('refresh_sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 128 }).notNull(),
  userAgent: text('user_agent'),
  ip: varchar('ip', { length: 64 }),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('refresh_token_hash_uq').on(t.tokenHash), index('refresh_user_idx').on(t.userId)]);

export const otpCodes = pgTable('otp_codes', {
  id: id(),
  phone: varchar('phone', { length: 20 }).notNull(),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: createdAt(),
}, (t) => [index('otp_phone_idx').on(t.phone, t.createdAt)]);

export const pushTokens = pgTable('push_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 10 }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('push_user_idx').on(t.userId)]);

// ───────────────────────────── Agencies ─────────────────────────────
export const agencies = pgTable('agencies', {
  id: id(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 140 }).notNull(),
  type: varchar('type', { length: 16 }).notNull().default('AGENCY'),
  description: text('description'),
  logoUrl: text('logo_url'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 160 }),
  website: text('website'),
  address: varchar('address', { length: 200 }),
  cityId: varchar('city_id', { length: 40 }),
  verified: boolean('verified').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('agencies_slug_uq').on(t.slug)]);

export const agencyMembers = pgTable('agency_members', {
  agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('AGENT'),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.agencyId, t.userId] })]);

// ───────────────────────────── Uploads & listings ─────────────────────────────
export const uploads = pgTable('uploads', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), // storage key of the full image
  thumbKey: text('thumb_key').notNull(),
  url: text('url').notNull(),
  thumbUrl: text('thumb_url').notNull(),
  mime: varchar('mime', { length: 40 }).notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: createdAt(),
});

export const listings = pgTable('listings', {
  id: id(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  agencyId: uuid('agency_id').references(() => agencies.id),
  dealType: varchar('deal_type', { length: 16 }).notNull(),
  propertyType: varchar('property_type', { length: 16 }).notNull(),
  buildingType: varchar('building_type', { length: 16 }),
  title: varchar('title', { length: 120 }).notNull(),
  description: text('description').notNull(),
  price: bigint('price', { mode: 'number' }).notNull(), // MAJOR units
  currency: varchar('currency', { length: 3 }).notNull().default('AZN'),
  pricePeriod: varchar('price_period', { length: 8 }).notNull().default('TOTAL'), // derived from dealType
  country: varchar('country', { length: 2 }).notNull().default('AZ'),
  cityId: varchar('city_id', { length: 40 }).notNull(),
  districtId: varchar('district_id', { length: 60 }),
  metroId: varchar('metro_id', { length: 60 }),
  address: varchar('address', { length: 200 }),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  area: real('area').notNull(),
  landArea: real('land_area'),
  rooms: integer('rooms'),
  bathrooms: integer('bathrooms'),
  floor: integer('floor'),
  totalFloors: integer('total_floors'),
  yearBuilt: integer('year_built'),
  ceilingHeight: real('ceiling_height'),
  repair: varchar('repair', { length: 16 }),
  hasDocument: boolean('has_document').notNull().default(false),
  mortgageAvailable: boolean('mortgage_available').notNull().default(false),
  amenities: text('amenities').array().notNull().default(sql`'{}'::text[]`),
  maxGuests: integer('max_guests'),
  minNights: integer('min_nights'),
  checkInTime: varchar('check_in_time', { length: 5 }),
  checkOutTime: varchar('check_out_time', { length: 5 }),
  houseRules: text('house_rules'),
  contactName: varchar('contact_name', { length: 80 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 20 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'), // ListingStatus
  rejectionReason: text('rejection_reason'),
  isVerified: boolean('is_verified').notNull().default(false),
  isFreeQuota: boolean('is_free_quota').notNull().default(true), // counted against the free monthly quota
  views: integer('views').notNull().default(0),
  phoneViews: integer('phone_views').notNull().default(0),
  favoritesCount: integer('favorites_count').notNull().default(0),
  ratingAvg: real('rating_avg'),
  reviewsCount: integer('reviews_count').notNull().default(0),
  // promotion state (denormalised for fast search ordering)
  bumpedAt: ts('bumped_at').notNull().defaultNow(),
  vipUntil: ts('vip_until'),
  premiumUntil: ts('premium_until'),
  highlightUntil: ts('highlight_until'),
  urgentUntil: ts('urgent_until'),
  autoBumpUntil: ts('auto_bump_until'),
  publishedAt: ts('published_at'),
  expiresAt: ts('expires_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('listings_search_idx').on(t.status, t.dealType, t.cityId, t.bumpedAt),
  index('listings_owner_idx').on(t.ownerId, t.status),
  index('listings_price_idx').on(t.price),
  index('listings_geo_idx').on(t.lat, t.lng),
  index('listings_vip_idx').on(t.vipUntil),
  index('listings_premium_idx').on(t.premiumUntil),
]);

export const listingImages = pgTable('listing_images', {
  id: id(),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  uploadId: uuid('upload_id').references(() => uploads.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  thumbUrl: text('thumb_url').notNull(),
  order: integer('order').notNull().default(0),
}, (t) => [index('listing_images_listing_idx').on(t.listingId, t.order)]);

export const listingDailyStats = pgTable('listing_daily_stats', {
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  views: integer('views').notNull().default(0),
  phoneViews: integer('phone_views').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.listingId, t.date] })]);

export const listingBlockedDates = pgTable('listing_blocked_dates', {
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
}, (t) => [primaryKey({ columns: [t.listingId, t.date] })]);

export const listingReports = pgTable('listing_reports', {
  id: id(),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  reason: varchar('reason', { length: 20 }).notNull(),
  comment: text('comment'),
  status: varchar('status', { length: 12 }).notNull().default('OPEN'),
  resolvedById: uuid('resolved_by_id').references(() => users.id),
  resolvedAt: ts('resolved_at'),
  createdAt: createdAt(),
}, (t) => [index('reports_status_idx').on(t.status, t.createdAt)]);

export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.listingId] })]);

export const savedSearches = pgTable('saved_searches', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  query: jsonb('query').$type<Record<string, unknown>>().notNull(),
  notify: boolean('notify').notNull().default(true),
  lastCheckedAt: ts('last_checked_at').notNull().defaultNow(),
  newMatches: integer('new_matches').notNull().default(0),
  createdAt: createdAt(),
});

/** History of every promotion applied to a listing (the listing row holds the current *Until columns). */
export const listingPromotions = pgTable('listing_promotions', {
  id: id(),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 16 }).notNull(), // PromotionType
  serviceCode: varchar('service_code', { length: 40 }).notNull(),
  startsAt: ts('starts_at').notNull().defaultNow(),
  endsAt: ts('ends_at'),
  paymentId: uuid('payment_id'),
  source: varchar('source', { length: 16 }).notNull().default('PAYMENT'), // PAYMENT | CREDIT | ADMIN
  createdAt: createdAt(),
}, (t) => [index('promotions_listing_idx').on(t.listingId), index('promotions_ends_idx').on(t.endsAt)]);

// ───────────────────────────── Messaging ─────────────────────────────
export const conversations = pgTable('conversations', {
  id: id(),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  buyerId: uuid('buyer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastMessageAt: ts('last_message_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('conversations_listing_buyer_uq').on(t.listingId, t.buyerId), index('conv_seller_idx').on(t.sellerId), index('conv_buyer_idx').on(t.buyerId)]);

export const messages = pgTable('messages', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt)]);

// ───────────────────────────── Bookings & reviews ─────────────────────────────
export const bookings = pgTable('bookings', {
  id: id(),
  listingId: uuid('listing_id').notNull().references(() => listings.id),
  guestId: uuid('guest_id').notNull().references(() => users.id),
  hostId: uuid('host_id').notNull().references(() => users.id),
  checkIn: date('check_in').notNull(),
  checkOut: date('check_out').notNull(),
  nights: integer('nights').notNull(),
  guests: integer('guests').notNull(),
  nightlyPrice: integer('nightly_price').notNull(), // MAJOR
  currency: varchar('currency', { length: 3 }).notNull(),
  subtotal: integer('subtotal').notNull(),
  guestFee: integer('guest_fee').notNull(),
  hostFee: integer('host_fee').notNull(),
  total: integer('total').notNull(),
  hostPayout: integer('host_payout').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING_PAYMENT'),
  payoutStatus: varchar('payout_status', { length: 12 }).notNull().default('NOT_DUE'),
  refundedAmount: integer('refunded_amount').notNull().default(0),
  paymentId: uuid('payment_id'),
  holdExpiresAt: ts('hold_expires_at'),
  cancelledBy: varchar('cancelled_by', { length: 8 }),
  cancelReason: text('cancel_reason'),
  cancelledAt: ts('cancelled_at'),
  paidOutAt: ts('paid_out_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('bookings_listing_idx').on(t.listingId, t.checkIn), index('bookings_guest_idx').on(t.guestId), index('bookings_host_idx').on(t.hostId)]);

export const reviews = pgTable('reviews', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  rating: integer('rating').notNull(),
  comment: text('comment').notNull(),
  hostReply: text('host_reply'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('reviews_booking_uq').on(t.bookingId), index('reviews_listing_idx').on(t.listingId)]);

// ───────────────────────────── Money ─────────────────────────────
export const wallets = pgTable('wallets', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0), // real money, minor
  bonusBalance: integer('bonus_balance').notNull().default(0), // promo money, spent first, non-refundable
  currency: varchar('currency', { length: 3 }).notNull().default('AZN'),
  updatedAt: updatedAt(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 16 }).notNull(), // WalletTxType
  amount: integer('amount').notNull(), // signed: + credit, - debit
  bonusAmount: integer('bonus_amount').notNull().default(0), // part of `amount` taken from / added to bonusBalance
  balanceAfter: integer('balance_after').notNull(), // balance + bonusBalance after tx
  description: text('description').notNull(),
  paymentId: uuid('payment_id'),
  bookingId: uuid('booking_id'),
  actorId: uuid('actor_id'), // admin for ADJUSTMENT
  createdAt: createdAt(),
}, (t) => [index('wallet_tx_user_idx').on(t.userId, t.createdAt)]);

export const payments = pgTable('payments', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  purpose: varchar('purpose', { length: 20 }).notNull(), // PaymentPurpose
  method: varchar('method', { length: 10 }).notNull(), // PaymentMethod
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('AZN'),
  status: varchar('status', { length: 20 }).notNull().default('CREATED'),
  description: text('description').notNull(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  bookingId: uuid('booking_id'),
  items: jsonb('items').$type<{ code: string; name: string; amount: number }[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), // e.g. { planCode, period, autoRenew, serviceCodes }
  provider: varchar('provider', { length: 20 }),
  providerOrderId: varchar('provider_order_id', { length: 80 }),
  providerData: jsonb('provider_data').$type<Record<string, unknown>>(),
  cardMask: varchar('card_mask', { length: 24 }),
  cardToken: text('card_token'),
  returnUrl: text('return_url'),
  refundedAmount: integer('refunded_amount').notNull().default(0),
  failureReason: text('failure_reason'),
  fulfilledAt: ts('fulfilled_at'), // idempotency guard: services granted
  paidAt: ts('paid_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('payments_user_idx').on(t.userId, t.createdAt),
  index('payments_status_idx').on(t.status, t.createdAt),
  uniqueIndex('payments_provider_order_uq').on(t.provider, t.providerOrderId),
]);

export const services = pgTable('services', {
  code: varchar('code', { length: 40 }).primaryKey(),
  promotionType: varchar('promotion_type', { length: 16 }),
  durationDays: integer('duration_days').notNull().default(0),
  price: integer('price').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  name: jsonb('name').$type<{ az: string; ru: string; en: string }>().notNull(),
  description: jsonb('description').$type<{ az: string; ru: string; en: string }>().notNull(),
  updatedAt: updatedAt(),
});

export const plans = pgTable('plans', {
  code: varchar('code', { length: 20 }).primaryKey(),
  priceMonthly: integer('price_monthly').notNull(),
  priceYearly: integer('price_yearly').notNull(),
  listingQuota: integer('listing_quota').notNull(),
  monthlyBumps: integer('monthly_bumps').notNull(),
  monthlyVipCredits: integer('monthly_vip_credits').notNull(),
  monthlyPremiumCredits: integer('monthly_premium_credits').notNull(),
  maxAgents: integer('max_agents').notNull(),
  features: text('features').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  name: jsonb('name').$type<{ az: string; ru: string; en: string }>().notNull(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  agencyId: uuid('agency_id').references(() => agencies.id),
  planCode: varchar('plan_code', { length: 20 }).notNull().references(() => plans.code),
  period: varchar('period', { length: 8 }).notNull(), // BillingPeriod
  status: varchar('status', { length: 12 }).notNull().default('ACTIVE'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  currentPeriodStart: ts('current_period_start').notNull(),
  currentPeriodEnd: ts('current_period_end').notNull(),
  bumpsLeft: integer('bumps_left').notNull().default(0),
  vipCreditsLeft: integer('vip_credits_left').notNull().default(0),
  premiumCreditsLeft: integer('premium_credits_left').notNull().default(0),
  cardToken: text('card_token'), // mockbank recurring token
  cardMask: varchar('card_mask', { length: 24 }),
  renewalAttempts: integer('renewal_attempts').notNull().default(0),
  lastPaymentId: uuid('last_payment_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('subscriptions_user_idx').on(t.userId, t.status), index('subscriptions_end_idx').on(t.currentPeriodEnd)]);

/** Key/value platform settings (PlatformSettings in @evtap/shared, single row key='platform'). */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 60 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Notifications & content ─────────────────────────────
export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)]);

export const banners = pgTable('banners', {
  id: id(),
  placement: varchar('placement', { length: 24 }).notNull(),
  title: varchar('title', { length: 120 }).notNull(),
  imageUrl: text('image_url').notNull(),
  linkUrl: text('link_url').notNull(),
  active: boolean('active').notNull().default(true),
  startsAt: ts('starts_at'),
  endsAt: ts('ends_at'),
  impressions: integer('impressions').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const cmsPages = pgTable('cms_pages', {
  slug: varchar('slug', { length: 60 }).primaryKey(),
  title: jsonb('title').$type<{ az: string; ru: string; en: string }>().notNull(),
  body: jsonb('body').$type<{ az: string; ru: string; en: string }>().notNull(),
  updatedAt: updatedAt(),
});

export const mortgageLeads = pgTable('mortgage_leads', {
  id: id(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 80 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  price: integer('price').notNull(),
  downPayment: integer('down_payment').notNull(),
  termYears: integer('term_years').notNull(),
  bankCode: varchar('bank_code', { length: 20 }),
  status: varchar('status', { length: 16 }).notNull().default('NEW'),
  createdAt: createdAt(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 60 }).notNull(), // e.g. listing.approve
  entity: varchar('entity', { length: 40 }).notNull(),
  entityId: varchar('entity_id', { length: 60 }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  ip: varchar('ip', { length: 64 }),
  createdAt: createdAt(),
}, (t) => [index('audit_created_idx').on(t.createdAt), index('audit_entity_idx').on(t.entity, t.entityId)]);
