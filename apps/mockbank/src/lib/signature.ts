import { createHmac, timingSafeEqual } from 'node:crypto';

export const HEADER_MERCHANT = 'x-merchant-id';
export const HEADER_TIMESTAMP = 'x-timestamp';
export const HEADER_SIGNATURE = 'x-signature';

/** Lowercase hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`) — see docs/MOCKBANK.md. */
export function sign(secret: string, timestamp: string | number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function signatureMatches(expectedHex: string, providedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(providedHex.toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Headers for an outgoing signed request (webhooks, or a merchant client in tests). */
export function signedHeaders(merchantId: string, secret: string, rawBody: string, now = Date.now()): Record<string, string> {
  const ts = String(now);
  return {
    'X-Merchant-Id': merchantId,
    'X-Timestamp': ts,
    'X-Signature': sign(secret, ts, rawBody),
  };
}
