'use client';

import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from './icons';

export function pageWindow(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

export function Pagination({ page, total, pageSize, onChange, className }: { page: number; total: number; pageSize: number; onChange: (p: number) => void; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const btn = 'flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors';
  return (
    <nav className={cn('flex flex-wrap items-center justify-center gap-1.5', className)} aria-label="Pagination">
      <button type="button" className={cn(btn, 'border border-line bg-white hover:bg-surface disabled:opacity-40')} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
        <ChevronLeft size={18} />
      </button>
      {pageWindow(page, pages).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1 text-muted">
            …
          </span>
        ) : (
          <button
            type="button"
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(btn, p === page ? 'bg-brand text-white' : 'border border-line bg-white hover:bg-surface')}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className={cn(btn, 'border border-line bg-white hover:bg-surface disabled:opacity-40')} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
