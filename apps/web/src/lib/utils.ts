import type { ListingCard, Locale } from '@evtap/shared';
import { getCity, getDistrict, getMetro, localized } from '@evtap/shared';

/**
 * Utility groups where a later class must replace an earlier one with the same variant prefix
 * (e.g. a component's base `inline-flex` vs. a caller's `hidden lg:inline-flex`, or `relative` vs. `absolute`).
 * Tailwind orders same-property utilities by its own rules, not by class order, so DS components resolve it here.
 */
const GROUPS: [RegExp, string][] = [
  [/^(hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table-cell)$/, 'display'],
  [/^(static|relative|absolute|fixed|sticky)$/, 'position'],
  [/^px-/, 'px'],
  [/^py-/, 'py'],
  [/^p-/, 'p'],
  [/^h-/, 'h'],
  [/^w-/, 'w'],
  [/^min-w-/, 'min-w'],
  [/^rounded(-(xs|sm|md|lg|xl|frame|pill|full|none))?$/, 'rounded'],
  [/^bg-(?!gradient|clip|cover|contain|center|no-repeat|\[(linear|radial))/, 'bg'],
  [/^justify-(start|end|center|between|around|evenly)$/, 'justify'],
];

/** Join class names; for the groups above the last class (per variant prefix) wins. */
export function cn(...c: (string | false | null | undefined | 0)[]) {
  const tokens = c.filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
  const seen = new Map<string, number>();
  const out: (string | null)[] = [];
  for (const tok of tokens) {
    const i = tok.lastIndexOf(':');
    const variant = i >= 0 && !tok.slice(0, i).includes('[') ? tok.slice(0, i + 1) : '';
    const base = tok.slice(variant.length).replace(/^!/, '');
    const group = GROUPS.find(([re]) => re.test(base))?.[1];
    if (group) {
      const key = variant + group;
      const prev = seen.get(key);
      if (prev !== undefined) out[prev] = null;
      seen.set(key, out.length);
    }
    out.push(tok);
  }
  return out.filter(Boolean).join(' ');
}

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
