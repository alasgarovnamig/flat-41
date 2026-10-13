const trim = (s: string) => s.replace(/\/+$/, '');

/** Public API origin (browser). */
export const API_URL = trim(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
/** Public site origin, used for canonical URLs, OG tags and payment returnUrl. */
export const WEB_URL = trim(process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000');
/** API origin used by the Next.js server during SSR (may differ inside docker). */
export const SERVER_API_URL = trim(process.env.API_INTERNAL_URL || API_URL);

export const IS_DEV = process.env.NODE_ENV !== 'production';

/** Resolve an image URL returned by the API (may be relative like `/uploads/…`). */
export const assetUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};
