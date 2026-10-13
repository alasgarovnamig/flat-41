/**
 * Minimal HTTP client for the contract: JSON in/out, Bearer auth, a per-client fake client IP
 * (`X-Forwarded-For` — the API trusts one proxy hop and throttles OTP / login per IP), coverage recording.
 */
import { randomInt } from 'node:crypto';
import { API_BASE } from './config';
import { record } from './coverage';

export interface Res<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export interface CallOpts {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | (string | number)[]>;
  form?: FormData;
  headers?: Record<string, string>;
  /** Send the Bearer token (default true when the client has one). */
  auth?: boolean;
  redirect?: RequestRedirect;
}

export const randomIp = () => `10.${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

export function buildQuery(q: CallOpts['query']) {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export class Api {
  token?: string;
  refreshToken?: string;
  /** Logged-in user (AuthResponse.user). */
  user?: any;
  phone?: string;
  email?: string;
  password?: string;
  readonly ip: string;

  constructor(opts: { token?: string; ip?: string } = {}) {
    this.token = opts.token;
    this.ip = opts.ip ?? randomIp();
  }

  get id(): string {
    if (!this.user?.id) throw new Error('client is not logged in');
    return this.user.id;
  }

  /** Same client identity (IP) but without credentials. */
  anon() {
    return new Api({ ip: this.ip });
  }

  async call<T = any>(method: string, path: string, opts: CallOpts = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { 'X-Forwarded-For': this.ip, Accept: 'application/json', ...opts.headers };
    if (this.token && opts.auth !== false) headers.Authorization = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const url = API_BASE + path + buildQuery(opts.query);
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, redirect: opts.redirect ?? 'manual' });
    } catch (e) {
      throw new Error(`${method} ${url} failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    let parsed: unknown = text;
    if (text.length && (res.headers.get('content-type') ?? '').includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else if (!text.length) parsed = undefined;
    record(method, path.split('?')[0], res.status);
    return { status: res.status, body: parsed as T, text, headers: res.headers };
  }

  get<T = any>(path: string, opts?: CallOpts) {
    return this.call<T>('GET', path, opts);
  }
  post<T = any>(path: string, body?: unknown, opts: CallOpts = {}) {
    return this.call<T>('POST', path, { ...opts, body });
  }
  patch<T = any>(path: string, body?: unknown, opts: CallOpts = {}) {
    return this.call<T>('PATCH', path, { ...opts, body });
  }
  put<T = any>(path: string, body?: unknown, opts: CallOpts = {}) {
    return this.call<T>('PUT', path, { ...opts, body });
  }
  del<T = any>(path: string, opts?: CallOpts) {
    return this.call<T>('DELETE', path, opts);
  }
}

/** Anonymous client with its own fake IP. */
export const anon = () => new Api();
