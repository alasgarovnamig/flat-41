import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

const THEME_KEY = 'evtap.admin.theme';

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return { dark, toggle };
}

/**
 * Filters & pagination kept in the URL (shareable, survives reload).
 * Returns the current values (with defaults) and a setter that resets `page` unless it is being set.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out = { ...defaults } as Record<string, string>;
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v !== null) out[k] = v;
    }
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback(
    (patch: Partial<T>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === defaults[k]) next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  return [values, set] as const;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Media query hook (e.g. collapse sidebar below lg). */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Global keyboard shortcuts, ignored while typing in inputs. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = map[e.key] ?? map[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, enabled]);
}
