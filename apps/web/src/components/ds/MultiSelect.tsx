'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { CheckIcon, ChevronDown, SearchIcon } from './icons';

export interface Option { value: string; label: string; hint?: ReactNode }

export function MultiSelect({ label, placeholder, options, value, onChange, disabled, searchable = true }: { label?: string; placeholder: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; searchable?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const filtered = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q]);
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const summary = selectedLabels.length === 0 ? placeholder : selectedLabels.length <= 2 ? selectedLabels.join(', ') : t('common.selectedCount', { count: selectedLabels.length });

  return (
    <div className="flex flex-col gap-1.5" ref={ref}>
      {label && <span className="text-label text-ink-secondary">{label}</span>}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label ?? placeholder}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex h-12 w-full items-center justify-between gap-2 rounded-md border border-hairline bg-surface-raised px-4 text-left text-body hover:border-subtle disabled:bg-surface-sunken disabled:text-muted',
            open && 'border-ink ring-2 ring-ink/20',
          )}
        >
          <span className={cn('truncate', selectedLabels.length === 0 && 'text-muted')}>{summary}</span>
          <ChevronDown size={16} className="shrink-0 text-muted" />
        </button>
        {open && (
          <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-lg bg-surface-raised shadow-raised ring-1 ring-hairline animate-in">
            {searchable && options.length > 8 && (
              <div className="relative border-b border-hairline p-2">
                <SearchIcon size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} aria-label={t('common.search')} className="h-10 w-full rounded-pill bg-surface-sunken pl-9 pr-3 text-[14px] outline-none focus:ring-2 focus:ring-ink/20" />
              </div>
            )}
            <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1.5">
              {filtered.map((o) => {
                const on = value.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                      className="flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 text-left text-[14px] hover:bg-surface-sunken"
                    >
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border', on ? 'border-ink bg-ink text-on-ink' : 'border-subtle')}>
                        {on && <CheckIcon size={12} strokeWidth={2.6} />}
                      </span>
                      <span className="flex-1">{o.label}</span>
                      {o.hint}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="px-3 py-3 text-label text-muted">{t('common.noOptions')}</li>}
            </ul>
            {value.length > 0 && (
              <div className="flex justify-between border-t border-hairline px-3 py-2">
                <button type="button" className="h-9 rounded-pill px-3 text-label font-medium text-ink-secondary hover:bg-pill" onClick={() => onChange([])}>
                  {t('common.clear')}
                </button>
                <button type="button" className="h-9 rounded-pill bg-ink px-4 text-label font-medium text-on-ink" onClick={() => setOpen(false)}>
                  {t('common.done')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
