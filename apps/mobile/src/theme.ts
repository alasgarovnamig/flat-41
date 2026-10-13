import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { storage, KEYS } from './lib/storage';

/** Brand palette (docs/ARCHITECTURE.md → Brand). */
export const brand = {
  primary: '#0E7C66',
  primaryDark: '#0A5C4C',
  vip: '#F5A524',
  premium: '#7C3AED',
  urgent: '#E5484D',
  highlight: '#FFF8E6',
  text: '#111827',
  muted: '#6B7280',
  surface: '#F7F7F8',
  white: '#FFFFFF',
  whatsapp: '#25D366',
} as const;

const light = {
  bg: '#FFFFFF',
  surface: brand.surface,
  card: '#FFFFFF',
  text: brand.text,
  muted: brand.muted,
  border: '#E5E7EB',
  primary: brand.primary,
  primaryDark: brand.primaryDark,
  primarySoft: '#E6F4F0',
  onPrimary: '#FFFFFF',
  highlightBg: brand.highlight,
  vip: brand.vip,
  premium: brand.premium,
  urgent: brand.urgent,
  success: '#16A34A',
  warning: '#D97706',
  danger: brand.urgent,
  skeleton: '#ECEEF1',
  overlay: 'rgba(17,24,39,0.45)',
  inputBg: '#F7F7F8',
};

export type Colors = { [K in keyof typeof light]: string };

const dark: Colors = {
  bg: '#0B0F0E',
  surface: '#121817',
  card: '#182020',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  border: '#27302E',
  primary: '#17A386',
  primaryDark: '#0E7C66',
  primarySoft: '#123A32',
  onPrimary: '#FFFFFF',
  highlightBg: '#2E2715',
  vip: brand.vip,
  premium: '#9F67FF',
  urgent: '#F06A6E',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#F06A6E',
  skeleton: '#1F2826',
  overlay: 'rgba(0,0,0,0.6)',
  inputBg: '#182020',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26, xxxl: 32 } as const;
/** Minimum touch target (Apple HIG 44pt / Material 48dp). */
export const HIT = 44;

export type ThemePref = 'system' | 'light' | 'dark';

type ThemeCtx = { c: Colors; dark: boolean; pref: ThemePref; setPref: (p: ThemePref) => void };
const Ctx = createContext<ThemeCtx>({ c: light, dark: false, pref: 'system', setPref: () => {} });

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');

  useEffect(() => {
    storage.get(KEYS.theme).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v);
    });
  }, []);

  const value = useMemo<ThemeCtx>(() => {
    const isDark = pref === 'system' ? system === 'dark' : pref === 'dark';
    return {
      c: isDark ? dark : light,
      dark: isDark,
      pref,
      setPref: (p) => {
        setPrefState(p);
        storage.set(KEYS.theme, p);
      },
    };
  }, [pref, system]);

  return createElement(Ctx.Provider, { value }, children);
}

export const useTheme = () => useContext(Ctx);
