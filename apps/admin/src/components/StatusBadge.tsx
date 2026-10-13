import type { ReactNode } from 'react';
import { enumLabel } from '../lib/format';
import { cx } from './ui';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'violet' | 'gold';

const TONES: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-hover text-muted',
  brand: 'bg-brand-soft text-brand-fg',
  violet: 'bg-violet-soft text-violet',
  gold: 'bg-[#FFF8E6] text-[#9a6200] dark:bg-[#3a2d10] dark:text-[#f5c46b]',
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success', SUCCEEDED: 'success', CONFIRMED: 'success', COMPLETED: 'success', PAID: 'success', RESOLVED: 'success', CLOSED: 'neutral',
  PENDING: 'warning', PENDING_PAYMENT: 'warning', PAST_DUE: 'warning', CREATED: 'warning', NEW: 'warning', OPEN: 'warning',
  REJECTED: 'danger', BLOCKED: 'danger', FAILED: 'danger',
  DRAFT: 'neutral', ARCHIVED: 'neutral', EXPIRED: 'neutral', CANCELLED: 'neutral', DISMISSED: 'neutral', NOT_DUE: 'neutral', DELETED: 'neutral',
  REFUNDED: 'info', PARTIALLY_REFUNDED: 'info', SOLD: 'info', SENT_TO_BANK: 'info',
  ADMIN: 'violet', MODERATOR: 'brand', USER: 'neutral', BUSINESS: 'gold', INDIVIDUAL: 'neutral',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Badge for any shared status/role enum value; colour is always paired with the text label. */
export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-muted">—</span>;
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} className={className} dot>
      {enumLabel(status)}
    </Badge>
  );
}
