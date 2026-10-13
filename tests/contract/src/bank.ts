/**
 * Drives the mock bank's hosted checkout like a browser would: GET the payment page, fill the card form (hidden nonce
 * included), answer the 3-D Secure step, follow every redirect by hand (cookies kept) through the bank's
 * `/checkout/:id/return` → the API's `/payments/return/mockbank` → the client `returnUrl?paymentId=..&status=..`.
 * Only the documented HTML form field names are relied on (docs/MOCKBANK.md): number, expiry, cvv, holder, saveCard, otp.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { API_URL, BANK_URL, MOCKBANK_MERCHANT_ID, MOCKBANK_SECRET } from './config';
import { record } from './coverage';

export const CARDS = {
  frictionless: '4111111111111111',
  frictionless2: '4242424242424242',
  threeDs: '5555555555554444',
  threeDs2: '4000000000003220',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
} as const;

interface Form { action: string; method: string; fields: Record<string, string> }

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : undefined;
};

/** All <form>s of a page with their default field values. */
export function parseForms(html: string, base: string): Form[] {
  const forms: Form[] = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (let m; (m = re.exec(html)); ) {
    const fields: Record<string, string> = {};
    for (const input of m[2].match(/<input\b[^>]*>/gi) ?? []) {
      const name = attr(input, 'name');
      if (!name) continue;
      const type = (attr(input, 'type') ?? 'text').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/i.test(input)) continue;
      fields[name] = attr(input, 'value') ?? (type === 'checkbox' ? 'on' : '');
    }
    forms.push({ action: new URL(attr(m[1], 'action') ?? '', base).toString(), method: (attr(m[1], 'method') ?? 'get').toUpperCase(), fields });
  }
  return forms;
}

class Browser {
  private cookies = new Map<string, string>();
  readonly trail: string[] = [];

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method: string, url: string, form?: Record<string, string>) {
    this.trail.push(`${method} ${url}`);
    const headers: Record<string, string> = { Accept: 'text/html,application/json' };
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    let body: string | undefined;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    if (url.startsWith(API_URL)) {
      const u = new URL(url);
      record(method, u.pathname.replace(/^\/api\/v1/, ''), res.status);
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, url };
  }
}

export interface CardPaymentResult {
  /** Final client URL the API redirected to (e.g. evtap://payment/result?paymentId=..&status=SUCCEEDED). */
  clientUrl: string;
  status: string | null;
  paymentId: string | null;
  trail: string[];
}

const isHttp = (u: string) => /^https?:\/\//i.test(u);
const leftOurServers = (u: string) => !isHttp(u) || !(u.startsWith(API_URL) || u.startsWith(BANK_URL));

/**
 * Pays (or cancels) a hosted checkout. `card` = test card number; `otp` answers 3DS; `action: 'cancel'` presses Cancel.
 */
export async function payByCard(
  paymentUrl: string,
  opts: { card?: string; otp?: string; saveCard?: boolean; action?: 'pay' | 'cancel'; maxSteps?: number } = {},
): Promise<CardPaymentResult> {
  const card = opts.card ?? CARDS.frictionless;
  const b = new Browser();
  let method = 'GET';
  let url = paymentUrl;
  let form: Record<string, string> | undefined;
  let submittedCard = false;
  let submittedOtp = false;
  for (let step = 0; step < (opts.maxSteps ?? 25); step++) {
    const res = await b.request(method, url, form);
    method = 'GET';
    form = undefined;
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, url).toString();
      if (leftOurServers(next)) {
        const u = new URL(next);
        return { clientUrl: next, status: u.searchParams.get('status'), paymentId: u.searchParams.get('paymentId'), trail: b.trail };
      }
      url = next;
      continue;
    }
    assert.ok(res.status < 500, `bank/API error ${res.status} at ${url}: ${res.text.slice(0, 300)}`);
    const forms = parseForms(res.text, url);
    const cardForm = forms.find((f) => 'number' in f.fields);
    const otpForm = forms.find((f) => 'otp' in f.fields);
    if (cardForm && !submittedCard) {
      submittedCard = true;
      if (opts.action === 'cancel') {
        const cancel = forms.find((f) => f !== cardForm && /cancel/i.test(f.action));
        assert.ok(cancel, 'cancel form not found on the payment page');
        [method, url, form] = [cancel.method, cancel.action, cancel.fields];
        continue;
      }
      const fields: Record<string, string> = { ...cardForm.fields, number: card, expiry: '12/30', cvv: '123', holder: 'CONTRACT TEST' };
      if (opts.saveCard === false) delete fields.saveCard;
      else if (opts.saveCard) fields.saveCard = '1';
      [method, url, form] = [cardForm.method, cardForm.action, fields];
      continue;
    }
    if (otpForm && !submittedOtp) {
      submittedOtp = true;
      [method, url, form] = [otpForm.method, otpForm.action, { ...otpForm.fields, otp: opts.otp ?? '111111' }];
      continue;
    }
    // Result page: follow the "back to merchant" link / meta refresh, else the documented /checkout/:id/return.
    const refresh = /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)/i.exec(res.text)?.[1];
    const link = /href=["']([^"']*\/return[^"']*)["']/i.exec(res.text)?.[1];
    const target = refresh ?? link;
    if (target) {
      url = new URL(decode(target), url).toString();
      continue;
    }
    const orderId = /\/checkout\/([^/?#]+)/.exec(paymentUrl)?.[1];
    assert.ok(orderId && !url.endsWith('/return'), `stuck on bank page ${url}: ${res.text.slice(0, 300)}`);
    url = `${BANK_URL}/checkout/${orderId}/return`;
  }
  assert.fail(`hosted checkout did not finish; trail:\n${b.trail.join('\n')}`);
}

// ───────────── merchant API (signed) — only used to replay a genuine webhook ─────────────

export const signBank = (timestamp: string, rawBody: string, secret = MOCKBANK_SECRET) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

export const bankHeaders = (rawBody: string, secret = MOCKBANK_SECRET) => {
  const ts = String(Date.now());
  return { 'X-Merchant-Id': MOCKBANK_MERCHANT_ID, 'X-Timestamp': ts, 'X-Signature': signBank(ts, rawBody, secret) };
};

/** GET /api/v1/orders/:orderId on the bank (signed merchant call). */
export async function bankOrder(orderId: string) {
  const res = await fetch(`${BANK_URL}/api/v1/orders/${orderId}`, { headers: bankHeaders('') });
  assert.equal(res.status, 200, `bank order lookup failed: ${res.status}`);
  return (await res.json()) as Record<string, any>;
}
