# Mock Bank — payment gateway contract

`apps/mockbank` is a stand-alone fake acquiring bank (port **4100**) that behaves like a real
Azerbaijani card gateway (Kapital Bank / Payriff / Epoint style): hosted payment page, 3-D Secure step,
signed webhooks, refunds and saved-card (recurring) charges. The API talks to it only through the
`PaymentProvider` interface (`apps/api/src/modules/payments/providers/`), so replacing it with a real
provider later means writing one new provider class — nothing else changes.

## Merchant authentication (every merchant API call AND every webhook)

| Header | Value |
|---|---|
| `X-Merchant-Id` | merchant id (default `evtap`) |
| `X-Timestamp` | unix time in **milliseconds** |
| `X-Signature` | lowercase hex `HMAC_SHA256(secret, "${timestamp}.${rawBody}")` — for GET requests `rawBody` is the empty string |

Requests with an unknown merchant, bad signature or a timestamp older than 5 minutes → `401 { error: "INVALID_SIGNATURE" }`.
Default merchant comes from env `MERCHANTS=evtap:evtap-mockbank-secret:EvTap` (`id:secret:displayName`, comma-separated for many).

## Order object

```jsonc
{
  "orderId": "ord_2b9f…",            // bank id
  "merchantOrderId": "uuid",          // our payments.id
  "amount": 1500,                     // minor units
  "currency": "AZN",                  // AZN | USD | EUR | GEL
  "description": "VIP (7 gün)",
  "status": "CREATED",                // CREATED | PROCESSING | APPROVED | DECLINED | CANCELLED | EXPIRED | REFUNDED | PARTIALLY_REFUNDED
  "refundedAmount": 0,
  "card": { "mask": "411111******1111", "brand": "VISA", "token": "tok_…" | null } | null,
  "declineCode": null,                // DO_NOT_HONOR | INSUFFICIENT_FUNDS | EXPIRED_CARD | PROCESSING_ERROR | 3DS_FAILED | TOKEN_INVALID
  "declineReason": null,              // human readable
  "rrn": "123456789012" | null,       // retrieval reference number
  "approvalCode": "A1B2C3" | null,
  "refunds": [{ "id": "rf_…", "amount": 500, "reason": "…", "createdAt": "…" }],
  "createdAt": "…", "updatedAt": "…", "paidAt": "…" | null, "expiresAt": "…"
}
```

## Merchant API (JSON)

| Method & path | Body | Response |
|---|---|---|
| `POST /api/v1/orders` | `{ amount, currency, merchantOrderId, description, language?: "az"\|"ru"\|"en", returnUrl, callbackUrl, saveCard?: boolean, customer?: { id?, phone?, email? } }` | `201 { orderId, status: "CREATED", paymentUrl, expiresAt }` — `paymentUrl = ${MOCKBANK_PUBLIC_URL}/checkout/${orderId}` |
| `POST /api/v1/orders/charge-token` | `{ amount, currency, merchantOrderId, description, cardToken, callbackUrl? }` | `200 Order` — synchronous merchant-initiated charge (subscription renewals). Status `APPROVED` or `DECLINED` |
| `GET /api/v1/orders/:orderId` | – | `200 Order` |
| `POST /api/v1/orders/:orderId/refund` | `{ amount?: number /* default = remaining */, reason?: string }` | `200 Order` (`REFUNDED` / `PARTIALLY_REFUNDED`); `409` if not refundable |
| `POST /api/v1/orders/:orderId/cancel` | – | `200 Order` (`CANCELLED`, only from `CREATED`) |
| `DELETE /api/v1/tokens/:cardToken` | – | `200 { ok: true }` |

Idempotency: `POST /orders` with an already used `merchantOrderId` returns the existing order (same `orderId`).

## Hosted checkout (browser)

1. `GET /checkout/:orderId` — merchant name, amount, description, card form (number, MM/YY, CVV, holder), *Save card* checkbox when `saveCard=true`, *Cancel* button. Shows a **test cards** table when `NODE_ENV != production`. Localised az/ru/en via `language`.
2. Client-side + server-side validation (Luhn, expiry in future, CVV 3 digits). Invalid input re-renders the form with errors (not a decline).
3. 3-D Secure page `GET /checkout/:orderId/3ds` (status `PROCESSING`) — enter OTP. **`111111`** = success. 3 wrong codes → `DECLINED / 3DS_FAILED`.
4. On final status the bank (a) POSTs the webhook, then (b) redirects the browser (`302`) to
   `returnUrl` + `?orderId=…&merchantOrderId=…&status=APPROVED|DECLINED|CANCELLED` (append with `&` if returnUrl already has a query).
5. Orders not paid within **30 min** become `EXPIRED` (webhook `order.expired`).

### Test cards (any future expiry, any CVV)

| Card | Result |
|---|---|
| `4111 1111 1111 1111` | Approved, frictionless (no 3DS) |
| `4242 4242 4242 4242` | Approved, frictionless |
| `5555 5555 5555 4444` | 3DS → approved |
| `4000 0000 0000 3220` | 3DS → approved |
| `4000 0000 0000 0002` | Declined `DO_NOT_HONOR` |
| `4000 0000 0000 9995` | Declined `INSUFFICIENT_FUNDS` |
| `4000 0000 0000 0069` | Declined `EXPIRED_CARD` |
| `4000 0000 0000 0119` | Declined `PROCESSING_ERROR` |
| any other Luhn-valid number | 3DS → approved |

Saved tokens can be switched to "insufficient funds" in the bank admin UI to test failed subscription renewals.

## Webhooks (bank → merchant)

`POST {callbackUrl}` with JSON `{ "event": "order.approved" | "order.declined" | "order.refunded" | "order.cancelled" | "order.expired", "order": Order }`
and the same `X-Merchant-Id` / `X-Timestamp` / `X-Signature` headers (signed with the merchant secret).
Merchant must answer 2xx. Otherwise retried 6 times with back-off (5 s, 30 s, 2 min, 10 min, 1 h, 6 h); every attempt is logged and visible in the bank admin, which also has a *Resend webhook* button.

## Bank admin

`GET /admin` (HTTP basic auth, env `ADMIN_USER` / `ADMIN_PASSWORD`, default `admin` / `admin`):
orders list with filters, order detail (timeline, webhook deliveries, manual refund, resend webhook), saved tokens (toggle insufficient funds / delete), merchants.

## How EvTap API uses it

* `callbackUrl = ${API_INTERNAL_URL}/api/v1/payments/webhook/mockbank`
* `returnUrl   = ${API_PUBLIC_URL}/api/v1/payments/return/mockbank?paymentId=<payments.id>` — the API re-fetches the
  order, finalises the payment if the webhook has not arrived yet, then `302` → the client `returnUrl` (web
  `/payment/result`, mobile `evtap://payment/result`) with `?paymentId=…&status=SUCCEEDED|FAILED|CANCELLED`.
* Fulfilment is idempotent (`payments.fulfilled_at`) because webhook and return can race.
