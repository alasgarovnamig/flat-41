'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDown } from './icons';

/** Input: `surfaceRaised`, radius 16, 48px, 1px hairline; focus = ink border + 2px ink/20 ring. */
export const inputClass = (invalid?: boolean, className?: string) =>
  cn(
    'h-12 w-full rounded-md border bg-surface-raised px-4 text-body text-ink transition-[border-color,box-shadow]',
    'focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted',
    invalid ? 'border-danger' : 'border-hairline hover:border-subtle',
    className,
  );

export function Field({ label, error, hint, children, htmlFor, required, className }: { label?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; required?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-label text-ink-secondary">
          {label}
          {required && <span className="text-danger" aria-hidden> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-caption font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; hint?: ReactNode; suffix?: ReactNode; leading?: ReactNode; wrapperClass?: string };

export function Input({ label, error, hint, suffix, leading, className, wrapperClass, id, required, ...p }: InputProps) {
  const auto = useId();
  const iid = id ?? auto;
  const hintId = `${iid}-hint`;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required} className={wrapperClass}>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">{leading}</span>}
        <input
          id={iid}
          aria-invalid={!!error}
          aria-describedby={error || hint ? hintId : undefined}
          aria-required={required || undefined}
          className={inputClass(!!error, cn(suffix ? 'pr-12' : '', leading ? 'pl-11' : '', className))}
          {...p}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-label text-muted">{suffix}</span>}
      </div>
    </Field>
  );
}

export function Textarea({ label, error, hint, className, id, required, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string; hint?: ReactNode }) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required}>
      <textarea id={iid} aria-invalid={!!error} aria-required={required || undefined} className={inputClass(!!error, cn('h-auto min-h-28 py-3 leading-relaxed', className))} {...p} />
    </Field>
  );
}

export function Select({ label, error, hint, className, id, children, required, wrapperClass, pill, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; error?: string; hint?: ReactNode; wrapperClass?: string; pill?: boolean }) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={iid} required={required} className={wrapperClass}>
      <div className="relative">
        <select id={iid} aria-invalid={!!error} required={required} className={inputClass(!!error, cn('appearance-none pr-10', pill && 'h-11 rounded-pill', className))} {...p}>
          {children}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, className, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; className?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer select-none items-center gap-3 text-[14px]', disabled && 'cursor-not-allowed opacity-50', className)}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn(
          'flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-[7px] border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink',
          checked ? 'border-ink bg-ink text-on-ink' : 'border-subtle bg-surface-raised',
        )}
      >
        {checked && <CheckIcon size={14} strokeWidth={2.6} />}
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={cn('inline-flex min-h-11 items-center gap-3 text-[14px]', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-7 w-12 shrink-0 rounded-pill transition-colors disabled:opacity-50', checked ? 'bg-ink' : 'bg-pill-hover')}
      >
        <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-surface-raised shadow-pill transition-[left] duration-200', checked ? 'left-6' : 'left-1')} />
        <span className="sr-only">{typeof label === 'string' ? label : ''}</span>
      </button>
      {label && (
        <label htmlFor={id} className="cursor-pointer">
          {label}
        </label>
      )}
    </div>
  );
}

/** Choice pills (single or multi). Selected = black pill. */
export function ChoicePills<T extends string | number>({
  options, value, onChange, multiple, className, size = 'md', ariaLabel,
}: {
  options: { value: T; label: ReactNode }[];
  value: T | T[] | null | undefined;
  onChange: (v: T[] | T | null) => void;
  multiple?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const selected = Array.isArray(value) ? value : value == null ? [] : [value];
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group" aria-label={ariaLabel}>
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
              'press rounded-pill font-medium',
              size === 'sm' ? 'h-9 px-3.5 text-label' : 'h-11 px-4.5 text-[14px]',
              on ? 'bg-ink text-on-ink' : 'bg-pill text-ink hover:bg-pill-hover',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control: `pill` track, the selected segment is white with the pill shadow. */
export function Segmented<T extends string>({ options, value, onChange, className, size = 'md', ariaLabel, block }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md'; ariaLabel?: string; block?: boolean }) {
  return (
    <div className={cn('inline-flex rounded-pill bg-pill p-1', block && 'flex w-full', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-pill font-medium transition-[background-color,color,box-shadow]',
            size === 'sm' ? 'h-8 px-3 text-label' : 'h-9 px-4 text-[14px]',
            block && 'flex-1',
            value === o.value ? 'bg-surface-raised text-ink shadow-pill' : 'text-ink-secondary hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Numeric input pair (min – max). */
export function RangeInputs({ min, max, onChange, placeholderMin, placeholderMax, suffix, labelMin, labelMax }: { min?: number | string; max?: number | string; onChange: (min?: number, max?: number) => void; placeholderMin: string; placeholderMax: string; suffix?: string; labelMin?: string; labelMax?: string }) {
  const parse = (v: string) => (v === '' ? undefined : Math.max(0, Number(v.replace(/\D/g, ''))));
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={labelMin ?? placeholderMin} inputMode="numeric" placeholder={placeholderMin} value={min ?? ''} suffix={suffix} onChange={(e) => onChange(parse(e.target.value), max === '' || max == null ? undefined : Number(max))} wrapperClass="flex-1" />
      <span className="text-muted" aria-hidden>–</span>
      <Input aria-label={labelMax ?? placeholderMax} inputMode="numeric" placeholder={placeholderMax} value={max ?? ''} suffix={suffix} onChange={(e) => onChange(min === '' || min == null ? undefined : Number(min), parse(e.target.value))} wrapperClass="flex-1" />
    </div>
  );
}
