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
