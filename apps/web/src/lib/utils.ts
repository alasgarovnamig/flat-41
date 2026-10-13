import type { ListingCard, Locale } from '@evtap/shared';
import { getCity, getDistrict, getMetro, localized } from '@evtap/shared';

export const cn = (...c: (string | false | null | undefined | 0)[]) => c.filter(Boolean).join(' ');

/** "Bakı, Nəsimi r., m. 28 May" */
export function locationLabel(l: Pick<ListingCard, 'cityId' | 'districtId' | 'metroId'>, locale: Locale, opts: { metro?: boolean } = {}) {
  const parts = [localized(getCity(l.cityId)?.name, locale)];
  if (l.districtId) parts.push(localized(getDistrict(l.districtId)?.name, locale));
  if (opts.metro !== false && l.metroId) {
    const m = getMetro(l.metroId);
    if (m) parts.push(`${locale === 'ru' ? 'м.' : 'm.'} ${localized(m.name, locale)}`);
  }
  return parts.filter(Boolean).join(', ');
}

export const todayIso = () => toIso(new Date());
export const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toIso(d);
};

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
