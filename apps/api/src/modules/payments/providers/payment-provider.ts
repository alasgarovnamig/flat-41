/**
 * Card acquirer abstraction. The rest of the API only talks to a `PaymentProvider`, so plugging in a real
 * Azerbaijani gateway (Kapital Bank, Payriff, Epoint…) means writing one class that implements this interface
 * and registering it in `providers/index.ts` — routes are generic (`/payments/webhook/:provider`).
 */

/** Normalised order status (MockBank vocabulary; real providers map theirs onto it). */
export type ProviderOrderStatus =
  | 'CREATED' | 'PROCESSING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

/** Statuses meaning "the money was captured" (possibly refunded afterwards). */
export const PAID_STATUSES: ProviderOrderStatus[] = ['APPROVED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
/** Final statuses meaning "no money was captured". */
export const UNPAID_FINAL_STATUSES: ProviderOrderStatus[] = ['DECLINED', 'CANCELLED', 'EXPIRED'];

export interface ProviderOrder {
  orderId: string;
  merchantOrderId: string;
  amount: number; // minor units
  currency: string;
  status: ProviderOrderStatus;
  refundedAmount: number;
  card: { mask: string | null; brand: string | null; token: string | null } | null;
  declineCode: string | null;
  declineReason: string | null;
  rrn: string | null;
  approvalCode: string | null;
  paidAt: string | null;
  /** Untouched provider payload (stored in payments.provider_data). */
  raw: Record<string, unknown>;
}

export interface CreateOrderInput {
  amount: number;
  currency: string;
  merchantOrderId: string;
  description: string;
  language?: 'az' | 'ru' | 'en';
  returnUrl: string;
  callbackUrl: string;
  saveCard?: boolean;
  customer?: { id?: string; phone?: string | null; email?: string | null };
}

export interface CreatedOrder { orderId: string; status: ProviderOrderStatus; paymentUrl: string; expiresAt: string | null }

export interface ChargeTokenInput {
  amount: number;
  currency: string;
  merchantOrderId: string;
  description: string;
  cardToken: string;
  callbackUrl?: string;
}

export interface WebhookEvent { event: string; order: ProviderOrder }

export type HeaderBag = Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  /** Stable id stored in payments.provider and used in webhook / return routes. */
  readonly name: string;
  /** Hosted-payment-page order; the user is redirected to `paymentUrl`. Must be idempotent per merchantOrderId. */
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  getOrder(orderId: string): Promise<ProviderOrder>;
  /** Refund `amount` (default: the remaining captured amount). */
  refund(orderId: string, amount?: number, reason?: string): Promise<ProviderOrder>;
  /** Merchant-initiated charge of a saved card token (subscription renewals). Synchronous result. */
  chargeToken(input: ChargeTokenInput): Promise<ProviderOrder>;
  /** Cancel an unpaid order. */
  cancel(orderId: string): Promise<ProviderOrder>;
  /** Authenticates and parses a webhook. Throws `InvalidSignatureError` when the request is not genuine. */
  verifyWebhook(headers: HeaderBag, rawBody: Buffer | string): WebhookEvent;
  /** Forget a saved card (optional). */
  deleteToken?(cardToken: string): Promise<void>;
}

/** Nest injection token for the active provider. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Network / protocol error talking to the provider. `status` = HTTP status when the provider answered. */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class InvalidSignatureError extends Error {
  constructor(message = 'INVALID_SIGNATURE') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}
