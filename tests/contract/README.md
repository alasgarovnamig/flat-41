# @evtap/contract-tests — API contract suite

Black-box acceptance tests for the EvTap HTTP + WebSocket API. They talk to a **running** backend over the network
only — no imports of backend code — so the same suite gates the NestJS implementation (`apps/api`) and the Go rewrite.

The contract is `packages/shared/src/api.ts` (ENDPOINTS, ERROR_CODES, REALTIME, PAYMENT_RETURN),
`types.ts` (response DTOs, mirrored as zod schemas in [`src/dto.ts`](src/dto.ts)), `schemas.ts` (request validation)
and `pricing.ts` (fee math). Docs: `docs/ARCHITECTURE.md`, `docs/BUSINESS_MODEL.md`, `docs/MOCKBANK.md`.

## Run

```bash
pnpm install && pnpm build:shared            # once
# backend under test + mock bank must be running, database seeded (admin user)
API_URL=http://localhost:4000 BANK_URL=http://localhost:4100 \
DATABASE_URL=postgres://evtap:evtap@localhost:5432/evtap \
  pnpm --filter @evtap/contract-tests test

# a subset (files and/or node:test flags)
pnpm --filter @evtap/contract-tests test -- test/bookings.test.ts --test-name-pattern="cancel"
```

The runner (`scripts/run.ts`) executes every `test/*.test.ts` file with `node:test` (one process per file,
`CONCURRENCY` files in parallel, default 4) and then prints **endpoint coverage**: which `ENDPOINTS` keys were never
called, which never got a 2xx/3xx answer, and any request that matches no contract route.

| Env | Default | Meaning |
|---|---|---|
| `API_URL` | `http://localhost:4000` | backend base URL (API prefix `/api/v1` is appended; realtime at `ws://…/ws`) |
| `BANK_URL` | `http://localhost:4100` | mock bank (hosted checkout). Card-payment tests are **skipped** when `GET $BANK_URL/health` fails |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@evtap.az` / `Admin12345!` | seeded ADMIN account |
| `OTP_CODE` | `111111` | fixed development OTP (`devCode` from `/auth/otp/request` wins when present) |
| `DATABASE_URL` | – | optional; enables the 2 tests that must fast-forward time (see below). Skipped when unset |
| `MOCKBANK_MERCHANT_ID` / `MOCKBANK_SECRET` | `evtap` / `evtap-mockbank-secret` | used to sign a webhook *replay* (idempotency test) |
| `SKIP_V2` | – | `1` skips tests tagged `[v2]` (contract additions not yet implemented by every backend) |
| `CLIENT_RETURN_URL` | `evtap://payment/result` | `returnUrl` passed to `/checkout` |
| `CONCURRENCY` | `4` | test files run in parallel |

Running against the NestJS backend (what the suite was validated with):

```bash
# apps/api/.env: PORT=4050 API_PUBLIC_URL=http://localhost:4050 API_INTERNAL_URL=http://localhost:4050
#                MOCKBANK_URL=http://localhost:4151 MOCKBANK_PUBLIC_URL=http://localhost:4151 CORS_ORIGINS=* OTP_DEV_CODE=111111
cd apps/api && pnpm db:push && SEED_IMAGES=local pnpm db:seed && pnpm build && node dist/main.js
cd apps/mockbank && pnpm build && PORT=4151 PUBLIC_URL=http://localhost:4151 DATABASE_URL=…/mockbank node dist/index.js
SKIP_V2=1 API_URL=http://localhost:4050 BANK_URL=http://localhost:4151 pnpm --filter @evtap/contract-tests test
```

## What a backend must provide

* A development OTP (`OTP_CODE`) — users are created through `POST /auth/otp/request` + `/auth/otp/verify`.
* A seeded ADMIN user. MODERATORs are created by the tests (register → `PATCH /admin/users/:id {role}` → login).
* Moderation enabled (default settings); the suite never turns it off.
* Per-IP throttling keyed on `X-Forwarded-For` (one trusted proxy hop): every test user sends its own random
  `X-Forwarded-For`, so OTP / login limits never trip and files can run in parallel.
* The mock bank configured as the payment provider, reachable by the backend (webhooks) and by the tests (browser
  flow). The suite drives the bank's hosted checkout HTML like a browser: GET the payment page, POST the card form
  (`number`, `expiry`, `cvv`, `holder`, hidden `nonce`), answer 3-D Secure (`otp` = `111111`), follow
  `/checkout/:id/return` → `GET /api/v1/payments/return/mockbank` → `302` to `returnUrl?paymentId=…&status=…`.

## Conventions the suite asserts

* **Success** = any 2xx (create endpoints may answer 200 or 201); redirects are asserted exactly (`302`).
* **Errors** = exact HTTP status + `ApiError` body `{ statusCode, message: string | string[], code? }` with
  `statusCode` equal to the HTTP status and `code` ∈ `ERROR_CODES`. Tests pin the expected `code` wherever the
  contract defines one (e.g. `VALIDATION_ERROR`, `NOT_FOUND`, `INSUFFICIENT_FUNDS`).
* **DTOs** = every response body is validated with the zod schema of its type (`src/dto.ts`): required keys and
  types must match, nullable fields must be present as `null`, timestamps ISO-8601, calendar dates `YYYY-MM-DD`;
  extra keys are allowed.
* **Isolation**: every test creates its own users and listings (unique title markers, unique coordinates), so the
  suite is re-runnable against the same database and parallel-safe. Tests that change global admin state (catalog,
  settings, banners, pages) touch items no other test depends on and restore them in `finally`.
* **Roles**: `test/admin-roles.test.ts` derives the role matrix for every `/admin/*` endpoint from the ENDPOINTS
  legend (`[admin]` = ADMIN or MODERATOR, `[ADMIN]` = ADMIN only): anonymous → 401, USER → 403, MODERATOR → 403 on
  `[ADMIN]`, allowed otherwise; allowed calls must never answer 5xx.

## Database access (optional, isolated)

`src/db.ts` is the only place that touches Postgres, for flows that otherwise need days to pass:
marking a stay `COMPLETED` (reviews / host replies) and ending a subscription period (`SUBSCRIPTION_ENDED`).
Those tests use `dbOpts` and are skipped without `DATABASE_URL`. They rely on the shared schema
(`bookings.status`, `subscriptions.current_period_end`).

## `[v2]` tests

Contract additions not yet in the NestJS backend are tagged `[v2]` in the test name (and skipped with `SKIP_V2=1`):
`GET /conversations/:id`, `POST /bookings/:id/pay`, `PATCH /saved-searches/:id`, `GET /pages`, `ListingImage.uploadId`,
`MapPoint.title/coverUrl`, owner-only `ListingDetail.contactPhone`, and the whole plain-WebSocket realtime protocol
(`/ws?token=`, `{event,data}` frames, 4401, ping/pong, `message:new`, `notification:new`, `typing`,
`conversation:read`, `payment:updated`). v2 fields are not part of the base DTO schemas, so `SKIP_V2=1` runs stay green
on a v1 backend.

Known deviations of the NestJS backend are tracked in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Layout

```
src/config.ts      env, skip helpers (v2, bank, db)
src/http.ts        fetch client (Bearer, X-Forwarded-For, coverage recording)
src/dto.ts         zod response schemas for every DTO in types.ts
src/expect.ts      ok() / err() / shape() / eventually()
src/fixtures.ts    users (OTP / password), admin & moderator, uploads (JPEG generated in memory), listings, wallet funding
src/bank.ts        mock-bank hosted checkout driver + signed merchant calls
src/realtime.ts    WebSocket client for the REALTIME protocol
src/db.ts          time fast-forward (optional)
src/coverage.ts    request → ENDPOINTS matching
test/*.test.ts     one file per area (auth, users, reference-data, uploads, listings, listings-search,
                   favorites-saved-searches, messaging, realtime, bookings, payments, wallet, subscriptions,
                   agencies, notifications, admin-listings, admin-users, admin-content, admin-roles, generic)
```
