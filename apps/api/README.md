# EvTap API (Go)

Go 1.26 · chi v5 · pgx v5 · goose migrations (embedded) · golang-jwt · go-playground/validator.
Implements exactly the HTTP + WebSocket contract in `packages/shared/src/api.ts` (DTOs: `types.ts`, validation: `schemas.ts`).

```bash
cp .env.example .env            # DATABASE_URL, PORT, …  (same variables as the former NestJS API)
go run ./cmd/api                # migrates on start, serves /api/v1, /ws, /uploads
go run ./cmd/seed               # demo data (SEED_IMAGES=local for offline placeholder photos)
go test ./...
```

## Layout
```
cmd/api, cmd/migrate, cmd/seed
internal/config      env config
internal/db          pgx pool, goose migrations (migrations/*.sql), WithTx, error helpers
internal/httpx       AppError → ApiError JSON, H()/HS() handler adapters, Bind/Validate (validator tags + Normalize/Check),
                     UUIDParam, Q() query parsing, Pagination/Paginated, ISO dates (JS toISOString format)
internal/shared      Go mirror of @evtap/shared: embedded JSON data (pnpm --filter @evtap/shared export:json), pricing maths
internal/auth        JWT signer, Authenticate/Required/Roles middleware, OTP + password login, refresh rotation, /auth/me
internal/core/*      settings (+quota, subscription DTO), notify (NotificationsService), events (in-process bus), audit, sms
internal/app         Deps (shared services), cross-module contracts (ListingsAPI, PromotionsAPI, WalletAPI), Scheduler
internal/modules/*   one package per feature; each exposes New(d) and Routes(r chi.Router)
internal/server      router, CORS, rate limits, module list
```

## Conventions
- Handlers: `r.With(auth.Required).Get("/x", httpx.H(func(w, r) (any, error) {...}))`; creates that the former API answered
  with 201 use `httpx.HS(http.StatusCreated, …)`; endpoints decorated `@HttpCode(200)` in Nest use `httpx.H`.
- Auth levels from the contract legend: `[public]` → no middleware (user still available via `auth.Current(r)` when a
  token is sent), `[auth]` → `auth.Required`, `[admin]` → `auth.Roles("MODERATOR")`, `[ADMIN]` → `auth.Roles("ADMIN")`.
- Errors: return `httpx.BadRequest("CODE", "msg")`, `httpx.NotFound("Listing")`, `httpx.E(status, code, msg)` — codes from ERROR_CODES.
- Requests: struct with `json` + `validate` tags mirroring the zod schema; implement `Normalize()` (trim, phone, lower-case)
  and `Check() []string` for cross-field rules. PATCH bodies use pointer fields so absent ≠ zero.
- Money: listing `price` major units; everything else minor units (int).
- Dates in DTOs: `httpx.ISO(t)` / `httpx.ISOPtr(t)`; booking dates `YYYY-MM-DD`.
- Every admin mutation → `d.Audit.Log(...)`. Notification texts in Azerbaijani via `d.Notify.Notify(...)`.
- Cron: `d.Jobs.Every("listings.expire", time.Hour, fn)`.

## Marketplace modules (users, listings, uploads, admin, …)
- Shared helpers in `internal/mkt`: `ReadBody` + `Body.Str/Int/Num/Bool/StrArr` (zod-like validation that keeps
  absent ≠ `null`, used for PATCH semantics), `QEnum/QUUID/QDays` query helpers, `EscapeLike`, `F32` (float4 → JS number).
- Listing search (`listings/search.go`): `ParseSearch` (listingSearchSchema over URL query or stored saved-search JSON)
  → `BuildConditions` (squirrel) — shared by `GET /listings`, `/listings/map` and the saved-search matcher.
- Cross-module: `listings.Service` implements `app.ListingsAPI` (`d.Listings`); card SQL/DTO via `listings.CardColumns`,
  `listings.ScanCard`, `Row.Card()`. Admin wallet-adjust / promote call `d.Wallet` / `d.Promotions` lazily (503
  `PAYMENT_PROVIDER_UNAVAILABLE` while those modules are absent).
- Jobs: `listings.expiry` (hourly: expire + 3-day notice), `saved-searches.matcher` (15 min).
- Uploads: WebP output like before (q80 / thumb q70) via `github.com/gen2brain/webp` without cgo — system `libwebp.so`
  when installed (install `libwebp` in the runtime image for speed), else a bundled WASM build (~1 s per photo).
  `UPLOAD_IMAGE_FORMAT=jpeg` switches to JPEG q82. `STORAGE_DRIVER=s3` is a stub (`uploads.S3Storage`).
- Seed: `go run ./cmd/seed` (idempotent); `SEED_IMAGES=local` writes placeholder WebPs to `UPLOAD_DIR/seed/`.
