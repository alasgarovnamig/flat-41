import { isPaymentSessionActive } from '@/payments/pay';

/**
 * Incoming deep links (evtap://… and https://evtap.az/…).
 *  - While a bank auth session is open, Android also delivers `evtap://payment/result` as a regular
 *    deep link; `completeCheckout()` already navigates to the result, so we drop the duplicate.
 *  - https://evtap.az/listing/<id> universal links map 1:1 onto app routes.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (!initial && isPaymentSessionActive() && path.includes('payment/result')) return null;
    return path;
  } catch {
    return path;
  }
}
