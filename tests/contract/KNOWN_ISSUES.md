# Known issues — NestJS backend (`apps/api`) vs. the contract

Results of `SKIP_V2=1 pnpm --filter @evtap/contract-tests test` against the NestJS backend (validated 2026-10-13).
The tests below are kept as they are: they describe the contract; the backend (or the contract) has to change.
`[v2]` features that NestJS does not implement yet are not listed here — they are tagged in the tests (see README).

## 1. `POST /uploads` — file over 10 MB has no `FILE_TOO_LARGE` code

* Test: `test/uploads.test.ts` › `file > 10MB → 413 FILE_TOO_LARGE`
* Expected: `413 { statusCode: 413, code: "FILE_TOO_LARGE", … }` (ERROR_CODES lists `FILE_TOO_LARGE`)
* Actual: `413 {"message":"File too large","error":"Payload Too Large","statusCode":413}` — multer's
  `LIMIT_FILE_SIZE` (the `limits.fileSize` of the `FileInterceptor`) fires before `UploadsService`, whose own
  `FILE_TOO_LARGE` check is therefore unreachable.
* Fix: map `MulterError`/`PayloadTooLargeException` from the upload interceptor to `AppError('FILE_TOO_LARGE', …, 413)`.

## 2. `PATCH /admin/catalog/services/:code` and `PATCH /admin/catalog/plans/:code` with an empty body → 500

* Test: `test/admin-roles.test.ts` › `PATCH /admin/catalog/services/:code [ADMIN]`, `PATCH /admin/catalog/plans/:code [ADMIN]`
* Expected: `{}` is valid for `serviceUpdateSchema` / `planUpdateSchema` (all fields optional) → a no-op `200`
  for an existing code, `404 NOT_FOUND` for an unknown one.
* Actual: `500 {"code":"INTERNAL"}` — drizzle throws `No values to set` for `.update(...).set({})`
  (`apps/api/src/modules/catalog/catalog.module.ts`).
* Fix: skip the UPDATE when the body is empty (select the row instead, 404 when missing).

## 3. Booking unavailability codes are not in `ERROR_CODES`

* Test: `test/bookings.test.ts` › `overlapping stay → 409 (nothing charged); the host cannot book the own listing → 409`
* Expected: `409` with an `ApiError.code` from `ERROR_CODES`.
* Actual: `409 {"code":"DATES_UNAVAILABLE"}` for overlapping dates, `409 {"code":"OWN_LISTING"}` for the host's own
  listing. The same code path (`BookingsService.create`) can also emit `PAST_DATE`, `TOO_LONG`, `MIN_NIGHTS`,
  `MAX_GUESTS` — none of them is in `ERROR_CODES`.
* Note: this is a contract gap rather than a pure backend bug — `apps/web/src/lib/errors.ts` already switches on
  `DATES_UNAVAILABLE`. Suggested resolution: add `DATES_UNAVAILABLE`, `OWN_LISTING`, `PAST_DATE`, `TOO_LONG`,
  `MIN_NIGHTS`, `MAX_GUESTS` to `ERROR_CODES` (they are also the values of `BookingQuote.unavailableReason`), then pin
  `DATES_UNAVAILABLE` / `OWN_LISTING` in this test.

## 4. `GET /subscriptions/me` without a subscription answers an empty body instead of JSON `null`

* Test: `test/subscriptions.test.ts` › `GET /subscriptions/me → JSON null without a plan`
* Expected: `200` with body `null` (`Subscription | null`).
* Actual: `200` with an empty body and no `Content-Type` (NestJS/Express sends nothing when a handler returns `null`),
  which makes strict JSON decoders (iOS `JSONDecoder`, Kotlin serialization) fail.
* Fix: return `res.json(null)` / wrap the value, or answer with an explicit JSON `null`.

## Observations (not failing, worth aligning in the Go backend)

* Malformed UUIDs in the path are answered inconsistently: `404 NOT_FOUND` (listings, users, favorites),
  `400 VALIDATION_ERROR` (bookings, payments, apply-credit) or `400` **without** `code` (`ParseUUIDPipe` on
  conversations / notifications). The suite only requires 400/404 with an ApiError body.
* Unknown routes and the global rate limiter (`ThrottlerException`) answer without `code`; `RATE_LIMITED` exists in
  ERROR_CODES but is only used by messaging.
* `docs/ARCHITECTURE.md` cites `QUOTA_EXCEEDED` as an example error code; it is neither emitted nor in ERROR_CODES.
* `[v2]` status on NestJS: `ListingImage.uploadId` and owner-only `ListingDetail.contactPhone` already pass;
  `MapPoint.title` is present but `MapPoint.coverUrl` is always `null` (map query selects no cover); `GET /pages`,
  `GET /conversations/:id`, `PATCH /saved-searches/:id`, `POST /bookings/:id/pay` and the plain-WebSocket realtime
  protocol are missing (NestJS still speaks socket.io on `/ws`).
