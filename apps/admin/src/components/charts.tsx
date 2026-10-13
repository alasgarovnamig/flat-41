import { useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { useT } from '../i18n';
import { fmtDate } from '../lib/format';
import { EmptyState, ErrorState, Skeleton, cx } from './ui';

export type Series = { key: string; label: string; color: string };

/** HTML legend: swatch carries identity, text stays in text tokens. */
export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipEntry = { dataKey?: unknown; value?: unknown; color?: string; payload?: Record<string, unknown> };

/** Recharts custom tooltip: date header, one row per series (largest first), optional total. */
export function makeTooltip(series: Series[], format: (v: number) => string, totalLabel?: string) {
  return function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: unknown }) {
    if (!active || !payload?.length) return null;
    const rows = series
      .map((s) => ({ s, v: Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0) }))
      .sort((a, b) => b.v - a.v);
    const total = rows.reduce((acc, r) => acc + r.v, 0);
    return (
      <div className="min-w-44 rounded-lg border border-line bg-elevated px-3 py-2 text-xs shadow-lg">
        <p className="mb-1.5 font-medium text-fg">{fmtDate(String(label))}</p>
        {rows.filter((r, i) => r.v !== 0 || (i === 0 && rows.every((x) => x.v === 0))).map(({ s, v }) => (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-medium text-fg tabular-nums">{format(v)}</span>
          </div>
        ))}
        {totalLabel && series.length > 1 && (
          <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1 font-medium text-fg">
            <span>{totalLabel}</span>
            <span className="tabular-nums">{format(total)}</span>
          </div>
        )}
      </div>
    );
  };
}

/** Card with a chart ⇄ table toggle (the table is the accessible view of the same data). */
export function ChartCard({
  title,
  subtitle,
  series,
  data,
  loading,
  error,
  onRetry,
  format,
  children,
  height = 260,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  series: Series[];
  data: Record<string, unknown>[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  format: (v: number) => string;
  children: ReactNode;
  height?: number;
}) {
  const { t } = useT();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-card p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex rounded-lg bg-hover p-0.5" role="group" aria-label={t('View')}>
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              title={v === 'chart' ? t('Chart') : t('Table')}
              className={cx('rounded-md p-1.5', view === v ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg')}
            >
              {v === 'chart' ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
            </button>
          ))}
        </div>
      </header>
      {series.length > 1 && !error && (
        <div className="mb-2">
          <ChartLegend series={series} />
        </div>
      )}
      <div style={{ minHeight: height }} className="flex flex-col">
        {loading ? (
          <Skeleton className="w-full flex-1" />
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : !data?.length ? (
          <EmptyState title={t('No data for this period')} />
        ) : view === 'chart' ? (
          <div style={{ height }}>{children}</div>
        ) : (
          <div className="max-h-[300px] overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-hover text-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">{t('Date')}</th>
                  {series.map((s) => (
                    <th key={s.key} className="px-2 py-1.5 text-right font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1">{fmtDate(String(row.date))}</td>
                    {series.map((s) => (
                      <td key={s.key} className="px-2 py-1 text-right tabular-nums">
                        {format(Number(row[s.key] ?? 0))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
