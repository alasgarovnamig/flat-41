'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface BarDatum { label: string; value: number; extra?: string }

/**
 * Single-series daily bar chart (one hue, one axis). Thin rounded bars with 2px gaps,
 * recessive gridlines, per-bar hover/focus tooltip and a table alternative.
 */
export function BarChart({ data, title, valueLabel, tableLabel, chartLabel, height = 180 }: { data: BarDatum[]; title: string; valueLabel: string; tableLabel: string; chartLabel: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = Math.ceil(max / 4) * 4 || 4;
  const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice];
  const h = hover != null ? data[hover] : null;

  return (
    <figure className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setTable((v) => !v)}>
          {table ? chartLabel : tableLabel}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">#</th>
                <th className="py-1 text-right font-medium">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t border-line">
                  <td className="py-1">{d.label}</td>
                  <td className="py-1 text-right tabular-nums">
                    {d.value}
                    {d.extra ? <span className="ml-2 text-xs text-muted">{d.extra}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative flex gap-2">
          <div className="flex flex-col justify-between text-right text-[10px] tabular-nums text-muted" style={{ height }}>
            {[...ticks].reverse().map((t) => (
              <span key={t} className="leading-none">{t}</span>
            ))}
          </div>
          <div className="relative flex-1" style={{ height }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-line/70" style={{ bottom: `${(t / nice) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end" style={{ gap: 2 }}>
              {data.map((d, i) => (
                <button
                  key={d.label}
                  type="button"
                  aria-label={`${d.label}: ${d.value} ${valueLabel}${d.extra ? `, ${d.extra}` : ''}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full flex-1 items-end"
                >
                  <span
                    className={cn('w-full rounded-t-[4px] bg-brand transition-opacity', hover != null && hover !== i && 'opacity-40')}
                    style={{ height: `${(d.value / nice) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                  />
                </button>
              ))}
            </div>
            {h && (
              <div
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg"
                style={{ left: `${((hover! + 0.5) / data.length) * 100}%` }}
              >
                <div className="font-semibold">{h.label}</div>
                <div>
                  {h.value} {valueLabel}
                </div>
                {h.extra && <div className="text-white/70">{h.extra}</div>}
              </div>
            )}
          </div>
        </div>
      )}
      {!table && data.length > 0 && (
        <div className="mt-1 flex justify-between pl-6 text-[10px] text-muted">
          <span>{data[0]!.label}</span>
          <span>{data[data.length - 1]!.label}</span>
        </div>
      )}
    </figure>
  );
}

export function StatTile({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      {icon && <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">{icon}</div>}
      <div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}
