import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Key/value storage. Native: Keychain / Android Keystore via expo-secure-store.
 * Web (only used for screenshots / previews): localStorage.
 */
const web = Platform.OS === 'web';

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (web) return globalThis.localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (web) globalThis.localStorage?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      /* ignore */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (web) globalThis.localStorage?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  },
  async getJSON<T>(key: string): Promise<T | null> {
    const v = await storage.get(key);
    if (!v) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  },
  setJSON(key: string, value: unknown) {
    return storage.set(key, JSON.stringify(value));
  },
};

export const KEYS = {
  tokens: 'evtap.tokens',
  locale: 'evtap.locale',
  theme: 'evtap.theme',
  push: 'evtap.push', // { enabled: boolean, token?: string }
  recentSearches: 'evtap.recentSearches',
} as const;
