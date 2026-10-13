/**
 * Pure booking rules (no DB) — shared by BookingsService and unit tests.
 * All bookable listings are in AZ / GE, both UTC+4 without DST, so "local" time is a fixed +04:00 offset.
 */
export const LOCAL_OFFSET = '+04:00';
const LOCAL_OFFSET_MS = 4 * 3_600_000;
export const DEFAULT_CHECK_IN_TIME = '14:00';
export const HOLD_MINUTES = 30;
export const MAX_NIGHTS = 365;

/** Today's date (YYYY-MM-DD) in Baku / Tbilisi. */
export const localToday = (now = new Date()) => new Date(now.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);

/** Check-in moment: the check-in date at the listing's check-in time (default 14:00) local time. */
export const checkInMoment = (checkIn: string, checkInTime?: string | null) =>
  new Date(`${checkIn}T${/^\d{2}:\d{2}$/.test(checkInTime ?? '') ? checkInTime : DEFAULT_CHECK_IN_TIME}:00${LOCAL_OFFSET}`);

/** Half-open date ranges [checkIn, checkOut) overlap (the checkout day can be the next guest's check-in day). */
export const rangesOverlap = (aIn: string, aOut: string, bIn: string, bOut: string) => aIn < bOut && bIn < aOut;

export type CancelledBy = 'GUEST' | 'HOST' | 'ADMIN';

export interface CancellationOutcome {
  /** Amount returned to the guest (minor units). */
  refund: number;
  /** What the host still receives at payout time (0 = payout cancelled). */
  hostPayout: number;
  policy: 'FULL' | 'PARTIAL';
}

/**
 * Cancellation policy (docs/BUSINESS_MODEL.md D):
 *  - host or admin cancels → guest gets 100 % of the total (incl. service fee), host gets nothing;
 *  - guest cancels ≥ freeCancellationHours before check-in → 100 % of the total;
 *  - guest cancels later → 50 % of the subtotal (nightly price × nights) is refunded, the guest service fee is kept.
 *    The host keeps the other 50 % of the subtotal minus the platform commission at the same rate as the booking
 *    (hostFee / subtotal), paid out on the normal payout schedule.
 */
export const cancellationOutcome = (
  b: { subtotal: number; guestFee: number; hostFee: number; total: number },
  by: CancelledBy,
  hoursBeforeCheckIn: number,
  freeCancellationHours: number,
): CancellationOutcome => {
  if (by !== 'GUEST' || hoursBeforeCheckIn >= freeCancellationHours) return { refund: b.total, hostPayout: 0, policy: 'FULL' };
  const refund = Math.floor(b.subtotal / 2);
  const kept = b.subtotal - refund;
  const commission = b.subtotal > 0 ? Math.round((kept * b.hostFee) / b.subtotal) : 0;
  return { refund, hostPayout: kept - commission, policy: 'PARTIAL' };
};
