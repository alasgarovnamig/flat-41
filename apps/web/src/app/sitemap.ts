import type { MetadataRoute } from 'next';
import { CITIES, DEAL_TYPES, LOCALES } from '@evtap/shared';
import { api } from '@/lib/api';
import { WEB_URL } from '@/lib/config';

export const revalidate = 3600;

// Next writes <loc> values verbatim, so XML-escape query strings ourselves.
const xml = (s: string) => s.replace(/&/g, '&amp;');
const alt = (path: string) => ({ languages: Object.fromEntries(LOCALES.map((l) => [l, xml(`${WEB_URL}/${l}${path}`)])) });

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];
  const add = (path: string, priority: number, changeFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly', lastModified: Date = now) => {
    for (const l of LOCALES) entries.push({ url: xml(`${WEB_URL}/${l}${path}`), lastModified, changeFrequency, priority, alternates: alt(path) });
  };

  add('', 1, 'hourly');
  add('/business', 0.6, 'monthly');
  add('/agencies', 0.6, 'daily');
  for (const p of ['about', 'terms', 'privacy', 'help', 'pricing-info']) add(`/pages/${p}`, 0.3, 'monthly');
  for (const d of DEAL_TYPES) {
    add(`/search?dealType=${d}`, 0.8, 'hourly');
    for (const c of CITIES.filter((x) => x.popular)) add(`/search?dealType=${d}&cityId=${c.id}`, 0.7, 'daily');
  }

  // listings & agencies (best effort — the sitemap still renders when the API is down)
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await api.listings.search({ page, pageSize: 60, sort: 'date_desc' });
      for (const l of r.items) add(`/listings/${l.id}`, 0.9, 'daily', new Date(l.bumpedAt || l.createdAt));
      if (page * 60 >= r.total) break;
    }
  } catch {
    /* API unavailable */
  }
  try {
    const r = await api.agencies.list({ page: 1, pageSize: 100 });
    for (const a of r.items) add(`/agencies/${a.slug}`, 0.5, 'weekly');
  } catch {
    /* API unavailable */
  }
  return entries;
}
