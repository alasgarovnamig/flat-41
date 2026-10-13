import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} />;
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted" role="status">
      <Spinner size={28} className="text-brand" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action, className }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-card border border-dashed border-line bg-white px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {text && <p className="mt-1 max-w-md text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, text, onRetry, retryLabel }: { title: string; text?: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-card border border-urgent/20 bg-urgent-50 px-6 py-10 text-center">
      <div className="mb-2 text-2xl">⚠️</div>
      <h3 className="font-semibold text-ink">{title}</h3>
      {text && <p className="mt-1 max-w-md text-sm text-muted">{text}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-surface">
          {retryLabel ?? '↻'}
        </button>
      )}
    </div>
  );
}

type BadgeTone = 'brand' | 'vip' | 'premium' | 'urgent' | 'gray' | 'dark' | 'green' | 'blue';
const TONES: Record<BadgeTone, string> = {
  brand: 'bg-brand-50 text-brand-dark',
  vip: 'bg-vip text-ink',
  premium: 'bg-premium text-white',
  urgent: 'bg-urgent text-white',
  gray: 'bg-ink/5 text-muted',
  dark: 'bg-ink/80 text-white backdrop-blur',
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-sky-50 text-sky-700',
};

export function Badge({ tone = 'gray', children, className, icon }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Alert({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode; className?: string }) {
  const t = {
    info: 'bg-sky-50 text-sky-900 border-sky-200',
    warning: 'bg-vip-50 text-amber-900 border-vip/40',
    error: 'bg-urgent-50 text-red-900 border-urgent/30',
    success: 'bg-brand-50 text-brand-dark border-brand/30',
  }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl border px-4 py-3 text-sm', t, className)}>{children}</div>;
}
