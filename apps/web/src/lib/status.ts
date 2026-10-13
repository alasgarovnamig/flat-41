import type { BookingStatus, ListingStatus, PaymentStatus, SubscriptionStatus } from '@evtap/shared';
import type { StatusTone } from '@/components/ds/Badge';

/** Status → pill tone (Active = success, Pending = warning, Rejected / Blocked = danger …). Text always accompanies colour. */
export const listingStatusTone = (s: ListingStatus): StatusTone =>
  ({ ACTIVE: 'success', PENDING: 'warning', DRAFT: 'warning', REJECTED: 'danger', BLOCKED: 'danger', EXPIRED: 'neutral', ARCHIVED: 'neutral', SOLD: 'info' } as const)[s] ?? 'neutral';

export const bookingStatusTone = (s: BookingStatus): StatusTone =>
  ({ PENDING_PAYMENT: 'warning', CONFIRMED: 'success', CANCELLED: 'neutral', COMPLETED: 'info', REFUNDED: 'neutral' } as const)[s] ?? 'neutral';

export const paymentStatusTone = (s: PaymentStatus): StatusTone =>
  ({ CREATED: 'neutral', PENDING: 'warning', SUCCEEDED: 'success', FAILED: 'danger', CANCELLED: 'neutral', REFUNDED: 'info', PARTIALLY_REFUNDED: 'info' } as const)[s] ?? 'neutral';

export const subscriptionStatusTone = (s: SubscriptionStatus): StatusTone =>
  ({ ACTIVE: 'success', PAST_DUE: 'danger', CANCELLED: 'warning', EXPIRED: 'neutral' } as Record<string, StatusTone>)[s] ?? 'neutral';
