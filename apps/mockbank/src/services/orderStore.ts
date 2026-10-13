import { mapRow, type Queryable } from '../db';
import type { DeclineCode, OrderJson, OrderRow, RefundRow, WebhookEvent, OrderStatus } from '../lib/types';

export const DECLINE_REASONS: Record<DeclineCode, string> = {
  DO_NOT_HONOR: 'Do not honor',
  INSUFFICIENT_FUNDS: 'Insufficient funds',
  EXPIRED_CARD: 'Expired card',
  PROCESSING_ERROR: 'Processing error, please try again later',
  '3DS_FAILED': '3-D Secure authentication failed',
  TOKEN_INVALID: 'Card token is invalid or has been deleted',
};

/** The webhook event announcing an order's current status (null for non-final statuses). */
export function eventForStatus(status: OrderStatus): WebhookEvent | null {
  switch (status) {
    case 'APPROVED':
      return 'order.approved';
    case 'DECLINED':
      return 'order.declined';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'order.refunded';
    case 'CANCELLED':
      return 'order.cancelled';
    case 'EXPIRED':
      return 'order.expired';
    default:
      return null;
  }
}

export async function findOrder(q: Queryable, orderId: string, opts: { forUpdate?: boolean } = {}): Promise<OrderRow | null> {
  const { rows } = await q.query(`SELECT * FROM orders WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`, [orderId]);
  return rows[0] ? mapRow<OrderRow>(rows[0]) : null;
}

export async function findRefunds(q: Queryable, orderId: string): Promise<RefundRow[]> {
  const { rows } = await q.query('SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at, id', [orderId]);
  return rows.map((r) => mapRow<RefundRow>(r));
}

/** Patch value meaning "the transaction's now()". */
export const NOW = Symbol('now');

/**
 * Atomic status transition: only applies when the order is currently in one of `from`.
 * Returns the updated row, or null when the order was in another state (lost race / invalid).
 */
export async function transition(
  q: Queryable,
  orderId: string,
  from: OrderStatus[],
  patch: Partial<Record<string, unknown>>,
): Promise<OrderRow | null> {
  const params: unknown[] = [orderId, from];
  const sets = Object.entries(patch).map(([col, value]) => {
    if (value === NOW) return `${col} = now()`;
    params.push(value);
    return `${col} = $${params.length}`;
  });
  sets.push('updated_at = now()');
  const { rows } = await q.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`, params);
  return rows[0] ? mapRow<OrderRow>(rows[0]) : null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function toOrderJson(row: OrderRow, refunds: RefundRow[]): OrderJson {
  return {
    orderId: row.id,
    merchantOrderId: row.merchantOrderId,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    status: row.status,
    refundedAmount: row.refundedAmount,
    card: row.cardMask ? { mask: row.cardMask, brand: row.cardBrand ?? 'UNKNOWN', token: row.cardToken } : null,
    declineCode: row.declineCode,
    declineReason: row.declineReason,
    rrn: row.rrn,
    approvalCode: row.approvalCode,
    refunds: refunds.map((r) => ({ id: r.id, amount: r.amount, reason: r.reason, createdAt: iso(r.createdAt)! })),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    paidAt: iso(row.paidAt),
    expiresAt: iso(row.expiresAt)!,
  };
}

export async function loadOrderJson(q: Queryable, row: OrderRow): Promise<OrderJson> {
  return toOrderJson(row, await findRefunds(q, row.id));
}

export async function addEvent(
  q: Queryable,
  orderId: string,
  type: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await q.query('INSERT INTO events (order_id, type, message, data) VALUES ($1, $2, $3, $4)', [
    orderId,
    type,
    message,
    data ? JSON.stringify(data) : null,
  ]);
}
