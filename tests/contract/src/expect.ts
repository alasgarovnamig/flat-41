/** Assertion helpers shared by every contract test. */
import assert from 'node:assert/strict';
import type { z } from 'zod';
import { ERROR_CODES } from '@evtap/shared';
import { ApiError } from './dto';
import type { Res } from './http';

const show = (res: Res) => `HTTP ${res.status}: ${res.text.slice(0, 600)}`;

/** Validates `value` against a DTO schema; fails with a readable list of mismatches. */
export function shape<S extends z.ZodTypeAny>(schema: S, value: unknown, label = 'response'): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 15).map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    assert.fail(`${label} does not match the contract DTO:\n${issues}\nvalue: ${JSON.stringify(value)?.slice(0, 800)}`);
  }
  return r.data;
}

/**
 * Asserts a successful (2xx) response and, when given, the DTO shape. Returns the parsed body.
 * `status` pins an exact status code (e.g. 302 for redirects).
 */
export function ok<S extends z.ZodTypeAny = z.ZodAny>(res: Res, schema?: S, status?: number): z.output<S> {
  if (status !== undefined) assert.equal(res.status, status, show(res));
  else assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${show(res)}`);
  return schema ? shape(schema, res.body) : res.body;
}

/** `{ ok: true }` responses. */
export function okTrue(res: Res) {
  ok(res);
  assert.deepEqual(res.body, { ok: true }, show(res));
}

/**
 * Asserts an ApiError: exact HTTP status, `{ statusCode, message, code? }` shape, `statusCode` equals the HTTP status
 * and `code` (when present) is one of ERROR_CODES. `code` pins the expected machine-readable code.
 */
export function err(res: Res, status: number, code?: string | string[]) {
  assert.equal(res.status, status, `expected ${status}${code ? ` ${code}` : ''}, got ${show(res)}`);
  const body = shape(ApiError, res.body, `error body (${status})`);
  assert.equal(body.statusCode, status, 'ApiError.statusCode must equal the HTTP status');
  if (body.code !== undefined) {
    assert.ok((ERROR_CODES as readonly string[]).includes(body.code), `ApiError.code "${body.code}" is not in ERROR_CODES (${show(res)})`);
  }
  if (code !== undefined) {
    const codes = Array.isArray(code) ? code : [code];
    assert.ok(body.code !== undefined && codes.includes(body.code), `expected code ${codes.join('|')}, got ${show(res)}`);
  }
  return body;
}

export const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Polls `fn` until it returns a truthy value (asynchronous effects: webhooks, crons kicked by events). */
export async function eventually<T>(fn: () => Promise<T | undefined | null | false>, what: string, ms = 8000, every = 200): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
    await new Promise((r) => setTimeout(r, every));
  }
}
