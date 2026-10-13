import { CITIES, DISTRICTS, METRO_STATIONS, formatMoney, formatPrice, localized, type Currency } from '@evtap/shared';
import { getLang, translate } from '../i18n';

export { formatMoney, formatPrice };

const pad = (n: number) => String(n).padStart(2, '0');

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  // date-only strings (YYYY-MM-DD) must not shift with the timezone
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtRelative = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return translate('just now');
  if (m < 60) return translate('{n} min ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return translate('{n} h ago', { n: h });
  const days = Math.round(h / 24);
  if (days < 30) return translate('{n} d ago', { n: days });
  return fmtDate(iso);
};

/** Short chart-axis label: "2026-10-13" → "13.10" */
export const fmtDay = (iso: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}.${m[1]}` : iso;
};

export const fmtNumber = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US').replace(/,/g, ' '));
export const fmtPercent = (n: number | null | undefined, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`);

/** Minor units → editable major string ("1050" → "10.50"). */
export const minorToInput = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toFixed(2));
/** Major string from an input → minor units, or null when invalid ("10,5" → 1050). */
export const inputToMinor = (s: string): number | null => {
  const v = Number(String(s).trim().replace(',', '.'));
  return Number.isFinite(v) && String(s).trim() !== '' ? Math.round(v * 100) : null;
};

/** formatMoney + thousands grouping for readability ("140663.20 ₼" → "140 663.20 ₼"). */
export const money = (minor: number | null | undefined, currency: Currency = 'AZN') =>
  minor == null ? '—' : formatMoney(minor, currency).replace(/^(-?)(\d+)/, (_, sign: string, int: string) => sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ' '));

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

export const humanize = (v: string) => {
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const ENUM_LABELS: Record<string, string> = {
  SALE: 'Sale',
  RENT_LONG: 'Long-term rent',
  RENT_DAILY: 'Daily rent',
  WALLET_TOPUP: 'Wallet top-up',
  LISTING_FEE: 'Listing fee',
  PAST_DUE: 'Past due',
  NOT_DUE: 'Not due',
  PENDING_PAYMENT: 'Pending payment',
  SENT_TO_BANK: 'Sent to bank',
  AGENT_AS_OWNER: 'Agent as owner',
  WRONG_PRICE: 'Wrong price',
  WRONG_PHOTOS: 'Wrong photos',
  ALREADY_SOLD: 'Already sold',
  HOME_TOP: 'Home — top',
  SEARCH_TOP: 'Search — top',
  SEARCH_SIDEBAR: 'Search — sidebar',
  LISTING_SIDEBAR: 'Listing — sidebar',
  MOBILE_HOME: 'Mobile — home',
  AUTO_BUMP: 'Auto-bump',
  MONTH: 'Monthly',
  WIFI: 'Wi-Fi',
  TV: 'TV',
  CCTV: 'CCTV',
  BBQ: 'BBQ',
  VIP: 'VIP',
  KOMBI: 'Kombi boiler',
  YEAR: 'Yearly',
};

/** Human label for any shared enum value, translated. */
export const enumLabel = (v: string | null | undefined) => (v ? translate(ENUM_LABELS[v] ?? humanize(v)) : '—');

const lang = getLang;
export const cityName = (id: string | null | undefined) => (id ? localized(CITIES.find((c) => c.id === id)?.name, lang()) || id : '—');
export const districtName = (id: string | null | undefined) => (id ? localized(DISTRICTS.find((c) => c.id === id)?.name, lang()) || id : '—');
export const metroName = (id: string | null | undefined) => (id ? localized(METRO_STATIONS.find((c) => c.id === id)?.name, lang()) || id : '—');

export const ctr = (clicks: number, impressions: number) => (impressions > 0 ? (clicks / impressions) * 100 : null);
