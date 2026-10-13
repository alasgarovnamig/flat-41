import type { AuthTokens } from '@evtap/shared';

const KEY = 'evtap.auth';

interface Stored {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

type Listener = (hasTokens: boolean) => void;
const listeners = new Set<Listener>();
let memory: Stored | null | undefined;

const isBrowser = () => typeof window !== 'undefined';

/** Non-sensitive marker cookie so the server knows a user *may* be logged in (tokens stay in localStorage). */
export const AUTH_HINT_COOKIE = 'evtap_session';
function setHint(on: boolean) {
  try {
    document.cookie = on ? `${AUTH_HINT_COOKIE}=1; path=/; max-age=2592000; samesite=lax` : `${AUTH_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    /* ignore */
  }
}

function read(): Stored | null {
  if (!isBrowser()) return null;
  if (memory !== undefined) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    memory = null;
  }
  return memory;
}

function emit() {
  const has = !!memory;
  listeners.forEach((l) => l(has));
}

export const tokenStore = {
  get access() {
    return read()?.accessToken ?? null;
  },
  get refresh() {
    return read()?.refreshToken ?? null;
  },
  set(t: AuthTokens) {
    memory = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(memory));
    } catch {
      /* storage may be unavailable (private mode) — keep in memory */
    }
    setHint(true);
    emit();
  },
  clear() {
    memory = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setHint(false);
    emit();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

// Keep tabs in sync: login / logout in another tab.
if (isBrowser()) {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    memory = undefined;
    read();
    emit();
  });
}
