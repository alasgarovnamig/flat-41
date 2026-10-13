'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthResponse, Me } from '@evtap/shared';
import { api, isApiError, onSessionExpired } from '@/lib/api';
import { tokenStore } from '@/lib/tokens';
import { qk } from '@/lib/query-keys';
import { useI18n } from './I18nProvider';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: Status;
  user: Me | null;
  /** store tokens after a successful login / register / OTP verify */
  signIn: (res: AuthResponse) => void;
  signOut: () => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

const subscribe = (cb: () => void) => tokenStore.subscribe(cb);
const getSnapshot = () => !!tokenStore.access;
const getServerSnapshot = () => false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const hasTokens = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const me = useQuery({
    queryKey: qk.me,
    queryFn: api.auth.me,
    enabled: hasTokens,
    staleTime: 60_000,
    retry: (n, e) => !(isApiError(e) && (e.status === 401 || e.status === 403)) && n < 2,
  });

  useEffect(
    () =>
      onSessionExpired(() => {
        qc.removeQueries({ queryKey: qk.me });
      }),
    [qc],
  );

  // a 401 on /auth/me even after refresh → drop tokens
  useEffect(() => {
    if (me.error && isApiError(me.error) && me.error.status === 401) tokenStore.clear();
  }, [me.error]);

  const signIn = useCallback(
    (res: AuthResponse) => {
      tokenStore.set(res);
      void qc.invalidateQueries();
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    const rt = tokenStore.refresh;
    if (rt) await api.auth.logout(rt).catch(() => undefined);
    tokenStore.clear();
    qc.clear();
  }, [qc]);

  const status: Status = !hydrated ? 'loading' : !hasTokens ? 'anonymous' : me.data ? 'authenticated' : me.isError ? 'anonymous' : 'loading';

  const value = useMemo<AuthValue>(
    () => ({ status, user: me.data ?? null, signIn, signOut, refresh: () => void me.refetch() }),
    [status, me.data, signIn, signOut, me],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Redirect anonymous users to the login page (returns auth state). */
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { href } = useI18n();
  useEffect(() => {
    if (auth.status === 'anonymous') router.replace(`${href('/login')}?next=${encodeURIComponent(pathname)}`);
  }, [auth.status, router, pathname, href]);
  return auth;
}

/** Returns a function that runs `fn` when logged in, otherwise sends the user to login. */
export function useAuthGate() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { href } = useI18n();
  return useCallback(
    (fn: () => void) => {
      if (auth.status === 'authenticated') fn();
      else router.push(`${href('/login')}?next=${encodeURIComponent(pathname + (typeof window !== 'undefined' ? window.location.search : ''))}`);
    },
    [auth.status, router, pathname, href],
  );
}
