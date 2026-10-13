/**
 * TEST-ONLY fake acquirer implementing the docs/MOCKBANK.md merchant contract (the real apps/mockbank is built
 * separately). Auto-pays instead of rendering a card form:
 *
 *   GET /checkout/:orderId?card=4111111111111111[&save=0][&webhook=0][&action=cancel]
 *     → decides by test card, POSTs the signed webhook (unless webhook=0), then 302 → returnUrl?orderId&merchantOrderId&status
 *
 * Test controls: POST /__test/tokens/:token/insufficient {"value":true}, POST /__test/orders/:id/expire, GET /__test/orders.
 * Run standalone: `node -r ts-node/register/transpile-only test/fake-bank.ts` (PORT=4199, MERCHANTS=evtap:evtap-mockbank-secret).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

type Status = 'CREATED' | 'PROCESSING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
interface Order {
  orderId: string; merchantOrderId: string; amount: number; currency: string; description: string; status: Status; refundedAmount: number;
  card: { mask: string; brand: string; token: string | null } | null; declineCode: string | null; declineReason: string | null;
  rrn: string | null; approvalCode: string | null; refunds: { id: string; amount: number; reason: string; createdAt: string }[];
  createdAt: string; updatedAt: string; paidAt: string | null; expiresAt: string;
}
interface Meta { merchantId: string; returnUrl?: string; callbackUrl?: string; saveCard?: boolean }

const DECLINES: Record<string, [string, string]> = {
  '4000000000000002': ['DO_NOT_HONOR', 'Do not honor'],
  '4000000000009995': ['INSUFFICIENT_FUNDS', 'Insufficient funds'],
  '4000000000000069': ['EXPIRED_CARD', 'Expired card'],
  '4000000000000119': ['PROCESSING_ERROR', 'Processing error'],
};

const id = (p: string) => `${p}_${randomBytes(8).toString('hex')}`;
const sign = (secret: string, ts: string, raw: string) => createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
const publicOrder = (o: Order) => ({ ...o });

export interface FakeBankOptions { port?: number; merchants?: Record<string, string>; publicUrl?: string; log?: boolean }

export function startFakeBank(opts: FakeBankOptions = {}) {
  const port = opts.port ?? 4199;
  const merchants = opts.merchants ?? { evtap: 'evtap-mockbank-secret' };
  let publicUrl = opts.publicUrl ?? `http://localhost:${port}`;
  const orders = new Map<string, Order>();
  const meta = new Map<string, Meta>();
  const byMerchantOrder = new Map<string, string>();
  const tokens = new Map<string, { mask: string; brand: string; insufficient: boolean }>();
  const webhooks: { orderId: string; event: string; status: number | string }[] = [];
  const log = (...a: unknown[]) => opts.log && console.log('[fake-bank]', ...a);

  const touch = (o: Order) => (o.updatedAt = new Date().toISOString());

  async function sendWebhook(o: Order, event: string) {
    const m = meta.get(o.orderId);
    if (!m?.callbackUrl) return;
    const raw = JSON.stringify({ event, order: publicOrder(o) });
    const ts = Date.now().toString();
    try {
      const r = await fetch(m.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': m.merchantId, 'X-Timestamp': ts, 'X-Signature': sign(merchants[m.merchantId], ts, raw) },
        body: raw,
      });
      webhooks.push({ orderId: o.orderId, event, status: r.status });
      log('webhook', event, o.orderId, r.status);
    } catch (e) {
      webhooks.push({ orderId: o.orderId, event, status: (e as Error).message });
    }
  }

  function settle(o: Order, card: string, save: boolean) {
    const decline = DECLINES[card];
    const brand = card.startsWith('5') ? 'MASTERCARD' : 'VISA';
    const mask = `${card.slice(0, 6)}******${card.slice(-4)}`;
    if (decline) {
      Object.assign(o, { status: 'DECLINED', declineCode: decline[0], declineReason: decline[1], card: { mask, brand, token: null } });
    } else {
      let token: string | null = null;
      if (save) {
        token = id('tok');
        tokens.set(token, { mask, brand, insufficient: false });
      }
      Object.assign(o, { status: 'APPROVED', card: { mask, brand, token }, rrn: String(Date.now()).slice(-12), approvalCode: randomBytes(3).toString('hex').toUpperCase(), paidAt: new Date().toISOString() });
    }
    touch(o);
  }

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', publicUrl);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      // ── test-only controls ──
      if (parts[0] === '__test') {
        if (req.method === 'GET' && parts[1] === 'orders') return send(200, { orders: [...orders.values()], webhooks, tokens: Object.fromEntries(tokens) });
        if (req.method === 'POST' && parts[1] === 'tokens' && parts[3] === 'insufficient') {
          const t = tokens.get(parts[2]);
          if (!t) return send(404, { error: 'NOT_FOUND' });
          t.insufficient = raw ? JSON.parse(raw).value !== false : true;
          return send(200, { ok: true });
        }
        if (req.method === 'POST' && parts[1] === 'orders' && parts[3] === 'expire') {
          const o = orders.get(parts[2]);
          if (!o) return send(404, { error: 'NOT_FOUND' });
          o.status = 'EXPIRED';
          touch(o);
          await sendWebhook(o, 'order.expired');
          return send(200, o);
        }
      }

      // ── hosted checkout (auto-pay) ──
      if (req.method === 'GET' && parts[0] === 'checkout' && parts[1]) {
        const o = orders.get(parts[1]);
        const m = o && meta.get(o.orderId);
        if (!o || !m) return send(404, { error: 'NOT_FOUND' });
        if (o.status === 'CREATED') {
          if (url.searchParams.get('action') === 'cancel') {
            o.status = 'CANCELLED';
            touch(o);
          } else {
            settle(o, (url.searchParams.get('card') ?? '4111111111111111').replace(/\s/g, ''), !!m.saveCard && url.searchParams.get('save') !== '0');
          }
          if (url.searchParams.get('webhook') !== '0') await sendWebhook(o, `order.${o.status.toLowerCase()}`);
        }
        const ret = new URL(m.returnUrl!);
        ret.searchParams.set('orderId', o.orderId);
        ret.searchParams.set('merchantOrderId', o.merchantOrderId);
        ret.searchParams.set('status', o.status);
        res.writeHead(302, { Location: ret.toString() });
        return res.end();
      }

      // ── merchant API (signed) ──
      if (parts[0] === 'api' && parts[1] === 'v1') {
        const merchantId = req.headers['x-merchant-id'] as string | undefined;
        const ts = req.headers['x-timestamp'] as string | undefined;
        const sig = req.headers['x-signature'] as string | undefined;
        const secret = merchantId ? merchants[merchantId] : undefined;
        const expected = secret && ts ? sign(secret, ts, raw) : '';
        const fresh = ts && Math.abs(Date.now() - Number(ts)) <= 5 * 60_000;
        if (!secret || !sig || !fresh || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
          return send(401, { error: 'INVALID_SIGNATURE' });
        }
        const body = raw ? JSON.parse(raw) : {};
        const rest = parts.slice(2);

        if (req.method === 'POST' && rest.length === 1 && rest[0] === 'orders') {
          const existing = byMerchantOrder.get(`${merchantId}:${body.merchantOrderId}`);
          const o0 = existing ? orders.get(existing)! : null;
          if (o0) return send(201, { orderId: o0.orderId, status: o0.status, paymentUrl: `${publicUrl}/checkout/${o0.orderId}`, expiresAt: o0.expiresAt });
          if (!Number.isInteger(body.amount) || body.amount <= 0 || !body.merchantOrderId || !body.returnUrl || !body.callbackUrl) return send(400, { error: 'VALIDATION_ERROR' });
          const now = new Date();
          const o: Order = {
            orderId: id('ord'), merchantOrderId: body.merchantOrderId, amount: body.amount, currency: body.currency ?? 'AZN', description: body.description ?? '',
            status: 'CREATED', refundedAmount: 0, card: null, declineCode: null, declineReason: null, rrn: null, approvalCode: null, refunds: [],
            createdAt: now.toISOString(), updatedAt: now.toISOString(), paidAt: null, expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
          };
          orders.set(o.orderId, o);
          meta.set(o.orderId, { merchantId: merchantId!, returnUrl: body.returnUrl, callbackUrl: body.callbackUrl, saveCard: !!body.saveCard });
          byMerchantOrder.set(`${merchantId}:${o.merchantOrderId}`, o.orderId);
          log('order', o.orderId, o.amount, o.description);
          return send(201, { orderId: o.orderId, status: o.status, paymentUrl: `${publicUrl}/checkout/${o.orderId}`, expiresAt: o.expiresAt });
        }

        if (req.method === 'POST' && rest[0] === 'orders' && rest[1] === 'charge-token') {
          const t = tokens.get(body.cardToken);
          const now = new Date();
          const o: Order = {
            orderId: id('ord'), merchantOrderId: body.merchantOrderId, amount: body.amount, currency: body.currency ?? 'AZN', description: body.description ?? '',
            status: 'APPROVED', refundedAmount: 0, card: t ? { mask: t.mask, brand: t.brand, token: body.cardToken } : null, declineCode: null, declineReason: null,
            rrn: null, approvalCode: null, refunds: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), paidAt: null, expiresAt: now.toISOString(),
          };
          if (!t) Object.assign(o, { status: 'DECLINED', declineCode: 'TOKEN_INVALID', declineReason: 'Unknown card token' });
          else if (t.insufficient) Object.assign(o, { status: 'DECLINED', declineCode: 'INSUFFICIENT_FUNDS', declineReason: 'Insufficient funds' });
          else Object.assign(o, { paidAt: now.toISOString(), rrn: String(Date.now()).slice(-12), approvalCode: 'TK0001' });
          orders.set(o.orderId, o);
          meta.set(o.orderId, { merchantId: merchantId!, callbackUrl: body.callbackUrl });
          byMerchantOrder.set(`${merchantId}:${o.merchantOrderId}`, o.orderId);
          return send(200, o);
        }

        if (rest[0] === 'orders' && rest[1]) {
          const o = orders.get(rest[1]);
          if (!o || meta.get(o.orderId)?.merchantId !== merchantId) return send(404, { error: 'NOT_FOUND' });
          if (req.method === 'GET' && rest.length === 2) return send(200, o);
          if (req.method === 'POST' && rest[2] === 'refund') {
            const remaining = o.amount - o.refundedAmount;
            const amount = body.amount ?? remaining;
            if (!['APPROVED', 'PARTIALLY_REFUNDED'].includes(o.status) || amount <= 0 || amount > remaining) return send(409, { error: 'NOT_REFUNDABLE' });
            o.refundedAmount += amount;
            o.refunds.push({ id: id('rf'), amount, reason: body.reason ?? '', createdAt: new Date().toISOString() });
            o.status = o.refundedAmount >= o.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            touch(o);
            void sendWebhook(o, 'order.refunded');
            return send(200, o);
          }
          if (req.method === 'POST' && rest[2] === 'cancel') {
            if (o.status !== 'CREATED') return send(409, { error: 'NOT_CANCELLABLE' });
            o.status = 'CANCELLED';
            touch(o);
            void sendWebhook(o, 'order.cancelled');
            return send(200, o);
          }
        }

        if (req.method === 'DELETE' && rest[0] === 'tokens' && rest[1]) {
          tokens.delete(rest[1]);
          return send(200, { ok: true });
        }
      }
      send(404, { error: 'NOT_FOUND' });
    } catch (e) {
      send(500, { error: (e as Error).message });
    }
  });

  const ready = new Promise<void>((resolve) =>
    server.listen(port, () => {
      // port 0 → ephemeral port chosen by the OS
      if (!opts.publicUrl) publicUrl = `http://localhost:${(server.address() as { port: number }).port}`;
      resolve();
    }),
  );
  return {
    ready, orders, tokens, webhooks,
    get url() {
      return publicUrl;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (require.main === module) {
  const merchants = Object.fromEntries((process.env.MERCHANTS ?? 'evtap:evtap-mockbank-secret').split(',').map((m) => m.split(':').slice(0, 2) as [string, string]));
  const port = Number(process.env.PORT ?? 4199);
  const bank = startFakeBank({ port, merchants, log: true });
  bank.ready.then(() => console.log(`[fake-bank] listening on ${bank.url}`));
}
