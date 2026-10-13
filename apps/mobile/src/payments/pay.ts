/**
 * Card payments via the bank's hosted page (docs/MOCKBANK.md):
 *   POST /checkout { returnUrl: evtap://payment/result } → paymentUrl
 *   → expo-web-browser auth session (SFSafariViewController / Chrome Custom Tab)
 *   → bank → API /payments/return/mockbank → 302 evtap://payment/result?paymentId=..&status=..
 *   → the auth session resolves with that URL → /payment/result polls GET /payments/:id until final.
 */
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { PAYMENT_RETURN, type CheckoutResponse } from '@evtap/shared';

let sessionActive = false;
/** Used by app/+native-intent.tsx to swallow the duplicate deep link Android emits while the session is open. */
export const isPaymentSessionActive = () => sessionActive;

/**
 * `evtap://payment/result` in dev/standalone builds (PAYMENT_RETURN.mobileScheme);
 * `exp://…/--/payment/result` when running inside Expo Go.
 */
export const paymentReturnUrl = () => {
  const url = Linking.createURL('payment/result');
  return url.startsWith('evtap://') ? PAYMENT_RETURN.mobileScheme : url;
};

export type PaymentContext = { listingId?: string; bookingId?: string };

const showResult = (paymentId: string, status: string, ctx?: PaymentContext) =>
  router.push({ pathname: '/payment/result', params: { paymentId, status, ...(ctx ?? {}) } });

/** Finish a CheckoutResponse: wallet payments are already final, card payments open the bank page. */
export async function completeCheckout(res: CheckoutResponse, ctx?: PaymentContext) {
  if (!res.paymentUrl || res.status === 'SUCCEEDED' || res.status === 'FAILED') {
    showResult(res.paymentId, res.status, ctx);
    return;
  }
  sessionActive = true;
  try {
    const result = await WebBrowser.openAuthSessionAsync(res.paymentUrl, paymentReturnUrl(), {
      showInRecents: true,
      createTask: false,
    });
    let status = '';
    let paymentId = res.paymentId;
    if (result.type === 'success') {
      const { queryParams } = Linking.parse(result.url);
      if (typeof queryParams?.status === 'string') status = queryParams.status;
      if (typeof queryParams?.paymentId === 'string') paymentId = queryParams.paymentId;
    }
    // Dismissed/cancelled: the result screen still polls — the payment may have completed in the browser.
    showResult(paymentId, status, ctx);
  } finally {
    setTimeout(() => {
      sessionActive = false;
    }, 2000);
  }
}
