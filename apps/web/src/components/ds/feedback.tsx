import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { InfoIcon, WarningIcon, CheckIcon, RefreshIcon } from './icons';

export function Spinner({ size = 20, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Skeleton — give it the same radius / size as the final content to avoid layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />;
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted" role="status" aria-live="polite">
      <Spinner size={28} className="text-ink" />
      <span className={label ? 'text-label' : 'sr-only'}>{label ?? '…'}</span>
    </div>
  );
}

/** Large thin-line icon in a 72px circle, h3 title, muted body, black pill CTA. */
export function EmptyState({ icon, title, text, action, className }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl bg-surface px-6 py-14 text-center shadow-card', className)}>
      {icon && <div className="mb-4 flex h-18 w-18 items-center justify-center rounded-full bg-surface-sunken text-ink [&_svg]:h-8 [&_svg]:w-8">{icon}</div>}
      <h3 className="text-h3">{title}</h3>
      {text && <p className="mt-1.5 max-w-md text-label font-normal text-muted">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, text, onRetry, retryLabel, className }: { title: string; text?: string; onRetry?: () => void; retryLabel?: string; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center rounded-xl bg-surface px-6 py-12 text-center shadow-card', className)}>
      <div className="mb-4 flex h-18 w-18 items-center justify-center rounded-full bg-danger-bg text-danger">
        <WarningIcon size={30} />
      </div>
      <h3 className="text-h3">{title}</h3>
      {text && <p className="mt-1.5 max-w-md text-label font-normal text-muted">{text}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="press mt-6 inline-flex h-11 items-center gap-2 rounded-pill bg-ink px-5 text-[14px] font-medium text-on-ink hover:bg-ink-secondary">
          <RefreshIcon size={16} /> {retryLabel ?? '↻'}
        </button>
      )}
    </div>
  );
}

type NoticeTone = 'info' | 'warning' | 'error' | 'success' | 'neutral';
const NOTICE: Record<NoticeTone, { cls: string; icon: ReactNode }> = {
  info: { cls: 'bg-info-bg text-info', icon: <InfoIcon size={18} /> },
  warning: { cls: 'bg-warning-bg text-warning', icon: <WarningIcon size={18} /> },
  error: { cls: 'bg-danger-bg text-danger', icon: <WarningIcon size={18} /> },
  success: { cls: 'bg-success-bg text-success', icon: <CheckIcon size={18} /> },
  neutral: { cls: 'bg-surface-sunken text-ink-secondary', icon: <InfoIcon size={18} /> },
};

/** Inline message block (soft tinted, rounded 16, leading icon). Text uses the tone colour for ≥4.5:1 on its bg. */
export function Notice({ tone = 'info', children, className }: { tone?: NoticeTone; children: ReactNode; className?: string }) {
  const n = NOTICE[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-md px-4 py-3 text-label font-normal', n.cls, className)}>
      <span className="mt-px shrink-0">{n.icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
