import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer, type RunningServer } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createPool } from '../src/db';
import { signedHeaders } from '../src/lib/signature';

const BASE_DB = process.env.TEST_DATABASE_URL ?? 'postgres://evtap:evtap@localhost:5432/mockbank_dev';
/** Each test process works in its own schema, so nothing else using mockbank_dev can interfere. */
const TEST_SCHEMA = `mockbank_test_${process.pid}`;
export const TEST_DB = `${BASE_DB}${BASE_DB.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${TEST_SCHEMA}`)}`;
export const MERCHANT_ID = 'evtap';
export const MERCHANT_SECRET = 'test-secret';

let cleanupRegistered = false;
function registerSchemaCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  let done = false;
  process.on('beforeExit', () => {
    if (done) return;
    done = true;
    const pool = createPool(BASE_DB);
    void pool
      .query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`)
      .catch(() => undefined)
      .finally(() => pool.end());
  });
}

export async function startTestServer(overrides: Partial<Config> = {}, opts: { keepData?: boolean } = {}): Promise<RunningServer> {
  registerSchemaCleanup();
  const db = createPool(TEST_DB);
  if (!opts.keepData) {
    await db.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await db.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
  }
  const config = loadConfig(
    { NODE_ENV: 'test' },
    {
      port: 0,
      databaseUrl: TEST_DB,
      merchants: [
        { id: MERCHANT_ID, secret: MERCHANT_SECRET, name: 'EvTap' },
        { id: 'other', secret: 'other-secret', name: 'Other Shop' },
      ],
      webhookRetryScale: 0.001,
      webhookTimeoutMs: 2_000,
      schedulerIntervalMs: 40,
      logLevel: (process.env.LOG_LEVEL as Config['logLevel']) ?? 'silent',
      ...overrides,
    },
  );
  const running = await startServer(config, { db });
  running.services.config.publicUrl = running.url;
  return running;
}

export interface ApiResult<T = any> {
  status: number;
  json: T;
}

/** Signed merchant API call. */
export async function api<T = any>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  opts: { merchantId?: string; secret?: string; timestamp?: number; tamper?: boolean } = {},
): Promise<ApiResult<T>> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers = signedHeaders(opts.merchantId ?? MERCHANT_ID, opts.secret ?? MERCHANT_SECRET, raw, opts.timestamp ?? Date.now());
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { ...headers, ...(raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? (opts.tamper ? raw.replace(/\d/, '9') : raw) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

export interface ReceivedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  json: any;
}

export interface Receiver {
  url: string;
  requests: ReceivedRequest[];
  /** Decide the HTTP status for each incoming request (default 200). */
  respond: (req: ReceivedRequest, index: number) => number;
  close(): Promise<void>;
}

/** Local HTTP server standing in for the merchant's webhook endpoint. */
export async function startReceiver(): Promise<Receiver> {
  const receiver: Receiver = {
    url: '',
    requests: [],
    respond: () => 200,
    close: async () => undefined,
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json: unknown = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* not json */
      }
      const entry: ReceivedRequest = { path: req.url ?? '', headers: req.headers, body, json };
      const index = receiver.requests.push(entry) - 1;
      const status = receiver.respond(entry, index);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: status < 300 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  receiver.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
  receiver.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return receiver;
}

export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 5_000, label = 'condition'): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export function orderBody(receiver: Receiver | null, extra: Record<string, unknown> = {}) {
  return {
    amount: 1500,
    currency: 'AZN',
    merchantOrderId: crypto.randomUUID(),
    description: 'VIP (7 gün)',
    language: 'en',
    returnUrl: 'https://evtap.test/api/v1/payments/return/mockbank?paymentId=p1',
    callbackUrl: receiver?.url ?? 'http://127.0.0.1:9/never',
    ...extra,
  };
}

export async function createOrder(base: string, receiver: Receiver | null, extra: Record<string, unknown> = {}) {
  const res = await api(base, 'POST', '/orders', orderBody(receiver, extra));
  if (res.status !== 201) throw new Error(`create order failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json as { orderId: string; status: string; paymentUrl: string; expiresAt: string };
}

export function extractNonce(html: string): string {
  const m = html.match(/name="nonce" value="([^"]+)"/);
  if (!m) throw new Error('nonce not found in page');
  return m[1]!;
}

export interface PageResult {
  status: number;
  location: string | null;
  html: string;
}

export async function getPage(url: string, init: RequestInit = {}): Promise<PageResult> {
  const res = await fetch(url, { redirect: 'manual', ...init });
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

export async function postForm(url: string, fields: Record<string, string>): Promise<PageResult> {
  return getPage(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

export function futureExpiry(): string {
  return `12/${String((new Date().getFullYear() + 2) % 100).padStart(2, '0')}`;
}

/** Opens the hosted page and submits the card form. */
export async function submitCard(
  base: string,
  orderId: string,
  card: string,
  extra: Record<string, string> = {},
): Promise<PageResult> {
  const page = await getPage(`${base}/checkout/${orderId}`);
  if (page.status !== 200) throw new Error(`checkout page status ${page.status}`);
  return postForm(`${base}/checkout/${orderId}/pay`, {
    nonce: extractNonce(page.html),
    number: card,
    expiry: futureExpiry(),
    cvv: '123',
    holder: 'Test Cardholder',
    ...extra,
  });
}

export async function submitOtp(base: string, orderId: string, otp: string): Promise<PageResult> {
  const page = await getPage(`${base}/checkout/${orderId}/3ds`);
  if (page.status !== 200) throw new Error(`3ds page status ${page.status}`);
  return postForm(`${base}/checkout/${orderId}/3ds`, { nonce: extractNonce(page.html), otp });
}

export const adminAuth = (user = 'admin', password = 'admin') => ({
  Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
});
