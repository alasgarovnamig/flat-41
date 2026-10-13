/** Small helpers turning API lists into chart series (BarcodeSpark / PillBarChart). */
import { addDays, toIso } from './utils';

/** Count items per day for the last `days` days (oldest → newest). */
export function dailyCounts(dates: (string | null | undefined)[], days = 28): number[] {
  const today = toIso(new Date());
  const keys = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const d of dates) {
    if (!d) continue;
    const i = idx.get(toIso(new Date(d)));
    if (i !== undefined) out[i]! += 1;
  }
  return out;
}

/** Percentage change between the sum of the last `window` values and the window before it ("+12%"). */
export function deltaTag(values: number[], window = 7): string | undefined {
  if (values.length < window * 2) return undefined;
  const cur = values.slice(-window).reduce((a, b) => a + b, 0);
  const prev = values.slice(-window * 2, -window).reduce((a, b) => a + b, 0);
  if (!prev && !cur) return '0%';
  if (!prev) return '+100%';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

/** Sum several equal-length series. */
export const sumSeries = (list: number[][]) => (list.length ? list[0]!.map((_, i) => list.reduce((s, l) => s + (l[i] ?? 0), 0)) : []);
