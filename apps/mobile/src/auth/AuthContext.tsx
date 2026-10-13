import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, Me } from '@evtap/shared';
import { api } from '../api/client';
import { getTokens, loadTokens, onTokensChange, setTokens } from '../api/tokens';
import { qk } from '../api/queryClient';
import { LoginPromptSheet } from './LoginPrompt';
import { unregisterPushToken } from '../push/notifications';

type Status = 'loading' | 'guest' | 'authed';

type AuthCtx = {
  status: Status;
  isAuthed: boolean;
  me: Me | undefined;
  /** Store tokens from an AuthResponse (OTP verify / login / register). */
  signIn: (res: AuthResponse) => Promise<void>;
  logout: () => Promise<void>;
  refetchMe: () => void;
  /**
   * Gate a protected action: runs `action` when logged in, otherwise shows the login prompt.
   * Returns true when the user is logged in.
   */
  requireAuth: (action?: () => void) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [prompt, setPrompt] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    loadTokens().then(() => setStatus(getTokens() ? 'authed' : 'guest'));
    return onTokensChange((t) => {
      if (!t && statusRef.current === 'authed') {
        // Refresh failed / logout → drop every cached private query.
        qc.clear();
      }
      setStatus(t ? 'authed' : 'guest');
    });
  }, [qc]);

  const meQuery = useQuery({ queryKey: qk.me, queryFn: api.me, enabled: status === 'authed', staleTime: 15_000 });

  const signIn = useCallback(
    async (res: AuthResponse) => {
      await setTokens(res);
      await qc.invalidateQueries();
    },
    [qc],
  );

  const logout = useCallback(async () => {
    const t = getTokens();
    await unregisterPushToken().catch(() => {});
    if (t?.refreshToken) await api.logout(t.refreshToken).catch(() => {});
    await setTokens(null);
    qc.clear();
  }, [qc]);

  const requireAuth = useCallback((action?: () => void) => {
    if (statusRef.current === 'authed') {
      action?.();
      return true;
    }
    setPrompt(true);
    return false;
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      isAuthed: status === 'authed',
      me: status === 'authed' ? meQuery.data : undefined,
      signIn,
      logout,
      refetchMe: () => void meQuery.refetch(),
      requireAuth,
    }),
    [status, meQuery.data, meQuery.refetch, signIn, logout, requireAuth],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <LoginPromptSheet visible={prompt} onClose={() => setPrompt(false)} />
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
};
