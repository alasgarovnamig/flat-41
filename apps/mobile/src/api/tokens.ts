import type { AuthResponse, AuthTokens } from '@evtap/shared';
import { API_BASE } from '../config';
import { storage, KEYS } from '../lib/storage';

/**
 * Token store: in-memory copy backed by expo-secure-store (Keychain / Keystore).
 * Refresh is single-flight: concurrent 401s share one POST /auth/refresh.
 */
type Stored = Pick<AuthTokens, 'accessToken' | 'refreshToken'>;

let tokens: Stored | null = null;
let loaded: Promise<void> | null = null;
const listeners = new Set<(t: Stored | null) => void>();

export const loadTokens = () =>
  (loaded ??= storage.getJSON<Stored>(KEYS.tokens).then((t) => {
    tokens = t;
  }));

export const getTokens = () => tokens;

export async function setTokens(t: Stored | null) {
  tokens = t ? { accessToken: t.accessToken, refreshToken: t.refreshToken } : null;
  if (tokens) await storage.setJSON(KEYS.tokens, tokens);
  else await storage.remove(KEYS.tokens);
  listeners.forEach((l) => l(tokens));
}

export const onTokensChange = (fn: (t: Stored | null) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

let refreshing: Promise<boolean> | null = null;

/** Returns true when new tokens were obtained. On a definitive failure the tokens are cleared (→ logout). */
export function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;
  const current = tokens;
  if (!current?.refreshToken) return Promise.resolve(false);
  refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (res.ok) {
        const data = (await res.json()) as AuthResponse;
        await setTokens(data);
        return true;
      }
      // 400/401/403 → refresh token invalid / reused → logout. 5xx → keep tokens, fail this request only.
      if (res.status < 500) await setTokens(null);
      return false;
    } catch {
      return false; // network error: keep the session
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
