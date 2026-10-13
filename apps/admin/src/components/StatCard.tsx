import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Skeleton, cx } from './ui';

export function StatCard({
  label,
  value,
  sub,
  icon,
  to,
  loading,
  emphasis,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  to?: string;
  loading?: boolean;
  emphasis?: 'warning' | 'danger';
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {icon && (
          <span
            className={cx(
              'rounded-lg p-1.5',
              emphasis === 'warning' ? 'bg-warning-soft text-warning' : emphasis === 'danger' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-fg',
            )}
          >
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-7 w-24" />
          <Skeleton className="mt-2 h-3 w-32" />
        </>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
        </>
      )}
    </>
  );
  const cls = 'block rounded-xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]';
  return to ? (
    <Link to={to} className={cx(cls, 'transition-colors hover:border-brand/50 hover:bg-hover/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
