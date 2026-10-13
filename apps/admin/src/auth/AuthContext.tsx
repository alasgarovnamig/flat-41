import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User, UserRole } from '@evtap/shared';
import * as api from '../api/client';
import { translate } from '../i18n';

export const STAFF_ROLES: UserRole[] = ['ADMIN', 'MODERATOR'];
export const isStaff = (role: UserRole | undefined) => !!role && STAFF_ROLES.includes(role);

type Status = 'loading' | 'authenticated' | 'anonymous';
type AuthCtx = {
  status: Status;
  user: User | null;
  isAdmin: boolean;
  /** Message to show on the login screen (e.g. "session expired"). */
  notice: string | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>(() => (api.tokens.get() ? 'loading' : 'anonymous'));
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Restore the session from stored tokens.
  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    api
      .getMe()
      .then((me) => {
        if (cancelled) return;
        if (!isStaff(me.role)) {
          api.tokens.clear();
          setStatus('anonymous');
          return;
        }
        setUser(me);
        setStatus('authenticated');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // keep tokens on network errors so a reload can recover; drop them on auth errors
        if (!(e instanceof api.ApiRequestError && e.isNetwork)) api.tokens.clear();
        else setNotice(translate('Cannot reach the API'));
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(
    () =>
      api.onSessionExpired(() => {
        setUser(null);
        setStatus('anonymous');
        setNotice(translate('Your session has expired. Please sign in again.'));
        qc.clear();
      }),
    [qc],
  );

  const login = useCallback(async (login: string, password: string) => {
    const res = await api.login({ login, password });
    if (!isStaff(res.user.role)) {
      // revoke the refresh token we just got — this account may not use the back-office
      api.tokens.set(res);
      await api.logout(res.refreshToken).catch(() => undefined);
      api.tokens.clear();
      throw new Error(translate('Access denied: only administrators and moderators can sign in.'));
    }
    api.tokens.set(res);
    setNotice(null);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const t = api.tokens.get();
    if (t) await api.logout(t.refreshToken).catch(() => undefined);
    api.tokens.clear();
    setUser(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthCtx>(
    () => ({ status, user, isAdmin: user?.role === 'ADMIN', notice, login, logout }),
    [status, user, notice, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};
