import { randomBytes, randomInt } from 'node:crypto';
import type { Currency } from './types';

export const newId = (prefix: string, bytes = 12) => `${prefix}_${randomBytes(bytes).toString('hex')}`;

export const newNonce = () => randomBytes(18).toString('base64url');

/** 12-digit retrieval reference number. */
export function newRrn(): string {
  let s = String(randomInt(1, 10));
  for (let i = 0; i < 11; i++) s += String(randomInt(0, 10));
  return s;
}

/** 6-char issuer approval code, e.g. "A1B2C3". */
export function newApprovalCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[randomInt(0, alphabet.length)];
  return s;
}

const SYMBOLS: Record<Currency, { symbol: string; before: boolean }> = {
  AZN: { symbol: '₼', before: false },
  USD: { symbol: '$', before: true },
  EUR: { symbol: '€', before: true },
  GEL: { symbol: '₾', before: false },
};

/** Formats minor units: 1500 AZN → "15.00 ₼", 1500 USD → "$15.00". */
export function formatMoney(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const s = SYMBOLS[currency as Currency];
  if (!s) return `${major} ${currency}`;
  return s.before ? `${s.symbol}${major}` : `${major} ${s.symbol}`;
}

/** Parses a major-unit string such as "5", "5.5" or "5,50" into minor units. */
export function parseMajorAmount(value: string): number | null {
  const m = value.trim().replace(',', '.').match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);

/**
 * http(s) URL, or — for the browser return URL only — a custom app scheme (evtap://…).
 */
export function isValidUrl(value: unknown, opts: { allowAppScheme?: boolean } = {}): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return Boolean(url.hostname);
  return Boolean(opts.allowAppScheme) && !FORBIDDEN_SCHEMES.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** Appends query params to a URL string, using `&` when it already has a query (fragment preserved). */
export function appendQuery(url: string, params: Record<string, string>): string {
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const qs = new URLSearchParams(params).toString();
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}${qs}${hash}`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
