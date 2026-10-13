import { API_PREFIX } from '@evtap/shared';

const trim = (s: string) => s.replace(/\/+$/, '');

export const API_URL = trim(import.meta.env.VITE_API_URL || 'http://localhost:4000');
export const API_BASE = API_URL + API_PREFIX;
export const WEB_URL = trim(import.meta.env.VITE_WEB_URL || 'http://localhost:3000');
/** Dev-only fixture mode (fetch interceptor), never active in production builds. */
export const MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1';

export const listingSiteUrl = (id: string) => `${WEB_URL}/az/listings/${id}`;
