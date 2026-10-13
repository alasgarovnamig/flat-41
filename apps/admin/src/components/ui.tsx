import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Construction, Inbox, Loader2, Lock, RefreshCw, WifiOff } from 'lucide-react';
import { ApiRequestError } from '../api/client';
import { useT } from '../i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ─────────────────────────── Button ───────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark shadow-sm',
  secondary: 'bg-card text-fg border border-line-strong hover:bg-hover',
  ghost: 'text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-95 shadow-sm',
  'danger-soft': 'bg-danger-soft text-danger hover:brightness-95',
  success: 'bg-success text-white hover:brightness-95 shadow-sm',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'h-8 px-2.5 text-[13px]',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'icon' && 'h-9 w-9',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ─────────────────────────── Card / layout ───────────────────────────
export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-2.5">{children}</div>;
}

export function KeyValue({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 1 && 'grid-cols-1', cols === 2 && 'grid-cols-1 sm:grid-cols-2', cols === 3 && 'grid-cols-2 lg:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-lg bg-hover p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            value === tab.value ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {tab.label}
          {tab.count != null && <span className="rounded-full bg-line px-1.5 text-[11px] text-muted">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────── Feedback states ───────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton h-4', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;
}

export function EmptyState({ title, hint, icon, action }: { title?: ReactNode; hint?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="rounded-full bg-hover p-3 text-muted">{icon ?? <Inbox className="size-6" />}</div>
      <p className="font-medium">{title ?? t('Nothing here yet')}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useT();
  const e = error instanceof ApiRequestError ? error : null;
  let icon = <AlertTriangle className="size-6" />;
  let title = t('Something went wrong');
  let hint: string = error instanceof Error ? error.message : String(error);
  let tone = 'bg-danger-soft text-danger';
  if (e?.isNotImplemented) {
    icon = <Construction className="size-6" />;
    title = t('Not available yet');
    hint = t('The API does not implement this endpoint yet ({msg}).', { msg: e.message });
    tone = 'bg-warning-soft text-warning';
  } else if (e?.isNetwork) {
    icon = <WifiOff className="size-6" />;
    title = t('Cannot reach the API');
    hint = t('Check that the API server is running and VITE_API_URL is correct.');
  } else if (e?.status === 403) {
    icon = <Lock className="size-6" />;
    title = t('No permission');
    hint = t('Your role is not allowed to view this.');
    tone = 'bg-warning-soft text-warning';
  }
  return (
    <div role="alert" className={cx('flex flex-col items-center justify-center gap-2 px-4 text-center', compact ? 'py-6' : 'py-12')}>
      <div className={cx('rounded-full p-3', tone)}>{icon}</div>
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm break-words text-muted">{hint}</p>
      {onRetry && !e?.isNotImplemented && e?.status !== 403 && (
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          {t('Retry')}
        </Button>
      )}
    </div>
  );
}

/** Renders loading / error / data for a TanStack query result. */
export function QueryView<T>({
  query,
  skeleton,
  children,
  isEmpty,
  empty,
}: {
  query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <SkeletonBlock />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState />}</>;
  return <>{children(query.data)}</>;
}

export function SkeletonBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-1">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i % 3 === 0 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return url ? (
    <img src={url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-fg"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
