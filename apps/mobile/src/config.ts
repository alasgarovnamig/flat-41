import Constants from 'expo-constants';
import { API_PREFIX } from '@evtap/shared';

type Extra = { apiUrl?: string; webUrl?: string; eas?: { projectId?: string } };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** API origin, e.g. http://localhost:4000 (Android emulator: http://10.0.2.2:4000). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:4000').replace(/\/+$/, '');
export const API_BASE = `${API_URL}${API_PREFIX}`;
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? extra.webUrl ?? 'https://evtap.az').replace(/\/+$/, '');
export const EAS_PROJECT_ID = extra.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
export const IS_DEV = __DEV__;

/** Uploads may come back as relative paths (`/uploads/..`) when the API uses local storage. */
export const absUrl = (u: string | null | undefined): string | undefined => {
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('file:')) return u;
  return `${API_URL}${u.startsWith('/') ? '' : '/'}${u}`;
};

export const listingWebUrl = (id: string) => `${WEB_URL}/listing/${id}`;
