export const ORDER_STATUSES = [
  'CREATED',
  'PROCESSING',
  'APPROVED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DECLINE_CODES = [
  'DO_NOT_HONOR',
  'INSUFFICIENT_FUNDS',
  'EXPIRED_CARD',
  'PROCESSING_ERROR',
  '3DS_FAILED',
  'TOKEN_INVALID',
] as const;
export type DeclineCode = (typeof DECLINE_CODES)[number];

export const CURRENCIES = ['AZN', 'USD', 'EUR', 'GEL'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const LANGUAGES = ['az', 'ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export type WebhookEvent = 'order.approved' | 'order.declined' | 'order.refunded' | 'order.cancelled' | 'order.expired';

export type OrderKind = 'CHECKOUT' | 'TOKEN';

/** Final statuses reached by the hosted checkout. */
export const CHECKOUT_FINAL: OrderStatus[] = ['APPROVED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

export interface Customer {
  id?: string;
  phone?: string;
  email?: string;
}

/** Row of the `orders` table (snake_case → camelCase mapped in services/orders.ts). */
export interface OrderRow {
  id: string;
  merchantId: string;
  merchantOrderId: string;
  kind: OrderKind;
  amount: number;
  currency: Currency;
  description: string;
  language: Language;
  returnUrl: string | null;
  callbackUrl: string | null;
  saveCard: boolean;
  customer: Customer | null;
  status: OrderStatus;
  refundedAmount: number;
  cardMask: string | null;
  cardBrand: string | null;
  cardToken: string | null;
  cardHolder: string | null;
  saveCardRequested: boolean;
  declineCode: DeclineCode | null;
  declineReason: string | null;
  rrn: string | null;
  approvalCode: string | null;
  otpAttempts: number;
  formNonce: string;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  expiresAt: Date;
}

export interface RefundRow {
  id: string;
  orderId: string;
  amount: number;
  reason: string | null;
  source: string;
  createdAt: Date;
}

/** The public Order object (docs/MOCKBANK.md). */
export interface OrderJson {
  orderId: string;
  merchantOrderId: string;
  amount: number;
  currency: Currency;
  description: string;
  status: OrderStatus;
  refundedAmount: number;
  card: { mask: string; brand: string; token: string | null } | null;
  declineCode: DeclineCode | null;
  declineReason: string | null;
  rrn: string | null;
  approvalCode: string | null;
  refunds: { id: string; amount: number; reason: string | null; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  expiresAt: string;
}

export interface Merchant {
  id: string;
  name: string;
  secret: string;
  createdAt: Date;
}

export interface CardTokenRow {
  token: string;
  merchantId: string;
  mask: string;
  brand: string;
  customerId: string | null;
  forceInsufficientFunds: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}
