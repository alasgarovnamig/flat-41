/**
 * Tiny i18n helpers: locale list, `translate()` over nested JSON dictionaries with `{var}` interpolation,
 * and deterministic date / number formatting. Dictionaries live in /messages/*.json and are loaded on the
 * server (see i18n.server.ts) and handed to the client through <I18nProvider>.
 */
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@evtap/shared';

export { LOCALES, DEFAULT_LOCALE };
export type { Locale };

export type Messages = { [key: string]: string | Messages };
export type TVars = Record<string, string | number | null | undefined>;
export type TFunction = (key: string, vars?: TVars) => string;

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as string[]).includes(v);
export const toLocale = (v: unknown): Locale => (isLocale(v) ? v : DEFAULT_LOCALE);

export const LOCALE_NAMES: Record<Locale, string> = { az: 'Azərbaycan', ru: 'Русский', en: 'English' };
export const LOCALE_SHORT: Record<Locale, string> = { az: 'AZ', ru: 'RU', en: 'EN' };
export const INTL_LOCALE: Record<Locale, string> = { az: 'az-Latn-AZ', ru: 'ru-RU', en: 'en-GB' };

function lookup(messages: Messages, key: string): string | undefined {
  let cur: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function interpolate(s: string, vars?: TVars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** Translate `key` ("a.b.c"); falls back to `fallback` dictionary, then to the key itself. */
export function translate(messages: Messages, key: string, vars?: TVars, fallback?: Messages): string {
  const s = lookup(messages, key) ?? (fallback ? lookup(fallback, key) : undefined);
  return s === undefined ? key : interpolate(s, vars);
}

export const createT = (messages: Messages, fallback?: Messages): TFunction => (key, vars) => translate(messages, key, vars, fallback);

/** Check whether a key exists (to optionally show enum / error labels). */
export const hasKey = (messages: Messages, key: string) => lookup(messages, key) !== undefined;

// ───────── formatting ─────────
const toDate = (d: string | Date) => (typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : d);

// Deterministic (ICU-independent) formatting: Node and browsers ship different ICU data for "az",
// which would cause SSR hydration mismatches with Intl.DateTimeFormat / NumberFormat.
const MONTHS_SHORT: Record<Locale, string[]> = {
  az: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const MONTHS_LONG: Record<Locale, string[]> = {
  az: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  // genitive — reads naturally in "с октября 2026", "13 октября"
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** Calendar month titles (nominative) and Monday-first weekday labels. */
export const CAL_MONTHS: Record<Locale, string[]> = {
  az: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
export const WEEKDAYS: Record<Locale, string[]> = {
  az: ['B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş', 'B'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};
const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: string | Date | null | undefined, locale: Locale, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return '';
  const names = opts.month === 'long' ? MONTHS_LONG[locale] : MONTHS_SHORT[locale];
  const parts: string[] = [];
  if (opts.day) parts.push(String(date.getDate()));
  if (opts.month) parts.push(names[date.getMonth()]!);
  if (opts.year) parts.push(String(date.getFullYear()));
  let out = locale === 'en' && opts.day && opts.month ? `${parts[0]} ${parts.slice(1).join(' ')}` : parts.join(' ');
  if (opts.hour) out += `, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return out;
}

export const formatDateTime = (d: string | Date | null | undefined, locale: Locale) =>
  formatDate(d, locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions) {
  const digits = opts?.maximumFractionDigits ?? 0;
  const fixed = Math.abs(n).toFixed(digits);
  const [int, frac] = fixed.split('.');
  const sep = locale === 'en' ? ',' : '\u00a0';
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${n < 0 ? '−' : ''}${grouped}${frac && Number(frac) ? (locale === 'en' ? '.' : ',') + frac : ''}`;
}

const REL: Record<Locale, { now: string; min: string; hour: string; day: string; yesterday: string }> = {
  az: { now: 'indicə', min: '{n} dəq. əvvəl', hour: '{n} saat əvvəl', day: '{n} gün əvvəl', yesterday: 'dünən' },
  ru: { now: 'только что', min: '{n} мин. назад', hour: '{n} ч. назад', day: '{n} дн. назад', yesterday: 'вчера' },
  en: { now: 'just now', min: '{n} min ago', hour: '{n} h ago', day: '{n} days ago', yesterday: 'yesterday' },
};

/** "5 min ago" / "yesterday"; older than a week → short date. ICU-independent. */
export function formatRelative(d: string | Date | null | undefined, locale: Locale) {
  if (!d) return '';
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return '';
  const sec = Math.max(0, (Date.now() - date.getTime()) / 1000);
  const r = REL[locale];
  if (sec < 60) return r.now;
  if (sec < 3600) return interpolate(r.min, { n: Math.floor(sec / 60) });
  if (sec < 86400) return interpolate(r.hour, { n: Math.floor(sec / 3600) });
  if (sec < 2 * 86400) return r.yesterday;
  if (sec < 7 * 86400) return interpolate(r.day, { n: Math.floor(sec / 86400) });
  return formatDate(date, locale, { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** Build a localized path: lp('ru', '/search') → "/ru/search". */
export const lp = (locale: Locale, path = '/') => `/${locale}${path === '/' ? '' : path.startsWith('/') ? path : `/${path}`}`;

/** Replace the locale prefix of a pathname. */
export function switchLocalePath(pathname: string, locale: Locale) {
  const parts = pathname.split('/');
  if (isLocale(parts[1])) parts[1] = locale;
  else parts.splice(1, 0, locale);
  return parts.join('/') || `/${locale}`;
}
