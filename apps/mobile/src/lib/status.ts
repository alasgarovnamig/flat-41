import type { BookingStatus } from '@evtap/shared';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const BOOKING_TONE: Record<BookingStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
  COMPLETED: 'info',
  REFUNDED: 'neutral',
};
