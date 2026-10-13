# EvTap — Architecture

```
                    ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐
                    │  apps/web    │   │  apps/admin  │   │  apps/mobile      │
                    │  Next.js SSR │   │  Vite+React  │   │  Expo (iOS+Andr.) │
                    │  :3000       │   │  :3001       │   │  :8081 (metro)    │
                    └──────┬───────┘   └──────┬───────┘   └─────────┬─────────┘
                           │  REST /api/v1  + socket.io /ws  (Bearer JWT)
                           ▼
 ┌──────────────┐   ┌──────────────────────────────────────────┐    ┌─────────────┐
 │ apps/mockbank│◄──│ apps/api  NestJS 11 · Drizzle · Postgres │───►│ PostgreSQL  │
 │ :4100        │──►│ :4000  (cron jobs, event bus, storage)   │    │ :5432       │
 └──────────────┘   └──────────────────────────────────────────┘    └─────────────┘
   signed webhooks             │ uploads → ./uploads or S3
```

* **packages/shared** (`@evtap/shared`) — the contract every app compiles against: enums, location data (AZ + GE),
  pricing catalog & fee math, DTO types (`types.ts`), zod request schemas (`schemas.ts`), the endpoint list
  (`api.ts` — **source of truth for every route**), formatting helpers. Built with tsup (CJS + ESM + d.ts);
  React Native consumes `src/` directly. Run `pnpm build:shared` after changing it.
* **apps/api** — NestJS 11 (CommonJS), PostgreSQL via Drizzle ORM, JWT auth (access 15 min + rotating refresh 30 d),
  phone OTP login, global `AuthGuard` (`@Public()`, `@Roles()`), zod validation (`ZodPipe`), Swagger at `/api/docs`,
  socket.io realtime, `@nestjs/schedule` cron jobs, `@nestjs/event-emitter` domain events.
* **apps/mockbank** — fake card acquirer, see [MOCKBANK.md](MOCKBANK.md).
* **apps/web** — public site + user cabinet, SSR/SEO, az/ru/en.
* **apps/admin** — back-office dashboard for ADMIN / MODERATOR.
* **apps/mobile** — Expo / React Native app for iOS & Android, az/ru/en.

## Conventions (all apps)

| Topic | Rule |
|---|---|
| API base | `${API_URL}/api/v1` (dev `http://localhost:4000/api/v1`) |
| Auth | `Authorization: Bearer <accessToken>`; on 401 call `POST /auth/refresh` once, then retry; if refresh fails → logout |
| Money | `listing.price` = **major** units (whole ₼). Everything else (payments, wallet, fees, bookings, catalog prices) = **minor** units (qəpik). Use `formatPrice` / `formatMoney` from shared |
| Dates | ISO strings; booking dates `YYYY-MM-DD` |
| Pagination | `?page=1&pageSize=20` → `{ items, total, page, pageSize }` |
| Errors | `{ statusCode, code?, message: string \| string[] }` — switch on `code` (e.g. `OTP_INVALID`, `INSUFFICIENT_FUNDS`, `DATES_UNAVAILABLE`, `VALIDATION_ERROR`; full list: `ERROR_CODES` in packages/shared/src/api.ts) |
| i18n | `az` (default), `ru`, `en`. Location names via `localized(name, locale)` |
| Phone | E.164 `+994XXXXXXXXX` (`phoneSchema` normalises `050 123 45 67`) |
| Brand | Name **EvTap**. Primary `#0E7C66` (teal-green), primary-dark `#0A5C4C`, accent/VIP `#F5A524` (gold), premium `#7C3AED` (violet), urgent `#E5484D` (red), highlight card bg `#FFF8E6`, text `#111827`, muted `#6B7280`, surface `#F7F7F8`. Font: Inter (web/admin), system (mobile). Rounded 12px cards |
| Payment return | web `returnUrl = ${WEB_URL}/payment/result`, mobile `evtap://payment/result`; result page polls `GET /payments/:id` until final |

## Ports & local services

| Service | Port | Notes |
|---|---|---|
| PostgreSQL | 5432 | db `evtap` (API) + db `mockbank`, user/pass `evtap/evtap` |
| API | 4000 | `/api/v1`, `/api/docs`, `/ws`, `/uploads` |
| Mock bank | 4100 | `/checkout/:id`, `/admin` (admin/admin) |
| Web | 3000 | |
| Admin | 3001 | |
| Expo metro | 8081 | |

## API module ownership (`apps/api/src/modules/*`)

| Module | Responsibility |
|---|---|
| core: `auth`, `settings` (+`QuotaService`), `notifications` (`NotificationsService.notify`, `EVENTS`), `audit`, `sms`, `health` | shared infrastructure |
| `users`, `locations`, `uploads`, `listings`, `favorites`, `saved-searches`, `agencies`, `mortgage`, `content` (banners + CMS pages), `stats` (admin overview/listings/users), `admin` (admin listings/users/agencies/reports/content/mortgage/audit) | marketplace |
| `catalog`, `wallet`, `payments` (+providers/mockbank), `promotions`, `subscriptions`, `bookings` (+reviews) and their admin endpoints (payments, bookings, subscriptions, catalog, settings, revenue stats) | money |
| `messaging`, `realtime` (socket.io gateway), `push` (Expo push), notifications endpoints + admin broadcast | communication |

Cross-module rule: a module may **read** any table directly through Drizzle; it **writes** only its own tables, or calls
the owning module's exported service. Examples: listings needs to apply a promotion → `PromotionsService`;
payments fulfil a LISTING_FEE → `ListingsService.markListingFeePaid(listingId)`.

### Exported service contracts between modules

```ts
// promotions  (money)
PromotionsService.apply(listingId: string, serviceCode: string, source: 'PAYMENT'|'CREDIT'|'ADMIN', paymentId?: string, tx?: Tx): Promise<void>
// listings    (marketplace)
ListingsService.markListingFeePaid(listingId: string, tx?: Tx): Promise<void>   // DRAFT → PENDING (or ACTIVE when moderation disabled), isFreeQuota=false
ListingsService.markVerified(listingId: string, tx?: Tx): Promise<void>         // VERIFICATION purchase
ListingsService.toCard(row): ListingCard                                       // mapper reused by favorites, bookings…
// wallet      (money)
WalletService.credit(userId, amount, type, description, opts?: { bonusAmount?, paymentId?, bookingId?, actorId?, tx? })
WalletService.debit(userId, amount, description, opts?)  // throws AppError('INSUFFICIENT_FUNDS') ; spends bonus first
// notifications (core)
NotificationsService.notify(userId, type, title, body, data)
```

Listing search ordering: `PREMIUM` (premiumUntil > now) and `VIP` listings are served in separate blocks
(`GET /listings/featured`), regular results are ordered by `bumpedAt desc` (bump = set `bumpedAt = now()`).
Cards carry `isVip / isPremium / isHighlighted / isUrgent` flags so clients render badges & colours.

## Database & migrations

Schema: `apps/api/src/db/schema.ts`. Dev: `pnpm --filter @evtap/api db:push` (sync schema). Production:
`db:generate` creates SQL migrations in `apps/api/drizzle/`, `db:migrate` applies them. `db:seed` loads demo data.

## Cron jobs (API)

| Job | Interval | What |
|---|---|---|
| listing expiry | hourly | ACTIVE → EXPIRED after `listingLifetimeDays`; notify 3 days before |
| promotions expiry | every 10 min | clear `vipUntil/premiumUntil/...` past now, notify `PROMOTION_EXPIRED` |
| auto-bump | hourly | listings with `autoBumpUntil > now` and last bump ≥ 24 h ago → bump |
| booking holds | every 5 min | `PENDING_PAYMENT` past `holdExpiresAt` → CANCELLED |
| booking completion & payouts | hourly | check-out passed → COMPLETED; check-in + `payoutDelayHours` passed → credit host wallet (`PAYOUT`) |
| subscription renewal | hourly | period end reached → charge saved card token / wallet; fail → PAST_DUE → 3 attempts → EXPIRED; reset monthly credits |
| saved-search matcher | every 15 min | new matching listings → `SAVED_SEARCH_MATCH` notification |
| payment reconciliation | every 10 min | PENDING card payments older than 15 min → query bank order status |
