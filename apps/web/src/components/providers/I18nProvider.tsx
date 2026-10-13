'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Locale } from '@evtap/shared';
import {
  createT, formatDate, formatDateTime, formatNumber, formatRelative, hasKey, lp, type Messages, type TFunction,
} from '@/lib/i18n';

interface I18nValue {
  locale: Locale;
  t: TFunction;
  /** translate only if the key exists, else return `fallback` */
  tx: (key: string, fallback: string) => string;
  /** localized path */
  href: (path?: string) => string;
  date: (d: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: string | Date | null | undefined) => string;
  relative: (d: string | Date | null | undefined) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, messages, fallback, children }: { locale: Locale; messages: Messages; fallback?: Messages; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const t = createT(messages, fallback);
    return {
      locale,
      t,
      tx: (key, fb) => (hasKey(messages, key) || (fallback && hasKey(fallback, key)) ? t(key) : fb),
      href: (path = '/') => lp(locale, path),
      date: (d, opts) => formatDate(d, locale, opts),
      dateTime: (d) => formatDateTime(d, locale),
      relative: (d) => formatRelative(d, locale),
      number: (n, opts) => formatNumber(n, locale, opts),
    };
  }, [locale, messages, fallback]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

export const useT = () => useI18n().t;
