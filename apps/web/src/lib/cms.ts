import type { Locale } from '@evtap/shared';
import { API_PREFIX } from '@evtap/shared';
import { SERVER_API_URL } from './config';
import type { CmsPageLink } from './api';

/** Pages the site links to even when the CMS index (GET /pages) is unavailable. */
export const STATIC_PAGE_SLUGS = ['about', 'pricing-info', 'help', 'terms', 'privacy'] as const;
const LEGAL = /^(terms|privacy|cookies?|offer|rules)|polic|legal/;
export const isLegalSlug = (slug: string) => LEGAL.test(slug);
export const staticPageKey = (slug: string) => `footer.${slug === 'pricing-info' ? 'pricingInfo' : slug}`;

/**
 * Server-side fetch of the CMS page index (GET /pages?locale=…) for the footer / page navigation.
 * Short timeout + revalidation; returns null when the API has no index (callers fall back to STATIC_PAGE_SLUGS).
 */
export async function fetchPageLinks(locale: Locale): Promise<CmsPageLink[] | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}${API_PREFIX}/pages?locale=${locale}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return null;
    return data.filter((p): p is CmsPageLink => !!p && typeof p.slug === 'string' && typeof p.title === 'string');
  } catch {
    return null;
  }
}
