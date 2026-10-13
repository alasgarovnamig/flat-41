/**
 * API CONTRACT — single source of truth for every HTTP endpoint.
 * Base URL: `${API_URL}/api/v1`. Auth: `Authorization: Bearer <accessToken>`.
 * Lists return Paginated<T>. Errors return ApiError with HTTP status.
 *
 * Legend: [public] no auth · [auth] logged-in user · [owner] resource owner · [admin] ADMIN or MODERATOR · [ADMIN] admin only
 */
export const API_PREFIX = '/api/v1';

export const ENDPOINTS = {
  // ── Auth ───────────────────────────────────────────────────────────────
  'POST /auth/otp/request': '[public] body OtpRequestInput → { sent: true, retryAfter: number, devCode?: string } (devCode only when NODE_ENV!=production)',
  'POST /auth/otp/verify': '[public] body OtpVerifyInput → AuthResponse (creates the user on first login; isNew=true)',
  'POST /auth/register': '[public] body RegisterInput → AuthResponse',
  'POST /auth/login': '[public] body LoginInput (login = email or phone) → AuthResponse',
  'POST /auth/refresh': '[public] body { refreshToken } → AuthResponse (refresh token rotation)',
  'POST /auth/logout': '[auth] body { refreshToken } → { ok: true }',
  'GET /auth/me': '[auth] → Me',

  // ── Users ──────────────────────────────────────────────────────────────
  'PATCH /users/me': '[auth] body UpdateMeInput → User',
  'POST /users/me/password': '[auth] body { currentPassword?, newPassword } → { ok: true }',
  'DELETE /users/me': '[auth] → { ok: true } (GDPR / App Store account deletion: anonymise, archive listings)',
  'POST /users/me/push-tokens': '[auth] body { token, platform } → { ok: true }',
  'DELETE /users/me/push-tokens/:token': '[auth] → { ok: true }',
  'GET /users/:id': '[public] → PublicUser',

  // ── Reference data ─────────────────────────────────────────────────────
  'GET /locations': '[public] → { countries, cities, districts, metroStations } (same data as @evtap/shared locations)',
  'GET /catalog': '[public] → Catalog (current prices from DB)',
  'GET /mortgage/banks': '[public] → MortgageBank[]',
  'POST /mortgage/leads': '[public, auth optional] body MortgageLeadInput → { id }',
  'GET /banners': '[public] query { placement } → Banner[] (active only; counts an impression)',
  'POST /banners/:id/click': '[public] → { ok: true }',
  'GET /pages': '[public] → { slug, title }[] (title localised by ?locale=az|ru|en)',
  'GET /pages/:slug': '[public] → CmsPage (body is Markdown)',

  // ── Uploads ────────────────────────────────────────────────────────────
  'POST /uploads': '[auth] multipart field "file" (jpeg/png/webp ≤ 10MB) → Upload (resized to max 1600px + 400px thumb, webp)',

  // ── Listings ───────────────────────────────────────────────────────────
  'GET /listings': '[public] query ListingSearchQuery → Paginated<ListingCard> (ACTIVE only; sorted by bumpedAt desc by default)',
  'GET /listings/featured': '[public] query { kind: "vip"|"premium", dealType?, cityId?, limit?=12 } → ListingCard[] (random order among active promotions)',
  'GET /listings/map': '[public] query ListingSearchQuery (bbox required) → MapPoint[] (max 500)',
  'GET /listings/:id': '[public, auth optional] → ListingDetail (non-ACTIVE visible to owner/admin only; counts a view)',
  'POST /listings/:id/phone': '[public] → { phone } (counts a phone view)',
  'GET /listings/:id/similar': '[public] → ListingCard[] (max 8)',
  'GET /listings/:id/reviews': '[public] query pagination → Paginated<Review>',
  'GET /listings/:id/availability': '[public] query { from, to } → Availability',
  'PUT /listings/:id/availability': '[owner] body { blockedDates } → Availability',
  'GET /listings/:id/stats': '[owner] → ListingStats',
  'POST /listings': '[auth] body CreateListingInput → MyListing (status PENDING, or DRAFT + requiresPayment=true when free quota is exhausted → pay LISTING_FEE via /checkout)',
  'PATCH /listings/:id': '[owner] body UpdateListingInput → MyListing (ACTIVE → PENDING re-moderation when moderationEnabled)',
  'POST /listings/:id/actions': '[owner] body { action: MARK_SOLD|ARCHIVE|RENEW|RESTORE } → MyListing',
  'DELETE /listings/:id': '[owner] → { ok: true } (soft delete = ARCHIVED)',
  'POST /listings/:id/report': '[public, auth optional] body { reason, comment? } → { ok: true }',
  'POST /listings/:id/apply-credit': '[owner] body { credit: BUMP|VIP_7|PREMIUM_7 } → MyListing (spends subscription credits)',
  'GET /me/listings': '[auth] query { status?, page, pageSize } → Paginated<MyListing>',

  // ── Favorites & saved searches ─────────────────────────────────────────
  'GET /favorites': '[auth] query pagination → Paginated<ListingCard>',
  'GET /favorites/ids': '[auth] → string[]',
  'POST /favorites/:listingId': '[auth] → { ok: true }',
  'DELETE /favorites/:listingId': '[auth] → { ok: true }',
  'GET /saved-searches': '[auth] → SavedSearch[]',
  'POST /saved-searches': '[auth] body SavedSearchInput → SavedSearch',
  'PATCH /saved-searches/:id': '[auth] body { name?, notify? } → SavedSearch',
  'DELETE /saved-searches/:id': '[auth] → { ok: true }',

  // ── Messaging (also realtime over WebSocket, see REALTIME) ─────────────
  'GET /conversations': '[auth] query pagination → Paginated<Conversation>',
  'POST /conversations': '[auth] body { listingId, message } → Conversation (re-uses existing conversation for same listing+buyer)',
  'GET /conversations/unread-count': '[auth] → { count }',
  'GET /conversations/:id': '[participant] → Conversation',
  'GET /conversations/:id/messages': '[auth] query { before?: messageId, limit?=50 } → Message[] (newest last)',
  'POST /conversations/:id/messages': '[auth] body { body } → Message',
  'POST /conversations/:id/read': '[auth] → { ok: true }',

  // ── Daily rent bookings (Airbnb model) ─────────────────────────────────
  'POST /bookings/quote': '[public] body BookingQuoteInput → BookingQuote',
  'POST /bookings': '[auth] body CreateBookingInput → { booking: Booking, checkout: CheckoutResponse } (dates are held 30 min while PENDING_PAYMENT)',
  'GET /bookings': '[auth] query { role: guest|host, status?, page, pageSize } → Paginated<Booking>',
  'GET /bookings/:id': '[guest|host] → Booking',
  'POST /bookings/:id/pay': '[guest] body { method: CARD|WALLET, returnUrl? } → CheckoutResponse (resume payment of a PENDING_PAYMENT booking whose hold has not expired)',
  'POST /bookings/:id/cancel': '[guest|host] body { reason? } → Booking (refund per policy: guest ≥ freeCancellationHours → 100%, else 50% of subtotal; host cancel → 100%)',
  'POST /bookings/:id/review': '[guest] body { rating, comment } → Review (only COMPLETED, once)',
  'POST /reviews/:id/reply': '[host] body { reply } → Review',

  // ── Payments, wallet, subscriptions ────────────────────────────────────
  'POST /checkout': '[auth] body CheckoutInput → CheckoutResponse',
  'GET /payments': '[auth] query pagination → Paginated<Payment>',
  'GET /payments/:id': '[auth] → Payment (poll after returning from the bank)',
  'POST /payments/webhook/mockbank': '[bank] signed callback (X-Signature HMAC-SHA256) → { ok: true }',
  'GET /payments/return/mockbank': '[bank redirect] query { paymentId, orderId, status } → 302 to the client returnUrl?paymentId=..&status=..',
  'GET /wallet': '[auth] → Wallet',
  'GET /wallet/transactions': '[auth] query pagination → Paginated<WalletTransaction>',
  'GET /subscriptions/me': '[auth] → Subscription | null',
  'POST /subscriptions/me/cancel': '[auth] → Subscription (autoRenew=false, stays active until period end)',
  'POST /subscriptions/me/resume': '[auth] → Subscription (autoRenew=true)',

  // ── Agencies / business ────────────────────────────────────────────────
  'GET /agencies': '[public] query { type?, cityId?, q?, page, pageSize } → Paginated<Agency>',
  'GET /agencies/:slug': '[public] → Agency',
  'POST /agencies': '[auth] body AgencyInput → Agency (user becomes BUSINESS + OWNER)',
  'GET /agencies/me': '[auth] → Agency',
  'PATCH /agencies/me': '[agency owner] body Partial<AgencyInput> → Agency',
  'GET /agencies/me/members': '[agency owner] → AgencyMember[]',
  'POST /agencies/me/members': '[agency owner] body { login } → AgencyMember (limited by plan maxAgents)',
  'DELETE /agencies/me/members/:userId': '[agency owner] → { ok: true }',
  'GET /agencies/me/stats': '[agency member] query { days?=30 } → { views, phoneViews, messages, listings, daily: TimeseriesPoint[] }',

  // ── Notifications ──────────────────────────────────────────────────────
  'GET /notifications': '[auth] query pagination → Paginated<AppNotification>',
  'POST /notifications/:id/read': '[auth] → { ok: true }',
  'POST /notifications/read-all': '[auth] → { ok: true }',

  // ── Admin (role ADMIN or MODERATOR unless marked [ADMIN]) ──────────────
  'GET /admin/stats/overview': '[admin] → AdminOverview',
  'GET /admin/stats/revenue': '[admin] query { days?=30 } → TimeseriesPoint[] (value = total, plus one key per PaymentPurpose)',
  'GET /admin/stats/listings': '[admin] query { days?=30 } → TimeseriesPoint[] (value = created, published, rejected)',
  'GET /admin/stats/users': '[admin] query { days?=30 } → TimeseriesPoint[] (value = new users)',
  'GET /admin/listings': '[admin] query AdminListingQuery → Paginated<AdminListing>',
  'GET /admin/listings/:id': '[admin] → ListingDetail & { reports: ListingReport[], ownerPhone }',
  'POST /admin/listings/:id/approve': '[admin] → AdminListing',
  'POST /admin/listings/:id/reject': '[admin] body { reason } → AdminListing',
  'POST /admin/listings/:id/block': '[admin] body { reason } → AdminListing',
  'PATCH /admin/listings/:id': '[admin] body UpdateListingInput & { isVerified? } → AdminListing',
  'POST /admin/listings/:id/promote': '[ADMIN] body { serviceCode } → AdminListing (free promotion, e.g. compensation)',
  'GET /admin/users': '[admin] query AdminUserQuery → Paginated<AdminUser>',
  'GET /admin/users/:id': '[admin] → AdminUser & { listings: AdminListing[], payments: Payment[], walletTransactions: WalletTransaction[] }',
  'PATCH /admin/users/:id': '[ADMIN] body { role?, status?, name? } → AdminUser',
  'POST /admin/users/:id/wallet-adjust': '[ADMIN] body { amount, reason } → Wallet',
  'GET /admin/agencies': '[admin] query { q?, verified?, page } → Paginated<Agency>',
  'PATCH /admin/agencies/:id': '[admin] body { verified } → Agency',
  'GET /admin/payments': '[admin] query AdminPaymentQuery → Paginated<Payment & { userName }>',
  'GET /admin/payments/:id': '[admin] → Payment & { user, providerData }',
  'POST /admin/payments/:id/refund': '[ADMIN] body { amount?, reason? } → Payment (card → bank refund, wallet → wallet credit)',
  'GET /admin/bookings': '[admin] query AdminBookingQuery → Paginated<Booking>',
  'POST /admin/bookings/:id/cancel': '[ADMIN] body { reason } → Booking (full refund)',
  'GET /admin/subscriptions': '[admin] query { status?, page } → Paginated<Subscription & { user, agency }>',
  'GET /admin/reports': '[admin] query { status?, page } → Paginated<ListingReport>',
  'PATCH /admin/reports/:id': '[admin] body { status: RESOLVED|DISMISSED } → ListingReport',
  'GET /admin/catalog': '[admin] → Catalog (including inactive)',
  'PATCH /admin/catalog/services/:code': '[ADMIN] body { price?, durationDays?, active? } → ServiceDef',
  'PATCH /admin/catalog/plans/:code': '[ADMIN] body PlanUpdate → PlanDef',
  'GET /admin/settings': '[ADMIN] → PlatformSettings',
  'PATCH /admin/settings': '[ADMIN] body SettingsUpdateInput → PlatformSettings',
  'GET /admin/banners': '[admin] → Banner[]',
  'POST /admin/banners': '[ADMIN] body BannerInput → Banner',
  'PATCH /admin/banners/:id': '[ADMIN] body Partial<BannerInput> → Banner',
  'DELETE /admin/banners/:id': '[ADMIN] → { ok: true }',
  'GET /admin/pages': '[admin] → CmsPage[]',
  'PUT /admin/pages/:slug': '[ADMIN] body CmsPageInput → CmsPage',
  'DELETE /admin/pages/:slug': '[ADMIN] → { ok: true }',
  'GET /admin/mortgage-leads': '[admin] query { status?, page } → Paginated<MortgageLead>',
  'PATCH /admin/mortgage-leads/:id': '[admin] body { status } → MortgageLead',
  'POST /admin/notifications/broadcast': '[ADMIN] body { title, body, audience } → { sent: number }',
  'GET /admin/audit-logs': '[ADMIN] query { entity?, actorId?, page } → Paginated<AuditLog>',
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

/** Stable machine-readable error codes (ApiError.code). Clients translate these; unknown codes fall back to HTTP status. */
export const ERROR_CODES = [
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL',
  'TOKEN_INVALID', 'REFRESH_INVALID', 'REFRESH_REUSED', 'INVALID_CREDENTIALS', 'INVALID_PASSWORD', 'USER_EXISTS', 'EMAIL_TAKEN',
  'USER_BLOCKED', 'USER_NOT_FOUND', 'OTP_INVALID', 'OTP_EXPIRED', 'OTP_TOO_FREQUENT', 'OTP_TOO_MANY_ATTEMPTS',
  'FILE_REQUIRED', 'FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'INVALID_IMAGE', 'INVALID_IMAGES', 'INVALID_LOCATION',
  'LISTING_BLOCKED', 'LISTING_NOT_ACTIVE', 'LISTING_NOT_AVAILABLE', 'LISTING_NOT_PAID', 'LISTING_STATUS_INVALID',
  'INVALID_STATUS', 'INVALID_STATUS_TRANSITION', 'ALREADY_VERIFIED',
  'NO_AGENCY', 'ALREADY_IN_AGENCY', 'ALREADY_MEMBER', 'AGENT_LIMIT_REACHED', 'CANNOT_REMOVE_OWNER', 'CANNOT_MODIFY_SELF', 'LIMIT_REACHED',
  'CANNOT_MESSAGE_SELF', 'MESSAGE_EMPTY', 'RECIPIENT_UNAVAILABLE', 'INVALID_CURSOR',
  'NOT_DAILY_RENT', 'NOT_BOOKABLE', 'DATES_UNAVAILABLE', 'OWN_LISTING', 'PAST_DATE', 'TOO_LONG', 'MIN_NIGHTS', 'MAX_GUESTS', 'BOOKING_NOT_CANCELLABLE', 'BOOKING_ALREADY_STARTED', 'BOOKING_NOT_COMPLETED', 'ALREADY_REVIEWED',
  'INSUFFICIENT_FUNDS', 'INVALID_AMOUNT', 'AMOUNT_OUT_OF_RANGE', 'CURRENCY_NOT_SUPPORTED', 'INVALID_SERVICE', 'INVALID_PLAN',
  'NO_SUBSCRIPTION', 'NO_CREDITS', 'SUBSCRIPTION_ENDED', 'RETURN_URL_NOT_ALLOWED', 'PAYMENT_PROVIDER_UNAVAILABLE',
  'INVALID_SIGNATURE', 'NOT_REFUNDABLE', 'REFUND_REJECTED', 'REFUND_AMOUNT_INVALID', 'FULFILMENT_FAILED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Realtime: plain **WebSocket** (RFC 6455) at `ws(s)://<API host>/ws?token=<accessToken>` — no socket.io, so native
 * iOS (URLSessionWebSocketTask) and Android (OkHttp WebSocket) clients need no extra library.
 * Every frame is UTF-8 JSON: `{ "event": "<name>", "data": <payload> }`.
 *  - Auth: invalid/missing token → the server closes with code 4401 ("UNAUTHORIZED").
 *  - Heartbeat: server sends `{"event":"ping"}` every 25 s, client answers `{"event":"pong"}`; idle > 60 s → closed.
 *  - Clients reconnect with exponential back-off (1 s → 30 s) and refresh the access token first when it expired.
 */
export const REALTIME = {
  path: '/ws',
  serverEvents: {
    'message:new': 'Message & { conversationId } — sent to the recipient and to ALL connections of the sender (multi-device sync); clients dedupe by message id',
    'conversation:read': '{ conversationId, readerId, readAt }',
    'notification:new': 'AppNotification',
    'payment:updated': 'Payment',
    'typing': '{ conversationId, userId } (relayed from the other participant; throttled to ~1/s)',
    'ping': 'null — heartbeat, reply with pong',
  },
  clientEvents: {
    'typing': '{ conversationId }',
    'pong': 'null',
  },
} as const;

export interface RealtimeFrame<T = unknown> { event: string; data?: T }

/** Client-side redirect targets after bank payment. Clients pass `returnUrl` to /checkout. */
export const PAYMENT_RETURN = {
  web: '/payment/result', // https://evtap.az/payment/result?paymentId=..&status=..
  mobileScheme: 'evtap://payment/result',
} as const;
