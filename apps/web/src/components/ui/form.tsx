'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDown } from './icons';

export const inputClass = (invalid?: boolean, className?: string) =>
  cn(
    'h-11 w-full rounded-xl border bg-white px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-colors',
    'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-surface disabled:text-muted',
    invalid ? 'border-urgent' : 'border-line hover:border-ink/25',
    className,
  );

export function Field({ label, error, hint, children, htmlFor, required, className }: { label?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; required?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-urgent"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-urgent" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; hint?: ReactNode; suffix?: ReactNode; wrapperClass?: string };

export function Input({ label, error, hint, suffix, className, wrapperClass, id, required, ...p }: InputProps) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required} className={wrapperClass}>
      <div className="relative">
        <input id={iid} aria-invalid={!!error} required={required} className={inputClass(!!error, cn(suffix ? 'pr-12' : '', className))} {...p} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted">{suffix}</span>}
      </div>
    </Field>
  );
}

export function Textarea({ label, error, hint, className, id, required, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string; hint?: ReactNode }) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required}>
      <textarea id={iid} aria-invalid={!!error} required={required} className={inputClass(!!error, cn('h-auto min-h-28 py-3 leading-relaxed', className))} {...p} />
    </Field>
  );
}

export function Select({ label, error, hint, className, id, children, required, wrapperClass, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; error?: string; hint?: ReactNode; wrapperClass?: string }) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required} className={wrapperClass}>
      <div className="relative">
        <select id={iid} aria-invalid={!!error} required={required} className={inputClass(!!error, cn('appearance-none pr-9', className))} {...p}>
          {children}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, className, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; className?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer select-none items-center gap-2.5 text-sm', disabled && 'opacity-50', className)}>
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-brand bg-brand text-white' : 'border-ink/25 bg-white',
        )}
      >
        {checked && <CheckIcon size={14} strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-ink/20')}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

/** Pill-style single / multi choice. */
export function Chips<T extends string | number>({
  options, value, onChange, multiple, className, size = 'md',
}: {
  options: { value: T; label: ReactNode }[];
  value: T | T[] | null | undefined;
  onChange: (v: T[] | T | null) => void;
  multiple?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const selected = Array.isArray(value) ? value : value == null ? [] : [value];
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (multiple) onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value]);
              else onChange(on ? null : o.value);
            }}
            className={cn(
              'rounded-full border font-medium transition-colors',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm',
              on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-ink/30',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control (tabs-like). */
export function Segmented<T extends string>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-xl bg-ink/5 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors',
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Numeric input pair (min – max). */
export function RangeInputs({ min, max, onChange, placeholderMin, placeholderMax, suffix }: { min?: number | string; max?: number | string; onChange: (min?: number, max?: number) => void; placeholderMin: string; placeholderMax: string; suffix?: string }) {
  const parse = (v: string) => (v === '' ? undefined : Math.max(0, Number(v.replace(/\D/g, ''))));
  return (
    <div className="flex items-center gap-2">
      <Input inputMode="numeric" placeholder={placeholderMin} value={min ?? ''} suffix={suffix} onChange={(e) => onChange(parse(e.target.value), max === '' || max == null ? undefined : Number(max))} wrapperClass="flex-1" />
      <span className="text-muted">–</span>
      <Input inputMode="numeric" placeholder={placeholderMax} value={max ?? ''} suffix={suffix} onChange={(e) => onChange(min === '' || min == null ? undefined : Number(min), parse(e.target.value))} wrapperClass="flex-1" />
    </div>
  );
}
