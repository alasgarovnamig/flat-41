/**
 * Minimal i18n: English strings are the keys; `az` provides translations (missing keys fall back to English).
 * Usage: const { t } = useT(); t('Approve'); t('Sent to {n} users', { n: 12 })
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { az } from './az';

export type UiLang = 'en' | 'az';
const KEY = 'evtap.admin.lang';

const interpolate = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)) : s;

let currentLang: UiLang = (() => {
  try {
    return localStorage.getItem(KEY) === 'az' ? 'az' : 'en';
  } catch {
    return 'en';
  }
})();

export const getLang = () => currentLang;

/** Non-hook translate, for helpers outside components (uses the current language). */
export const translate = (key: string, vars?: Record<string, string | number>) =>
  interpolate(currentLang === 'az' ? (az[key] ?? key) : key, vars);

type Ctx = { lang: UiLang; setLang: (l: UiLang) => void; t: typeof translate };
const I18nContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: translate });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(currentLang);
  const setLang = useCallback((l: UiLang) => {
    currentLang = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
    setLangState(l);
  }, []);
  // `t` identity changes with the language so memoised consumers re-render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext);
