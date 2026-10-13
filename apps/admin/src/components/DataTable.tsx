import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { useT } from '../i18n';
import { EmptyState, ErrorState, Skeleton, cx } from './ui';

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Enables click-to-sort (applies to the loaded page; the API has no sort params). */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide on narrow screens (tablet). */
  hideBelow?: 'md' | 'lg' | 'xl' | '2xl';
};

export type Pagination = { page: number; pageSize: number; total: number; onPage: (p: number) => void };

const HIDE = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell', '2xl': 'hidden 2xl:table-cell' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  onRowClick,
  selectedKey,
  empty,
  pagination,
  skeletonRows = 8,
  dense,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
  pagination?: Pagination;
  skeletonRows?: number;
  dense?: boolean;
}) {
  const { t } = useT();
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const val = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const cellPad = dense ? 'px-3 py-2' : 'px-3 py-3 first:pl-4 last:pr-4';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-hover/60 text-left text-xs font-medium text-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cx(cellPad, 'font-medium whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideBelow && HIDE[c.hideBelow], c.className)}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortValue ? (
                    <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggleSort(c.key)}>
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cx(cellPad, c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton className={i % 2 ? 'w-3/4' : 'w-1/2'} />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              !error &&
              sorted?.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                    className={cx(
                      'border-b border-line last:border-0',
                      onRowClick && 'cursor-pointer hover:bg-hover focus:bg-hover focus:outline-none',
                      selectedKey === key && 'bg-brand-soft/60',
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cx(cellPad, 'align-middle', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.hideBelow && HIDE[c.hideBelow], c.className)}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {!loading && error != null && <ErrorState error={error} onRetry={onRetry} />}
      {!loading && !error && sorted && sorted.length === 0 && (empty ?? <EmptyState title={t('No results')} hint={t('Try changing the filters.')} />)}
      {pagination && !error && <PaginationBar {...pagination} />}
    </div>
  );
}

export function PaginationBar({ page, pageSize, total, onPage }: Pagination) {
  const { t } = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nums = pageNumbers(page, pages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px] text-muted">
      <span>{t('{from}–{to} of {total}', { from, to, total })}</span>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)} label={t('Previous page')}>
          <ChevronLeft className="size-4" />
        </PageBtn>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="px-1">
              …
            </span>
          ) : (
            <PageBtn key={n} active={n === page} onClick={() => onPage(n)} label={String(n)}>
              {n}
            </PageBtn>
          ),
        )}
        <PageBtn disabled={page >= pages} onClick={() => onPage(page + 1)} label={t('Next page')}>
          <ChevronRight className="size-4" />
        </PageBtn>
      </nav>
    </div>
  );
}

function PageBtn({ children, onClick, disabled, active, label }: { children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 tabular-nums disabled:opacity-40',
        active ? 'bg-brand text-white' : 'hover:bg-hover hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function pageNumbers(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}
