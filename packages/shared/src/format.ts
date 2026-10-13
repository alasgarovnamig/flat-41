import type { Currency, Locale } from './enums';

const SYMBOL: Record<Currency, string> = { AZN: '₼', USD: '$', EUR: '€', GEL: '₾' };

/** Format a MAJOR-unit price, e.g. 125000 AZN → "125 000 ₼". */
export const formatPrice = (major: number, currency: Currency) =>
  `${Math.round(major).toLocaleString('en-US').replace(/,/g, ' ')} ${SYMBOL[currency] ?? currency}`;

/** Format a MINOR-unit amount, e.g. 1050 → "10.50 ₼". */
export const formatMoney = (minor: number, currency: Currency = 'AZN') =>
  `${(minor / 100).toFixed(2)} ${SYMBOL[currency] ?? currency}`;

export const currencySymbol = (c: Currency) => SYMBOL[c] ?? c;

/** "+994501234567" → "+994 50 123 45 67" */
export const formatPhone = (e164: string) => {
  const m = /^\+(\d{3})(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : e164;
};

/** "+994501234567" → "+994 50 123 ** **" */
export const maskPhone = (e164: string) => {
  const m = /^\+(\d{3})(\d{2})(\d{3})\d{4}$/.exec(e164);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ** **` : e164.slice(0, -4) + '****';
};

export const pricePerM2 = (price: number, area: number) => (area > 0 ? Math.round(price / area) : 0);

/** Simple annuity mortgage monthly payment (major units). */
export const mortgageMonthly = (principal: number, annualRatePercent: number, years: number) => {
  const r = annualRatePercent / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);

export type { Locale };
