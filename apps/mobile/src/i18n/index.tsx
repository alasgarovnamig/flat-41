import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocales } from 'expo-localization';
import { DEFAULT_LOCALE, LOCALES, localized, type Locale, type LocalizedName } from '@evtap/shared';
import { az, type Dict } from './az';
import { ru } from './ru';
import { en } from './en';
import { storage, KEYS } from '../lib/storage';

const DICTS: Record<Locale, Dict> = { az, ru, en };

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TKey = Paths<Dict>;
type EnumGroup = keyof Dict['enums'];
type Vars = Record<string, string | number>;

/** Module-level copy so non-React code (API client headers, push handlers) can read the locale. */
let currentLocale: Locale = DEFAULT_LOCALE;
export const getCurrentLocale = () => currentLocale;

const lookup = (dict: Dict, key: string): string | undefined => {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof node === 'string' ? node : undefined;
};

const interpolate = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)) : s;

export const translate = (locale: Locale, key: TKey, vars?: Vars) =>
  interpolate(lookup(DICTS[locale], key) ?? lookup(az, key) ?? key, vars);

const pad = (n: number) => String(n).padStart(2, '0');

type I18n = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TKey, vars?: Vars) => string;
  /** Translate an enum value: te('dealType', 'SALE'). */
  te: (group: EnumGroup, value: string | null | undefined) => string;
  /** Localized name of a city / district / metro (shared locations). */
  ln: (name: LocalizedName | undefined) => string;
  months: string[];
  weekdays: string[];
  /** 13 Oktyabr 2026 */
  fmtDate: (iso: string | null | undefined) => string;
  /** 13.10.2026 14:05 */
  fmtDateTime: (iso: string | null | undefined) => string;
  /** "Bu gün, 14:05" / "Dünən, 09:12" / "13.10.2026" */
  fmtRelative: (iso: string | null | undefined) => string;
};

const Ctx = createContext<I18n | null>(null);

const detectLocale = (): Locale => {
  try {
    const code = getLocales()[0]?.languageCode;
    if (code && (LOCALES as string[]).includes(code)) return code as Locale;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    currentLocale = detectLocale();
    return currentLocale;
  });

  useEffect(() => {
    storage.get(KEYS.locale).then((v) => {
      if (v && (LOCALES as string[]).includes(v)) {
        currentLocale = v as Locale;
        setLocaleState(v as Locale);
      }
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    currentLocale = l;
    setLocaleState(l);
    storage.set(KEYS.locale, l);
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[locale];
    const t = (key: TKey, vars?: Vars) => translate(locale, key, vars);
    const months = dict.calendar.months.split(',');
    const weekdays = dict.calendar.weekdays.split(',');
    const fmtDate = (iso: string | null | undefined) => {
      if (!iso) return '';
      const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
      if (Number.isNaN(d.getTime())) return '';
      return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    };
    const fmtDateTime = (iso: string | null | undefined) => {
      if (!iso) return '';
      const d = new Date(iso);
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const fmtRelative = (iso: string | null | undefined) => {
      if (!iso) return '';
      const d = new Date(iso);
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (d.getTime() >= startOfToday) return `${dict.common.today}, ${time}`;
      if (d.getTime() >= startOfToday - 86_400_000) return `${dict.common.yesterday}, ${time}`;
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    };
    return {
      locale,
      setLocale,
      t,
      te: (group, v) => (v ? ((dict.enums[group] as Record<string, string>)[v] ?? v) : ''),
      ln: (name) => localized(name, locale),
      months,
      weekdays,
      fmtDate,
      fmtDateTime,
      fmtRelative,
    };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
};

export const LOCALE_NAMES: Record<Locale, string> = { az: 'Azərbaycanca', ru: 'Русский', en: 'English' };
