'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { CheckIcon, ChevronDown } from './icons';

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
      {label && <span className="text-sm font-medium">{label}</span>}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 text-left text-[15px] hover:border-ink/25 disabled:bg-surface disabled:text-muted',
            open && 'border-brand ring-2 ring-brand/15',
          )}
        >
          <span className={cn('truncate', selectedLabels.length === 0 && 'text-muted/80')}>{summary}</span>
          <ChevronDown size={16} className="shrink-0 text-muted" />
        </button>
        {open && (
          <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-xl animate-in">
            {searchable && options.length > 8 && (
              <div className="border-b border-line p-2">
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="h-9 w-full rounded-lg bg-surface px-3 text-sm outline-none" />
              </div>
            )}
            <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto py-1">
              {filtered.map((o) => {
                const on = value.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface"
                    >
                      <span className={cn('flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border', on ? 'border-brand bg-brand text-white' : 'border-ink/25')}>
                        {on && <CheckIcon size={12} strokeWidth={3} />}
                      </span>
                      <span className="flex-1">{o.label}</span>
                      {o.hint}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="px-3 py-3 text-sm text-muted">{t('common.noOptions')}</li>}
            </ul>
            {value.length > 0 && (
              <div className="flex justify-between border-t border-line px-3 py-2 text-sm">
                <button type="button" className="font-medium text-muted hover:text-ink" onClick={() => onChange([])}>
                  {t('common.clear')}
                </button>
                <button type="button" className="font-semibold text-brand" onClick={() => setOpen(false)}>
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
