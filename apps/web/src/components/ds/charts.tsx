'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ─────────────────────────── BarcodeSpark ─────────────────────────── */

/**
 * 24–32 thin vertical bars (2px, gap 3px). Historic bars `subtle` scaled to their value; the most recent
 * `highlight` bars are `ink` at full height — reads as a barcode. Each bar exposes its value on hover/focus via title.
 */
export function BarcodeSpark({
  values, highlight = 8, height = 40, label, className, format = String, inverse,
}: { values: number[]; highlight?: number; height?: number; label: string; className?: string; format?: (n: number) => string; /** on ink surfaces */ inverse?: boolean }) {
  const data = values.length ? values.slice(-32) : Array.from({ length: 24 }, () => 0);
  const max = Math.max(1, ...data);
  const cut = data.length - Math.min(highlight, data.length);
  return (
    <div role="img" aria-label={label} className={cn('flex shrink-0 items-end gap-[3px]', className)} style={{ height }}>
      {data.map((v, i) => {
        const recent = i >= cut;
        const h = recent ? 100 : Math.max(22, (v / max) * 62);
        return <span key={i} title={format(v)} className={cn('w-[2px] rounded-full', inverse ? (recent ? 'bg-on-ink' : 'bg-on-ink/35') : recent ? 'bg-ink' : 'bg-subtle')} style={{ height: `${h}%` }} />;
      })}
    </div>
  );
}

/* ─────────────────────────── SplitMeter ─────────────────────────── */

export interface SplitSide { label: string; value: ReactNode; amount: number }

/**
 * Two metrics side by side; below a 16px pill track: left part `ink`, right part `accent`, the remainder (up to
 * `capacity`) hatched. Both values are always printed above the bar (the peach segment never carries meaning alone).
 */
export function SplitMeter({ left, right, capacity, className }: { left: SplitSide; right: SplitSide; capacity?: number; className?: string }) {
  const total = Math.max(capacity ?? 0, left.amount + right.amount, 1);
  const lp = (left.amount / total) * 100;
  const rp = (right.amount / total) * 100;
  return (
    <div className={cn('w-full', className)}>
      <div className="grid grid-cols-2">
        {[left, right].map((s, i) => (
          <div key={i} className="border-l border-subtle/70 pl-4 pb-3">
            <div className="text-label font-normal text-ink-secondary">{s.label}</div>
            <div className="mt-1">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-pill" role="img" aria-label={`${left.label}: ${left.amount}, ${right.label}: ${right.amount}`}>
        {lp > 0 && <span className="h-full rounded-pill bg-ink" style={{ width: `${lp}%` }} />}
        {rp > 0 && <span className="h-full rounded-pill bg-accent" style={{ width: `${rp}%` }} />}
        <span className="hatch h-full flex-1 rounded-pill" />
      </div>
    </div>
  );
}

/* ─────────────────────────── Meter (hatched progress) ─────────────────────────── */

/** Single usage meter: ink fill, hatched remainder. `total = -1` → unlimited. */
export function Meter({ label, used, total, valueText, className }: { label: string; used: number; total: number; valueText?: string; className?: string }) {
  const unlimited = total === -1;
  const pct = unlimited ? 12 : total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-label">
        <span className="font-normal text-ink-secondary">{label}</span>
        <span className="tabular font-medium">{valueText ?? (unlimited ? `${used} / ∞` : `${used} / ${total}`)}</span>
      </div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-pill" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={unlimited ? undefined : total}>
        {pct > 0 && <span className={cn('h-full rounded-pill', pct > 90 && !unlimited ? 'bg-danger' : 'bg-ink')} style={{ width: `${pct}%` }} />}
        <span className="hatch h-full flex-1 rounded-pill" />
      </div>
    </div>
  );
}

/* ─────────────────────────── PillBarChart ─────────────────────────── */

export interface PillBar { key: string; label: string; value: number; tag?: string; title?: string; /** optional caption above the bar (name · value) */ heading?: ReactNode }

/**
 * Horizontal bars: white pill track carrying the value label inside on the left; the filled part ends in a black
 * pill holding the delta tag ("+10%"). Recessive x-axis (11px muted) and hairline vertical grid lines.
 */
export function PillBarChart({ rows, max, ticks = 6, className, axisFormat = (n: number) => String(Math.round(n)), ariaLabel }: { rows: PillBar[]; max?: number; ticks?: number; className?: string; axisFormat?: (n: number) => string; ariaLabel: string }) {
  const top = niceMax(max ?? Math.max(1, ...rows.map((r) => r.value)));
  const steps = Array.from({ length: ticks + 1 }, (_, i) => (top / ticks) * i);
  return (
    <figure className={cn('w-full', className)} aria-label={ariaLabel}>
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 flex justify-between" aria-hidden>
          {steps.map((s) => (
            <span key={s} className="w-px bg-hairline" />
          ))}
        </div>
        <ul className="relative flex flex-col gap-3 py-1">
          {rows.map((r) => {
            const pct = Math.max(18, Math.min(100, (r.value / top) * 100));
            return (
              <li key={r.key} className="group relative" title={r.title ?? `${r.label}${r.tag ? ` · ${r.tag}` : ''}`}>
                {r.heading && <div className="relative mb-1 flex justify-between gap-2 text-caption text-ink-secondary">{r.heading}</div>}
                <div className="flex h-8 items-center justify-between rounded-pill bg-surface-raised pl-3 shadow-pill transition-[width] duration-300" style={{ width: `${pct}%` }} tabIndex={0} aria-label={r.title ?? `${r.label}${r.tag ? `, ${r.tag}` : ''}`}>
                  <span className="truncate pr-2 text-[11.5px] font-medium text-ink-secondary">{r.label}</span>
                  <span className="flex h-full min-w-14 items-center justify-center rounded-pill bg-ink px-3 text-[11.5px] font-medium text-on-ink">{r.tag ?? ''}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="tabular relative mt-2 h-4 text-[11px] text-muted" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s}
            className={cn('absolute top-0 whitespace-nowrap', i === 0 ? 'left-0' : i === steps.length - 1 ? 'right-0' : '-translate-x-1/2')}
            style={i === 0 || i === steps.length - 1 ? undefined : { left: `${(i / ticks) * 100}%` }}
          >
            {axisFormat(s)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function niceMax(n: number) {
  if (n <= 6) return 6;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= n) return m * mag;
  return 10 * mag;
}

/* ─────────────────────────── ColumnChart ─────────────────────────── */

export interface ColumnDatum { label: string; value: number; extra?: string }

/**
 * Single-series daily column chart: thin rounded ink columns (older ones `subtle`), hairline gridlines, per-column
 * hover/focus tooltip and a table alternative.
 */
export function ColumnChart({ data, valueLabel, tableLabel, chartLabel, height = 180, highlight = 7, title }: { data: ColumnDatum[]; valueLabel: string; tableLabel: string; chartLabel: string; height?: number; highlight?: number; title?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const top = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const ticks = [0, top / 2, top];
  const h = hover != null ? data[hover] : null;
  return (
    <figure aria-labelledby={title ? id : undefined}>
      <div className="mb-3 flex items-center justify-between gap-2">
        {title ? <figcaption id={id} className="text-label font-normal text-muted">{title}</figcaption> : <span />}
        <button type="button" className="rounded-pill px-3 py-1.5 text-caption font-medium text-ink-secondary hover:bg-pill" onClick={() => setTable((v) => !v)}>
          {table ? chartLabel : tableLabel}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-md bg-surface-raised">
          <table className="w-full text-label">
            <thead className="text-left text-caption text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 text-right font-medium">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t border-hairline">
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {d.value}
                    {d.extra ? <span className="ml-2 text-caption text-muted">{d.extra}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative flex gap-3">
          <div className="tabular flex flex-col justify-between text-right text-[11px] text-muted" style={{ height }} aria-hidden>
            {[...ticks].reverse().map((t) => (
              <span key={t} className="leading-none">{Math.round(t)}</span>
            ))}
          </div>
          <div className="relative flex-1" style={{ height }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-hairline" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end justify-between gap-[3px]">
              {data.map((d, i) => (
                <button
                  key={d.label + i}
                  type="button"
                  aria-label={`${d.label}: ${d.value} ${valueLabel}${d.extra ? `, ${d.extra}` : ''}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="relative flex h-full max-w-6 flex-1 items-end justify-center"
                >
                  <span
                    className={cn('w-full max-w-[10px] rounded-t-[4px] rounded-b-[1px] transition-opacity', i >= data.length - highlight ? 'bg-ink' : 'bg-subtle', hover != null && hover !== i && 'opacity-40')}
                    style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 3 : 0 }}
                  />
                </button>
              ))}
            </div>
            {h && (
              <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-3 py-2 text-caption text-on-ink shadow-raised" style={{ left: `${((hover! + 0.5) / data.length) * 100}%` }}>
                <div className="font-medium">{h.label}</div>
                <div>
                  {h.value} {valueLabel}
                </div>
                {h.extra && <div className="opacity-70">{h.extra}</div>}
              </div>
            )}
          </div>
        </div>
      )}
      {!table && data.length > 0 && (
        <div className="mt-2 flex justify-between pl-8 text-[11px] text-muted" aria-hidden>
          <span>{data[0]!.label}</span>
          <span>{data[data.length - 1]!.label}</span>
        </div>
      )}
    </figure>
  );
}
