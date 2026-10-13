import type { Payment } from '@evtap/shared';
import type { payments } from '../../db/schema';
import { iso } from '../../common/util';

export type PaymentRow = typeof payments.$inferSelect;

export const toPaymentDto = (p: PaymentRow): Payment => ({
  id: p.id,
  userId: p.userId,
  purpose: p.purpose as Payment['purpose'],
  method: p.method as Payment['method'],
  amount: p.amount,
  currency: p.currency as Payment['currency'],
  status: p.status as Payment['status'],
  description: p.description,
  listingId: p.listingId,
  bookingId: p.bookingId,
  items: p.items,
  provider: p.provider,
  providerOrderId: p.providerOrderId,
  cardMask: p.cardMask,
  refundedAmount: p.refundedAmount,
  failureReason: p.failureReason,
  createdAt: iso(p.createdAt)!,
  paidAt: iso(p.paidAt),
});
