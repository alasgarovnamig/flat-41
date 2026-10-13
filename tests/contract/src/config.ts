/**
 * Suite configuration — everything comes from the environment so the same tests run against any backend
 * (NestJS today, Go tomorrow). See README.md.
 */
const trim = (u: string) => u.replace(/\/+$/, '');

export const API_URL = trim(process.env.API_URL ?? 'http://localhost:4000');
export const API_BASE = `${API_URL}/api/v1`;
export const BANK_URL = trim(process.env.BANK_URL ?? 'http://localhost:4100');
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@evtap.az';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin12345!';
export const OTP_CODE = process.env.OTP_CODE ?? '111111';
/** Only for the few tests that must fast-forward time (booking completion, subscription end). */
export const DATABASE_URL = process.env.DATABASE_URL || '';
/** Merchant secret shared by the API and the mock bank — used to sign a webhook replay. */
export const MOCKBANK_MERCHANT_ID = process.env.MOCKBANK_MERCHANT_ID ?? 'evtap';
export const MOCKBANK_SECRET = process.env.MOCKBANK_SECRET ?? 'evtap-mockbank-secret';
export const SKIP_V2 = ['1', 'true', 'yes'].includes(String(process.env.SKIP_V2 ?? '').toLowerCase());
/** Return URL clients pass to /checkout (mobile deep link — always allowed by the contract). */
export const CLIENT_RETURN_URL = process.env.CLIENT_RETURN_URL ?? 'evtap://payment/result';
/** How long to wait for asynchronous effects (webhooks, realtime frames). */
export const ASYNC_TIMEOUT_MS = Number(process.env.ASYNC_TIMEOUT_MS ?? 8000);

/** `test(name, v2, fn)` — tests of contract additions not yet implemented by every backend. */
export const v2 = { skip: SKIP_V2 ? 'v2 contract test (SKIP_V2=1)' : false } as const;

/** Mock bank reachability, probed once per test file (top-level await in test modules). */
let bankProbe: Promise<boolean> | undefined;
export const bankReachable = () =>
  (bankProbe ??= fetch(`${BANK_URL}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false));

export const bankOpts = async () => ((await bankReachable()) ? {} : { skip: `mock bank not reachable at ${BANK_URL}` });
export const dbOpts = { skip: DATABASE_URL ? false : 'DATABASE_URL not set (time fast-forward needs DB access)' } as const;
