import { useId, type ComponentProps, type ReactNode } from 'react';
import { cx } from './ui';

const control =
  'w-full rounded-lg border border-line-strong bg-card px-3 text-sm text-fg placeholder:text-muted/70 transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function FormField({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
          {label}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: ComponentProps<'input'> & { invalid?: boolean }) {
  return <input className={cx(control, 'h-9', invalid && 'border-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, invalid, ...rest }: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return <textarea className={cx(control, 'min-h-20 py-2 leading-relaxed', invalid && 'border-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({
  className,
  options,
  placeholder,
  ...rest
}: ComponentProps<'select'> & { options: { value: string; label: ReactNode }[]; placeholder?: string }) {
  return (
    <select className={cx(control, 'h-9 pr-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label as string}
        </option>
      ))}
    </select>
  );
}

/** Amount input in major units with a currency suffix; the caller converts to minor units. */
export function MoneyInput({ className, suffix = '₼', ...rest }: ComponentProps<'input'> & { suffix?: string; invalid?: boolean }) {
  return (
    <div className={cx('relative', className)}>
      <Input inputMode="decimal" className="pr-8 tabular-nums" {...rest} />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">{suffix}</span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  size = 'md',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('inline-flex items-center gap-2 select-none', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex shrink-0 items-center rounded-full transition-colors',
          size === 'md' ? 'h-5 w-9' : 'h-4 w-7',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className={cx(
            'inline-block rounded-full bg-white shadow transition-transform',
            size === 'md' ? 'size-4' : 'size-3',
            checked ? (size === 'md' ? 'translate-x-[18px]' : 'translate-x-[14px]') : 'translate-x-0.5',
          )}
        />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded accent-[var(--brand)]" />
      {label}
    </label>
  );
}
