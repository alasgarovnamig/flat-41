'use client';

import Link from 'next/link';
import type { FormEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDown, ChevronLeft, ChevronRight, FilterIcon, SearchIcon } from './icons';
import { Popover } from './overlays';

/* ─────────────────────────── PillTabs ─────────────────────────── */

export interface PillTab<T extends string = string> { value: T; label: ReactNode; href?: string; count?: number }

const tabClass = (active: boolean, size: 'sm' | 'md') =>
  cn(
    'press inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill font-medium',
    size === 'md' ? 'h-11 px-5 text-[14px]' : 'h-9 px-4 text-label',
    active ? 'bg-ink text-on-ink' : 'bg-pill text-ink hover:bg-pill-hover',
  );

/** Pill tabs (active = black pill). Renders links when tabs have `href`, else buttons with role=tab. */
export function PillTabs<T extends string>({ tabs, value, onChange, className, size = 'md', ariaLabel, scroll = true }: { tabs: PillTab<T>[]; value: T; onChange?: (v: T) => void; className?: string; size?: 'sm' | 'md'; ariaLabel?: string; scroll?: boolean }) {
  const asLinks = tabs.every((t) => t.href);
  return (
    <div className={cn('flex gap-2', scroll && 'scrollbar-none -mx-1 overflow-x-auto px-1 py-0.5', className)} role={asLinks ? undefined : 'tablist'} aria-label={ariaLabel}>
      {tabs.map((t) => {
        const active = t.value === value;
        const content = (
          <>
            {t.label}
            {t.count !== undefined && <span className={cn('tabular rounded-pill px-1.5 text-[11px]', active ? 'bg-on-ink/20' : 'bg-surface-raised text-ink-secondary')}>{t.count}</span>}
          </>
        );
        return t.href ? (
          <Link key={t.value} href={t.href} aria-current={active ? 'page' : undefined} className={tabClass(active, size)}>
            {content}
          </Link>
        ) : (
          <button key={t.value} type="button" role="tab" aria-selected={active} onClick={() => onChange?.(t.value)} className={tabClass(active, size)}>
            {content}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── FilterPill ─────────────────────────── */

/**
 * 44px pill with leading line icon + label + chevron. Selected (has a value) = 1.5px ink outline. Opens a popover
 * with the filter control (`children`), or acts as a button when `onClick` is given.
 */
export function FilterPill({
  icon, label, value, active, children, onClick, align = 'left', tone = 'raised', width = 'w-80', className, labelClassName,
}: { icon?: ReactNode; label: string; value?: ReactNode; active?: boolean; children?: ReactNode | ((close: () => void) => ReactNode); onClick?: () => void; align?: 'left' | 'right'; tone?: 'raised' | 'pill'; width?: string; className?: string; labelClassName?: string }) {
  const cls = (open: boolean) =>
    cn(
      'press inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-pill pl-4 pr-3 text-[14px]',
      tone === 'raised' ? 'bg-surface-raised shadow-pill hover:bg-surface-sunken' : 'bg-pill hover:bg-pill-hover',
      (active || open) && 'ring-[1.5px] ring-inset ring-ink',
      className,
    );
  const inner = (open: boolean) => (
    <>
      {icon && <span className="text-ink-secondary">{icon}</span>}
      <span className={cn('text-ink', labelClassName)}>{label}</span>
      {value !== undefined && value !== null && value !== '' && (
        <span className="max-w-[10rem] truncate font-medium text-ink">
          <span className={labelClassName} aria-hidden>· </span>
          {value}
        </span>
      )}
      <ChevronDown size={16} className={cn('ml-1 text-ink-secondary transition-transform', open && 'rotate-180')} />
    </>
  );
  if (onClick || !children)
    return (
      <button type="button" className={cls(false)} onClick={onClick}>
        {inner(false)}
      </button>
    );
  return (
    <Popover
      align={align}
      width={width}
      panelClassName="p-4"
      trigger={({ open, toggle, id }) => (
        <button type="button" className={cls(open)} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" onClick={toggle}>
          {inner(open)}
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

/** A list of radio-like options inside a FilterPill popover. */
export function OptionList<T extends string>({ options, value, onSelect }: { options: { value: T; label: ReactNode }[]; value: T | null | undefined; onSelect: (v: T) => void }) {
  return (
    <ul role="listbox" className="-m-2 max-h-80 overflow-y-auto">
      {options.map((o) => (
        <li key={o.value}>
          <button type="button" role="option" aria-selected={value === o.value} onClick={() => onSelect(o.value)} className={cn('flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-[14px] hover:bg-surface-sunken', value === o.value && 'font-medium')}>
            {o.label}
            {value === o.value && <CheckIcon size={16} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────── SearchField ─────────────────────────── */

/** Pill search input (leading magnifier, `surfaceRaised`, 44px) + optional circular "sliders" filter button. */
export function SearchField({
  value, onChange, onSubmit, placeholder, label, onFilter, filterLabel, filterCount, className, size = 'md', submitLabel,
}: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string; label: string; onFilter?: () => void; filterLabel?: string; filterCount?: number; className?: string; size?: 'md' | 'lg'; submitLabel?: string }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <form role="search" onSubmit={submit} className={cn('flex items-center gap-2', className)}>
      <div className="relative min-w-0 flex-1">
        <SearchIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-secondary" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className={cn(
            'w-full rounded-pill bg-surface-raised pl-11 text-[14px] text-ink shadow-pill outline-none ring-1 ring-inset ring-transparent transition-shadow focus:ring-2 focus:ring-ink/25 [&::-webkit-search-cancel-button]:hidden',
            size === 'lg' ? 'h-13 pr-28' : 'h-11 pr-4',
            submitLabel && size !== 'lg' && 'pr-24',
          )}
        />
        {submitLabel && (
          <button type="submit" className="press absolute right-1.5 top-1/2 inline-flex h-8 -translate-y-1/2 items-center rounded-pill bg-ink px-4 text-label font-medium text-on-ink hover:bg-ink-secondary">
            {submitLabel}
          </button>
        )}
      </div>
      {onFilter && (
        <button type="button" onClick={onFilter} aria-label={filterLabel} title={filterLabel} className="press relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink shadow-pill hover:bg-surface-sunken">
          <FilterIcon size={18} />
          {!!filterCount && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-on-ink">{filterCount}</span>}
        </button>
      )}
    </form>
  );
}

/* ─────────────────────────── Pagination ─────────────────────────── */

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

export function Pagination({ page, total, pageSize, onChange, className, labels }: { page: number; total: number; pageSize: number; onChange: (p: number) => void; className?: string; labels?: { prev: string; next: string; nav: string } }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const btn = 'press flex h-11 min-w-11 items-center justify-center rounded-pill px-3 text-[14px] font-medium';
  return (
    <nav className={cn('flex flex-wrap items-center justify-center gap-1.5', className)} aria-label={labels?.nav ?? 'Pagination'}>
      <button type="button" className={cn(btn, 'bg-surface-raised shadow-pill hover:bg-surface-sunken disabled:opacity-40')} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={labels?.prev ?? 'Previous page'}>
        <ChevronLeft size={18} />
      </button>
      {pageWindow(page, pages).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1 text-muted" aria-hidden>
            …
          </span>
        ) : (
          <button type="button" key={p} onClick={() => onChange(p)} aria-current={p === page ? 'page' : undefined} className={cn(btn, 'tabular', p === page ? 'bg-ink text-on-ink' : 'bg-pill hover:bg-pill-hover')}>
            {p}
          </button>
        ),
      )}
      <button type="button" className={cn(btn, 'bg-surface-raised shadow-pill hover:bg-surface-sunken disabled:opacity-40')} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={labels?.next ?? 'Next page'}>
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}

/* ─────────────────────────── Stepper (pills) ─────────────────────────── */

export function PillStepper({ steps, current, done, onJump, ariaLabel }: { steps: { key: string; label: string }[]; current: number; done: Set<number>; onJump: (i: number) => void; ariaLabel: string }) {
  return (
    <ol className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5" aria-label={ariaLabel}>
      {steps.map((s, i) => {
        const isDone = done.has(i) && i !== current;
        const active = i === current;
        const reachable = i <= current || done.has(i - 1);
        return (
          <li key={s.key} className="shrink-0">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={!reachable}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'press inline-flex h-11 items-center gap-2 rounded-pill pl-1.5 pr-4 text-[14px] font-medium disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'bg-ink text-on-ink' : isDone ? 'bg-surface-raised text-ink shadow-pill' : 'bg-pill text-ink-secondary',
              )}
            >
              <span className={cn('tabular flex h-8 w-8 items-center justify-center rounded-full text-label', active ? 'bg-on-ink text-ink' : isDone ? 'bg-ink text-on-ink' : 'bg-surface-raised text-ink')}>
                {isDone ? <CheckIcon size={15} strokeWidth={2.2} /> : i + 1}
              </span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
