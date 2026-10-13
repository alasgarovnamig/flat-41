import { createHmac } from 'node:crypto';
import { safeEqual } from '../../../common/util';
import {
  ChargeTokenInput, CreatedOrder, CreateOrderInput, HeaderBag, InvalidSignatureError, PaymentProvider, ProviderError, ProviderOrder,
  ProviderOrderStatus, WebhookEvent,
} from './payment-provider';

/** docs/MOCKBANK.md: requests / webhooks older (or further in the future) than this are rejected. */
export const MOCKBANK_MAX_SKEW_MS = 5 * 60_000;

export interface MockBankConfig { url: string; merchantId: string; secret: string; timeoutMs?: number }

/** Lowercase hex HMAC_SHA256(secret, `${timestamp}.${rawBody}`) — docs/MOCKBANK.md "Merchant authentication". */
export const signMockbank = (secret: string, timestamp: string, rawBody: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

const header = (h: HeaderBag, name: string) => {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** Verifies X-Merchant-Id / X-Timestamp / X-Signature. Throws InvalidSignatureError. Pure — exported for tests. */
export const verifyMockbankSignature = (cfg: Pick<MockBankConfig, 'merchantId' | 'secret'>, headers: HeaderBag, rawBody: string, now = Date.now()) => {
  const merchantId = header(headers, 'x-merchant-id');
  const timestamp = header(headers, 'x-timestamp');
  const signature = header(headers, 'x-signature');
  if (!merchantId || !timestamp || !signature) throw new InvalidSignatureError('Missing signature headers');
  if (merchantId !== cfg.merchantId) throw new InvalidSignatureError('Unknown merchant');
  const ts = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isFinite(ts) || Math.abs(now - ts) > MOCKBANK_MAX_SKEW_MS) throw new InvalidSignatureError('Stale timestamp');
  if (!safeEqual(signature.toLowerCase(), signMockbank(cfg.secret, timestamp, rawBody))) throw new InvalidSignatureError('Bad signature');
};

const STATUSES: ProviderOrderStatus[] = ['CREATED', 'PROCESSING', 'APPROVED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

/** Maps a MockBank Order JSON onto ProviderOrder. */
export const parseMockbankOrder = (o: Record<string, any>): ProviderOrder => {
  if (!o || typeof o.orderId !== 'string' || typeof o.merchantOrderId !== 'string' || !STATUSES.includes(o.status)) {
    throw new ProviderError('Malformed order from mockbank', undefined, o);
  }
  return {
    orderId: o.orderId,
    merchantOrderId: o.merchantOrderId,
    amount: Number(o.amount),
    currency: String(o.currency ?? 'AZN'),
    status: o.status,
    refundedAmount: Number(o.refundedAmount ?? 0),
    card: o.card ? { mask: o.card.mask ?? null, brand: o.card.brand ?? null, token: o.card.token ?? null } : null,
    declineCode: o.declineCode ?? null,
    declineReason: o.declineReason ?? null,
    rrn: o.rrn ?? null,
    approvalCode: o.approvalCode ?? null,
    paidAt: o.paidAt ?? null,
    raw: o,
  };
};

/** apps/mockbank client — see docs/MOCKBANK.md. */
export class MockBankProvider implements PaymentProvider {
  readonly name = 'mockbank';
  constructor(private readonly cfg: MockBankConfig) {}

  private async request<T = Record<string, any>>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    // GET / DELETE: signed over the empty string. POST: signed over the exact JSON we send.
    const raw = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    const timestamp = Date.now().toString();
    let res: Response;
    try {
      res = await fetch(`${this.cfg.url.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json',
          'X-Merchant-Id': this.cfg.merchantId,
          'X-Timestamp': timestamp,
          'X-Signature': signMockbank(this.cfg.secret, timestamp, raw),
        },
        body: method === 'POST' ? raw : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch (e) {
      throw new ProviderError(`mockbank ${method} ${path} unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) throw new ProviderError(`mockbank ${method} ${path} → ${res.status}`, res.status, json);
    return json as T;
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const r = await this.request('POST', '/api/v1/orders', input);
    if (!r?.orderId || !r?.paymentUrl) throw new ProviderError('Malformed createOrder response', undefined, r);
    return { orderId: r.orderId, status: r.status ?? 'CREATED', paymentUrl: r.paymentUrl, expiresAt: r.expiresAt ?? null };
  }

  async getOrder(orderId: string) {
    return parseMockbankOrder(await this.request('GET', `/api/v1/orders/${encodeURIComponent(orderId)}`));
  }

  async refund(orderId: string, amount?: number, reason?: string) {
    return parseMockbankOrder(await this.request('POST', `/api/v1/orders/${encodeURIComponent(orderId)}/refund`, { ...(amount ? { amount } : {}), ...(reason ? { reason } : {}) }));
  }

  async chargeToken(input: ChargeTokenInput) {
    return parseMockbankOrder(await this.request('POST', '/api/v1/orders/charge-token', input));
  }

  async cancel(orderId: string) {
    return parseMockbankOrder(await this.request('POST', `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {}));
  }

  async deleteToken(cardToken: string) {
    await this.request('DELETE', `/api/v1/tokens/${encodeURIComponent(cardToken)}`);
  }

  verifyWebhook(headers: HeaderBag, rawBody: Buffer | string): WebhookEvent {
    const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    verifyMockbankSignature(this.cfg, headers, raw);
    let body: Record<string, any>;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InvalidSignatureError('Malformed webhook body');
    }
    if (typeof body?.event !== 'string' || !body.order) throw new ProviderError('Malformed webhook payload', undefined, body);
    return { event: body.event, order: parseMockbankOrder(body.order) };
  }
}
