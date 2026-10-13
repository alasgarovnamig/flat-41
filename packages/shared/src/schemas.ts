/**
 * Request validation schemas (zod). Used by the API for validation and by the clients
 * for form validation, so both sides agree on the rules. Input types = z.infer<...>.
 */
import { z } from 'zod';
import {
  AMENITIES, BANNER_PLACEMENTS, BOOKING_STATUSES, CURRENCIES, DEAL_TYPES, LISTING_STATUSES, LOCALES, PAYMENT_PURPOSES,
  PAYMENT_STATUSES, PROPERTY_TYPES, REPAIR_TYPES, REPORT_REASONS, USER_ROLES, USER_STATUSES,
} from './enums';

/** Azerbaijani (+994XXXXXXXXX) or Georgian (+995XXXXXXXXX) mobile number in E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => (v.startsWith('0') && v.length === 10 ? '+994' + v.slice(1) : v))
  .refine((v) => /^\+99[45]\d{9}$/.test(v), { message: 'Invalid phone number' });

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const intQ = z.coerce.number().int();
const numQ = z.coerce.number();
const boolQ = z.preprocess((v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : undefined), z.boolean().optional());
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item).optional());

export const paginationSchema = z.object({
  page: intQ.min(1).default(1),
  pageSize: intQ.min(1).max(100).default(20),
});

// ───────────── Auth ─────────────
export const otpRequestSchema = z.object({ phone: phoneSchema });
export const otpVerifySchema = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{4,6}$/), name: z.string().min(2).max(80).optional() });
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  phone: phoneSchema.optional(),
});
export const loginSchema = z.object({ login: z.string().trim().min(3), password: z.string().min(1) });
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });
export const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  locale: z.enum(LOCALES as [string, ...string[]]).optional(),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().optional(), newPassword: z.string().min(8).max(100) });
export const pushTokenSchema = z.object({ token: z.string().min(10), platform: z.enum(['ios', 'android', 'web']) });

// ───────────── Listings ─────────────
const listingBase = z.object({
  dealType: z.enum(DEAL_TYPES as [string, ...string[]]),
  propertyType: z.enum(PROPERTY_TYPES as [string, ...string[]]),
  buildingType: z.enum(['NEW', 'SECONDARY']).nullable().optional(),
  title: z.string().trim().min(10).max(120),
  description: z.string().trim().min(30).max(5000),
  price: z.number().int().positive().max(1_000_000_000),
  currency: z.enum(CURRENCIES as [string, ...string[]]),
  cityId: z.string().min(2),
  districtId: z.string().nullable().optional(),
  metroId: z.string().nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  area: z.number().positive().max(100000),
  landArea: z.number().positive().max(100000).nullable().optional(),
  rooms: z.number().int().min(0).max(50).nullable().optional(),
  bathrooms: z.number().int().min(0).max(20).nullable().optional(),
  floor: z.number().int().min(-5).max(200).nullable().optional(),
  totalFloors: z.number().int().min(1).max(200).nullable().optional(),
  yearBuilt: z.number().int().min(1800).max(2100).nullable().optional(),
  ceilingHeight: z.number().min(2).max(10).nullable().optional(),
  repair: z.enum(REPAIR_TYPES as [string, ...string[]]).nullable().optional(),
  hasDocument: z.boolean(), // çıxarış / kupça
  mortgageAvailable: z.boolean(),
  amenities: z.array(z.enum(AMENITIES as [string, ...string[]])),
  maxGuests: z.number().int().min(1).max(50).nullable().optional(),
  minNights: z.number().int().min(1).max(365).nullable().optional(),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  houseRules: z.string().max(2000).nullable().optional(),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: phoneSchema,
  imageIds: z.array(z.string().uuid()).min(1).max(30), // ordered, from POST /uploads; first = cover
});

const listingRefine = <T extends z.ZodTypeAny>(s: T) =>
  s.superRefine((v: any, ctx) => {
    if (v.dealType === 'RENT_DAILY' && !v.maxGuests) ctx.addIssue({ code: 'custom', path: ['maxGuests'], message: 'Required for daily rent' });
    if (v.floor != null && v.totalFloors != null && v.floor > v.totalFloors) ctx.addIssue({ code: 'custom', path: ['floor'], message: 'Floor cannot exceed total floors' });
    if (['APARTMENT', 'HOUSE', 'ROOM'].includes(v.propertyType) && v.rooms == null) ctx.addIssue({ code: 'custom', path: ['rooms'], message: 'Rooms required' });
  });

/** Defaults only on create — PATCH must not reset fields the client did not send. */
export const createListingSchema = listingRefine(
  listingBase.extend({
    currency: listingBase.shape.currency.default('AZN'),
    hasDocument: listingBase.shape.hasDocument.default(false),
    mortgageAvailable: listingBase.shape.mortgageAvailable.default(false),
    amenities: listingBase.shape.amenities.default([]),
  }),
);
export const updateListingSchema = listingBase.partial();
export const listingStatusActionSchema = z.object({ action: z.enum(['MARK_SOLD', 'ARCHIVE', 'RENEW', 'RESTORE']) });

export const listingSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  dealType: z.enum(DEAL_TYPES as [string, ...string[]]).optional(),
  propertyType: csv(z.enum(PROPERTY_TYPES as [string, ...string[]])),
  buildingType: z.enum(['NEW', 'SECONDARY']).optional(),
  country: z.enum(['AZ', 'GE']).optional(),
  cityId: z.string().optional(),
  districtId: csv(z.string()),
  metroId: csv(z.string()),
  priceMin: intQ.min(0).optional(),
  priceMax: intQ.min(0).optional(),
  currency: z.enum(CURRENCIES as [string, ...string[]]).optional(),
  areaMin: numQ.min(0).optional(),
  areaMax: numQ.min(0).optional(),
  rooms: csv(intQ), // [1,2,3] ; 5 means 5+
  floorMin: intQ.optional(),
  floorMax: intQ.optional(),
  notFirstFloor: boolQ,
  notLastFloor: boolQ,
  repair: csv(z.enum(REPAIR_TYPES as [string, ...string[]])),
  hasDocument: boolQ,
  mortgageAvailable: boolQ,
  amenities: csv(z.enum(AMENITIES as [string, ...string[]])),
  ownerType: z.enum(['OWNER', 'BUSINESS']).optional(),
  hasPhotos: boolQ,
  verified: boolQ,
  agencyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  // daily rent availability filter
  checkIn: isoDate.optional(),
  checkOut: isoDate.optional(),
  guests: intQ.min(1).optional(),
  // map bounding box: "minLng,minLat,maxLng,maxLat"
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional(),
  sort: z.enum(['date_desc', 'price_asc', 'price_desc', 'area_asc', 'area_desc']).default('date_desc'),
  page: intQ.min(1).default(1),
  pageSize: intQ.min(1).max(60).default(24),
});

export const reportListingSchema = z.object({ reason: z.enum(REPORT_REASONS as [string, ...string[]]), comment: z.string().max(1000).optional() });
export const availabilityUpdateSchema = z.object({ blockedDates: z.array(isoDate).max(366) });
export const savedSearchSchema = z.object({ name: z.string().trim().min(1).max(80), query: z.record(z.string(), z.unknown()), notify: z.boolean().default(true) });

// ───────────── Messaging ─────────────
export const startConversationSchema = z.object({ listingId: z.string().uuid(), message: z.string().trim().min(1).max(2000) });
export const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });
/** GET /conversations/:id/messages — cursor = id of the oldest message the client already has. */
export const messageListQuerySchema = z.object({ before: z.string().uuid().optional(), limit: intQ.min(1).max(100).default(50) });

// ───────────── Bookings ─────────────
const bookingDates = z
  .object({ listingId: z.string().uuid(), checkIn: isoDate, checkOut: isoDate, guests: z.number().int().min(1).max(50) })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'checkOut must be after checkIn' });
export const bookingQuoteSchema = bookingDates;
export const createBookingSchema = z
  .object({ listingId: z.string().uuid(), checkIn: isoDate, checkOut: isoDate, guests: z.number().int().min(1).max(50), method: z.enum(['CARD', 'WALLET']), returnUrl: z.string().url().optional() })
  .refine((v) => v.checkOut > v.checkIn, { path: ['checkOut'], message: 'checkOut must be after checkIn' });
export const cancelBookingSchema = z.object({ reason: z.string().max(500).optional() });
export const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(5).max(2000) });
export const reviewReplySchema = z.object({ reply: z.string().trim().min(1).max(2000) });

// ───────────── Payments ─────────────
export const checkoutSchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('WALLET_TOPUP'), amount: z.number().int().min(100), method: z.literal('CARD'), returnUrl: z.string().url().optional() }),
  z.object({ purpose: z.literal('PROMOTION'), listingId: z.string().uuid(), serviceCodes: z.array(z.string()).min(1).optional(), bundleCode: z.string().optional(), method: z.enum(['CARD', 'WALLET']), returnUrl: z.string().url().optional() }),
  z.object({ purpose: z.literal('LISTING_FEE'), listingId: z.string().uuid(), method: z.enum(['CARD', 'WALLET']), returnUrl: z.string().url().optional() }),
  z.object({ purpose: z.literal('VERIFICATION'), listingId: z.string().uuid(), method: z.enum(['CARD', 'WALLET']), returnUrl: z.string().url().optional() }),
  z.object({ purpose: z.literal('SUBSCRIPTION'), planCode: z.enum(['START', 'PRO', 'ENTERPRISE']), period: z.enum(['MONTH', 'YEAR']), method: z.enum(['CARD', 'WALLET']), autoRenew: z.boolean().default(true), returnUrl: z.string().url().optional() }),
]);
export const applyCreditSchema = z.object({ credit: z.enum(['BUMP', 'VIP_7', 'PREMIUM_7']) });

// ───────────── Agencies ─────────────
export const agencySchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(['AGENCY', 'DEVELOPER']),
  description: z.string().max(5000).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().url().nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  cityId: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
});
export const addMemberSchema = z.object({ login: z.string().trim().min(3) }); // phone or email of an existing user

// ───────────── Mortgage ─────────────
export const mortgageLeadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phoneSchema,
  listingId: z.string().uuid().nullable().optional(),
  price: z.number().int().positive(),
  downPayment: z.number().int().min(0),
  termYears: z.number().int().min(1).max(30),
  bankCode: z.string().nullable().optional(),
});

// ───────────── Admin ─────────────
export const adminListingQuerySchema = paginationSchema.extend({
  status: z.enum(LISTING_STATUSES as [string, ...string[]]).optional(),
  q: z.string().optional(),
  dealType: z.enum(DEAL_TYPES as [string, ...string[]]).optional(),
  ownerId: z.string().uuid().optional(),
  reported: boolQ,
});
export const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const adminUserQuerySchema = paginationSchema.extend({
  q: z.string().optional(),
  role: z.enum(USER_ROLES as [string, ...string[]]).optional(),
  status: z.enum(USER_STATUSES as [string, ...string[]]).optional(),
  accountType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
});
export const adminUserUpdateSchema = z.object({
  role: z.enum(USER_ROLES as [string, ...string[]]).optional(),
  status: z.enum(USER_STATUSES as [string, ...string[]]).optional(),
  name: z.string().min(2).max(80).optional(),
});
export const walletAdjustSchema = z.object({ amount: z.number().int().refine((v) => v !== 0), reason: z.string().trim().min(3).max(300) });
export const adminPaymentQuerySchema = paginationSchema.extend({
  status: z.enum(PAYMENT_STATUSES as [string, ...string[]]).optional(),
  purpose: z.enum(PAYMENT_PURPOSES as [string, ...string[]]).optional(),
  userId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const refundSchema = z.object({ amount: z.number().int().positive().optional(), reason: z.string().max(300).optional() });
export const adminBookingQuerySchema = paginationSchema.extend({ status: z.enum(BOOKING_STATUSES as [string, ...string[]]).optional(), payoutStatus: z.enum(['NOT_DUE', 'PENDING', 'PAID', 'CANCELLED']).optional() });
export const serviceUpdateSchema = z.object({ price: z.number().int().min(0).optional(), durationDays: z.number().int().min(0).optional(), active: z.boolean().optional() });
export const planUpdateSchema = z.object({
  priceMonthly: z.number().int().min(0).optional(), priceYearly: z.number().int().min(0).optional(), listingQuota: z.number().int().min(-1).optional(),
  monthlyBumps: z.number().int().min(0).optional(), monthlyVipCredits: z.number().int().min(0).optional(), monthlyPremiumCredits: z.number().int().min(0).optional(),
  maxAgents: z.number().int().min(1).optional(), active: z.boolean().optional(),
});
export const settingsUpdateSchema = z.object({
  freeListingsPerMonth: z.number().int().min(0).optional(),
  listingFee: z.number().int().min(0).optional(),
  listingLifetimeDays: z.number().int().min(1).optional(),
  dailyRentGuestFeePercent: z.number().min(0).max(50).optional(),
  dailyRentHostFeePercent: z.number().min(0).max(50).optional(),
  payoutDelayHours: z.number().int().min(0).optional(),
  freeCancellationHours: z.number().int().min(0).optional(),
  topupBonuses: z.array(z.object({ minAmount: z.number().int().min(0), bonusPercent: z.number().min(0).max(100) })).optional(),
  minTopup: z.number().int().min(1).optional(),
  maxTopup: z.number().int().min(1).optional(),
  moderationEnabled: z.boolean().optional(),
});
export const bannerSchema = z.object({
  placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]),
  title: z.string().min(1).max(120),
  imageUrl: z.string().url(),
  linkUrl: z.string().url(),
  active: z.boolean().default(true),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().default(0),
});
/** PATCH variant without defaults. */
export const bannerUpdateSchema = z.object({
  placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]),
  title: z.string().min(1).max(120),
  imageUrl: z.string().url(),
  linkUrl: z.string().url(),
  active: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  sortOrder: z.number().int(),
}).partial();
export const cmsPageSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.object({ az: z.string(), ru: z.string(), en: z.string() }),
  body: z.object({ az: z.string(), ru: z.string(), en: z.string() }),
});
export const broadcastSchema = z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(1000), audience: z.enum(['ALL', 'BUSINESS', 'INDIVIDUAL']) });

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type CreateListingInput = z.input<typeof createListingSchema>;
export type UpdateListingInput = z.input<typeof updateListingSchema>;
export type ListingSearchQuery = z.input<typeof listingSearchSchema>;
export type ListingSearchParsed = z.output<typeof listingSearchSchema>;
export type CheckoutInput = z.input<typeof checkoutSchema>;
export type CreateBookingInput = z.input<typeof createBookingSchema>;
export type BookingQuoteInput = z.input<typeof bookingQuoteSchema>;
export type AgencyInput = z.input<typeof agencySchema>;
export type MortgageLeadInput = z.input<typeof mortgageLeadSchema>;
export type MessageListQuery = z.input<typeof messageListQuerySchema>;
export type SavedSearchInput = z.input<typeof savedSearchSchema>;
export type BannerInput = z.input<typeof bannerSchema>;
export type CmsPageInput = z.input<typeof cmsPageSchema>;
export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>;
