# EvTap — Architecture

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌──────────────────────┐
   │  apps/web    │   │  apps/admin  │   │  apps/ios        │   │  apps/android        │
   │  Next.js SSR │   │  Vite+React  │   │  Swift/SwiftUI   │   │  Kotlin/Compose      │
   │  :3000       │   │  :3001       │   │  iOS 17+         │   │  minSdk 26           │
   └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘   └──────────┬───────────┘
          └──────── REST /api/v1 (Bearer JWT) + WebSocket /ws?token= ───────┘
                                     ▼
 ┌──────────────┐   ┌────────────────────────────────────────────┐    ┌─────────────┐
 │ apps/mockbank│◄──│ apps/api  Go 1.26 · chi · pgx · goose      │───►│ PostgreSQL  │
 │ Go · :4100   │──►│ :4000  (cron jobs, event bus, push, storage)│    │ :5432       │
 └──────────────┘   └────────────────────────────────────────────┘    └─────────────┘
   signed webhooks            push → APNs (iOS) / FCM (Android)
```

* **packages/shared** (`@evtap/shared`) — the contract every client compiles against: enums, location data (AZ + GE),
  pricing catalog & fee math, DTO types (`types.ts`), zod request schemas (`schemas.ts`), the endpoint list
  (`api.ts` — **source of truth for every route**, realtime protocol and `ERROR_CODES`), formatting helpers.
  Reference data is exported to JSON for the Go backend (`pnpm --filter @evtap/shared export:json` → `apps/api/internal/shared/data`).
* **packages/design-tokens** — "Soft Monochrome" design tokens (`tokens.json`) generating CSS, TS, SwiftUI and Compose
  files. Spec: [design/DESIGN_SYSTEM.md](design/DESIGN_SYSTEM.md).
* **apps/api** — Go: chi router, pgx, goose migrations (embedded, applied on start), JWT (access 15 min + rotating
  refresh 30 d with reuse detection), phone OTP, validator-based request validation mirroring the zod schemas,
  plain-WebSocket realtime, in-process event bus, scheduler for cron jobs, push providers (console / Expo / native
  APNs + FCM). See [apps/api/README.md](../apps/api/README.md).
* **apps/mockbank** — Go fake card acquirer, see [MOCKBANK.md](MOCKBANK.md).
* **apps/web** — public site + user cabinet, SSR/SEO, az/ru/en.
* **apps/admin** — back-office dashboard for ADMIN / MODERATOR.
* **apps/ios** — SwiftUI app (XcodeGen project, `EvTapCore` Swift package). **apps/android** — Compose app (`:core` JVM module + `:app`).
* **tests/contract** — implementation-agnostic contract test suite (every endpoint, real bank flows, WebSocket); the
  acceptance gate for the backend.

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
| Design | Soft Monochrome — tokens in `packages/design-tokens`, spec in `docs/design/DESIGN_SYSTEM.md` (Outfit + Inter, ink on soft greys, black pills, 28px cards) |
| Payment return | web `returnUrl = ${WEB_URL}/payment/result`, mobile `evtap://payment/result`; result page polls `GET /payments/:id` until final |

## Ports & local services

| Service | Port | Notes |
|---|---|---|
| PostgreSQL | 5432 | db `evtap` (API) + db `mockbank`, user/pass `evtap/evtap` |
| API | 4000 | `/api/v1`, `/ws`, `/uploads` |
| Mock bank | 4100 | `/checkout/:id`, `/admin` (admin/admin) |
| Web | 3000 | |
| Admin | 3001 | |

## API modules (`apps/api/internal/modules/*`)

| Module | Responsibility |
|---|---|
| core (`internal/auth`, `internal/core/{settings,notify,events,audit,sms,mail}`) | auth, settings + quota, notifications, event bus, audit |
| `users`, `locations`, `uploads`, `listings`, `favorites`, `savedsearches`, `agencies`, `mortgage`, `content` (banners + CMS pages), `stats` (admin overview/listings/users), `admin` (admin listings/users/agencies/reports/content/mortgage/audit) | marketplace |
| `catalog`, `wallet`, `payments` (+providers/mockbank), `promotions`, `subscriptions`, `bookings` (+reviews) and their admin endpoints (payments, bookings, subscriptions, catalog, settings, revenue stats) | money |
| `messaging`, `realtime` (WebSocket hub), `push` (Expo / APNs / FCM), `notifications` endpoints + admin broadcast | communication |

Cross-module rule: a module may **read** any table directly; it **writes** only its own tables, or calls the owning
module's service through the typed contracts in `apps/api/internal/app/contracts.go` (`ListingsAPI`, `PromotionsAPI`,
`WalletAPI`, `PushAPI`) wired into `app.Deps` — e.g. a paid LISTING_FEE calls `d.Listings.MarkListingFeePaid`,
an admin free promotion calls `d.Promotions.Apply`, wallet changes go through `d.Wallet.Credit/Debit` (row-locked ledger).

Listing search ordering: `PREMIUM` (premiumUntil > now) and `VIP` listings are served in separate blocks
(`GET /listings/featured`), regular results are ordered by `bumpedAt desc` (bump = set `bumpedAt = now()`).
Cards carry `isVip / isPremium / isHighlighted / isUrgent` flags so clients render badges & colours.

## Database & migrations

SQL migrations in `apps/api/internal/db/migrations/*.sql` (goose, embedded in the binary, applied automatically on
start; `go run ./cmd/migrate` to apply explicitly). Demo data: `go run ./cmd/seed` (`SEED_IMAGES=local` for offline photos).

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
