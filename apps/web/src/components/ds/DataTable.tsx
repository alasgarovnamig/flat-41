'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from './Card';
import { Skeleton } from './feedback';
import { Img } from './media';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** hide the column below this breakpoint (the mobile card shows the essentials) */
  minWidth?: 'md' | 'lg' | 'xl';
}

const HIDE = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' } as const;

/**
 * Table inside a Card: 12px muted header, no vertical lines, 64px rows with 48px rounded thumbnails, status pills and
 * a trailing action icon button; hovered row = `surfaceSunken`. Below `md` rows render as stacked cards (`mobileRow`).
 */
export function DataTable<T>({
  columns, rows, rowKey, loading, empty, toolbar, caption, mobileRow, className, skeletonRows = 4, footer, bare,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (r: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  toolbar?: ReactNode;
  caption?: string;
  mobileRow?: (r: T) => ReactNode;
  className?: string;
  skeletonRows?: number;
  footer?: ReactNode;
  /** render without the surrounding card */
  bare?: boolean;
}) {
  const body = (
    <>
      {toolbar && <div className="mb-3 flex flex-wrap items-center gap-2">{toolbar}</div>}
      {loading ? (
        <div className="flex flex-col gap-2 pt-2">
          {Array.from({ length: skeletonRows }, (_, i) => (
            <div key={i} className="flex h-16 items-center gap-3 px-2">
              <Skeleton className="h-12 w-12 rounded-sm" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3 rounded-pill" />
                <Skeleton className="h-3 w-1/4 rounded-pill" />
              </div>
              <Skeleton className="hidden h-8 w-24 rounded-pill md:block" />
            </div>
          ))}
        </div>
      ) : !rows?.length ? (
        empty
      ) : (
        <>
          <div className={cn(mobileRow && 'hidden md:block', 'overflow-x-auto')}>
            <table className="w-full border-separate border-spacing-0 text-[14px]">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={cn('whitespace-nowrap px-3 pb-3 pt-1 text-caption font-normal text-muted', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', c.minWidth && HIDE[c.minWidth], c.className)}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={rowKey(r)} className="group">
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          'h-16 px-3 py-2 align-middle transition-colors group-hover:bg-surface-sunken',
                          i === 0 && 'rounded-l-md',
                          i === columns.length - 1 && 'rounded-r-md',
                          c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                          c.minWidth && HIDE[c.minWidth],
                          c.className,
                        )}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mobileRow && <ul className="flex flex-col gap-2 md:hidden">{rows.map((r) => <li key={rowKey(r)}>{mobileRow(r)}</li>)}</ul>}
        </>
      )}
      {footer}
    </>
  );
  if (bare) return <div className={className}>{body}</div>;
  return <Card className={cn('px-3 pb-3 pt-4 sm:px-4 sm:pt-5', className)}>{body}</Card>;
}

/** 48px rounded thumbnail + title + sub (first table column). */
export function TableThumb({ src, title, sub, href, alt }: { src: string | null | undefined; title: ReactNode; sub?: ReactNode; href?: string; alt?: string }) {
  const img = (
    <span className="relative block h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-sunken">
      <Img src={src} alt={alt ?? ''} fill sizes="48px" className="object-cover" />
    </span>
  );
  const text = (
    <span className="min-w-0">
      <span className="block truncate font-medium text-ink">{title}</span>
      {sub && <span className="block truncate text-caption text-muted">{sub}</span>}
    </span>
  );
  return href ? (
    <Link href={href} className="flex min-w-0 max-w-[22rem] items-center gap-3 hover:underline hover:underline-offset-2">
      {img}
      {text}
    </Link>
  ) : (
    <span className="flex min-w-0 max-w-[22rem] items-center gap-3">
      {img}
      {text}
    </span>
  );
}

/** Mobile row card used by DataTable's `mobileRow`. */
export function RowCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg bg-surface-raised p-3 shadow-pill', className)}>{children}</div>;
}
