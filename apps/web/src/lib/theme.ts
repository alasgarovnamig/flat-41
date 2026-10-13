'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Theme = `data-theme` on <html> ("light" | "dark"), resolved from the stored preference (light / dark / system).
 * THEME_SCRIPT (root layout <head>) applies it before first paint; this module keeps it in sync afterwards.
 */
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'evtap.theme';

export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem('${KEY}');if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-pref',p)}catch(e){}})()`;

const listeners = new Set<() => void>();
const readPref = (): ThemePref => {
  try {
    const p = window.localStorage.getItem(KEY);
    return p === 'light' || p === 'dark' ? p : 'system';
  } catch {
    return 'system';
  }
};
const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  const root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-theme-pref', pref);
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: still apply for this page view */
  }
  apply(pref);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, readPref, () => 'system' as ThemePref);
  // follow the OS while on "system"
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => apply('system');
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [pref]);
  const set = useCallback((p: ThemePref) => setThemePref(p), []);
  return { pref, setPref: set };
}
