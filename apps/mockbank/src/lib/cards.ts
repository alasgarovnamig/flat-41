import type { DeclineCode } from './types';

export type CardBrand = 'VISA' | 'MASTERCARD' | 'AMEX' | 'MAESTRO' | 'UNIONPAY' | 'UNKNOWN';

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

export function luhnValid(pan: string): boolean {
  if (!/^\d{12,19}$/.test(pan)) return false;
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let d = pan.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectBrand(pan: string): CardBrand {
  if (/^4/.test(pan)) return 'VISA';
  if (/^3[47]/.test(pan)) return 'AMEX';
  const p4 = Number(pan.slice(0, 4));
  if (/^5[1-5]/.test(pan) || (p4 >= 2221 && p4 <= 2720)) return 'MASTERCARD';
  if (/^62/.test(pan)) return 'UNIONPAY';
  if (/^(50|5[6-9]|6)/.test(pan)) return 'MAESTRO';
  return 'UNKNOWN';
}

/** "4111111111111111" → "411111******1111" */
export function maskPan(pan: string): string {
  if (pan.length < 10) return '*'.repeat(pan.length);
  return pan.slice(0, 6) + '*'.repeat(pan.length - 10) + pan.slice(-4);
}

export type CardOutcome =
  | { kind: 'APPROVE' }
  | { kind: '3DS' }
  | { kind: 'DECLINE'; code: DeclineCode };

export interface TestCard {
  pan: string;
  outcome: CardOutcome;
  /** i18n key describing the outcome in the test-card table. */
  label: 'frictionless' | '3ds' | 'declined';
}

export const TEST_CARDS: TestCard[] = [
  { pan: '4111111111111111', outcome: { kind: 'APPROVE' }, label: 'frictionless' },
  { pan: '4242424242424242', outcome: { kind: 'APPROVE' }, label: 'frictionless' },
  { pan: '5555555555554444', outcome: { kind: '3DS' }, label: '3ds' },
  { pan: '4000000000003220', outcome: { kind: '3DS' }, label: '3ds' },
  { pan: '4000000000000002', outcome: { kind: 'DECLINE', code: 'DO_NOT_HONOR' }, label: 'declined' },
  { pan: '4000000000009995', outcome: { kind: 'DECLINE', code: 'INSUFFICIENT_FUNDS' }, label: 'declined' },
  { pan: '4000000000000069', outcome: { kind: 'DECLINE', code: 'EXPIRED_CARD' }, label: 'declined' },
  { pan: '4000000000000119', outcome: { kind: 'DECLINE', code: 'PROCESSING_ERROR' }, label: 'declined' },
];

/** Behaviour of the simulated issuer for a (Luhn-valid) PAN. Unknown cards go through 3-D Secure. */
export function cardOutcome(pan: string): CardOutcome {
  return TEST_CARDS.find((c) => c.pan === pan)?.outcome ?? { kind: '3DS' };
}

export interface CardInput {
  number: string;
  expiry: string;
  cvv: string;
  holder: string;
}

export interface ValidatedCard {
  pan: string;
  brand: CardBrand;
  mask: string;
  expMonth: number;
  expYear: number;
  holder: string;
}

export type CardField = 'number' | 'expiry' | 'cvv' | 'holder';
export type CardErrorKey = 'numberInvalid' | 'expiryInvalid' | 'expiryPast' | 'cvvInvalid' | 'holderInvalid';

/** Parses "MM/YY", "MM / YY", "MMYY" or "MM/YYYY". */
export function parseExpiry(value: string): { month: number; year: number } | null {
  const m = value.trim().match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return null;
  return { month, year };
}

export function validateCard(
  input: CardInput,
  now = new Date(),
): { ok: true; card: ValidatedCard } | { ok: false; errors: Partial<Record<CardField, CardErrorKey>> } {
  const errors: Partial<Record<CardField, CardErrorKey>> = {};
  const pan = digitsOnly(input.number ?? '');
  if (pan.length < 12 || pan.length > 19 || !luhnValid(pan)) errors.number = 'numberInvalid';
  const brand = detectBrand(pan);

  const exp = parseExpiry(input.expiry ?? '');
  if (!exp) errors.expiry = 'expiryInvalid';
  else {
    const current = now.getFullYear() * 12 + now.getMonth();
    const card = exp.year * 12 + (exp.month - 1);
    if (card < current) errors.expiry = 'expiryPast';
    else if (card > current + 20 * 12) errors.expiry = 'expiryInvalid';
  }

  const cvv = (input.cvv ?? '').trim();
  const cvvOk = brand === 'AMEX' ? /^\d{3,4}$/.test(cvv) : /^\d{3}$/.test(cvv);
  if (!cvvOk) errors.cvv = 'cvvInvalid';

  const holder = (input.holder ?? '').trim().replace(/\s+/g, ' ');
  if (holder.length < 2 || holder.length > 60 || !/^[\p{L} .'-]+$/u.test(holder)) errors.holder = 'holderInvalid';

  if (Object.keys(errors).length > 0 || !exp) return { ok: false, errors };
  return { ok: true, card: { pan, brand, mask: maskPan(pan), expMonth: exp.month, expYear: exp.year, holder: holder.toUpperCase() } };
}
