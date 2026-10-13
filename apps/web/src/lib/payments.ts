'use client';

import type { CheckoutResponse, Locale } from '@evtap/shared';
import { PAYMENT_RETURN } from '@evtap/shared';
import { WEB_URL } from './config';

/** Where the bank (via the API) sends the browser back after payment. */
export const paymentReturnUrl = (locale: Locale) => `${WEB_URL}/${locale}${PAYMENT_RETURN.web}`;

/** After POST /checkout (or /bookings): go to the bank page for CARD, or straight to the result page for WALLET. */
export function followCheckout(c: CheckoutResponse, locale: Locale, push: (url: string) => void) {
  if (c.paymentUrl) {
    window.location.assign(c.paymentUrl);
    return;
  }
  push(`/${locale}${PAYMENT_RETURN.web}?paymentId=${encodeURIComponent(c.paymentId)}&status=${encodeURIComponent(c.status)}`);
}
