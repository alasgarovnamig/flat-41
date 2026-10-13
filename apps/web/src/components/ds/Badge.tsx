import type { ReactNode } from 'react';
import type { DealType } from '@evtap/shared';
import { cn } from '@/lib/utils';
import { CheckIcon, CrownIcon, StarIcon } from './icons';

/**
 * Pill badges (DESIGN_SYSTEM §2 "Badges"). Colour is never the only signal: every tone carries text, VIP a star,
 * verified a check. VIP text stays `ink` (the gold `vip` colour fails 4.5:1 at 11px) — gold is used for the star.
 */
export type BadgeTone = 'vip' | 'premium' | 'urgent' | 'verified' | 'business' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'glass' | 'accent';

const TONES: Record<BadgeTone, string> = {
  vip: 'bg-vip-bg text-ink',
  premium: 'bg-premium text-on-ink',
  urgent: 'bg-danger-bg text-danger',
  verified: 'bg-success-bg text-success',
  business: 'bg-pill text-ink',
  neutral: 'bg-surface-sunken text-ink-secondary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  outline: 'text-ink ring-1 ring-inset ring-hairline bg-surface-raised',
  glass: 'glass text-ink',
  accent: 'bg-accent text-on-accent',
};

export function Badge({ tone = 'neutral', children, className, icon, size = 'sm' }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode; size?: 'xs' | 'sm' | 'md' }) {
  const auto =
    icon ??
    (tone === 'vip' ? <StarIcon size={11} filled className="text-vip" /> : tone === 'premium' ? <CrownIcon size={11} /> : tone === 'verified' ? <CheckIcon size={11} strokeWidth={2.4} /> : tone === 'urgent' ? <span className="h-1.5 w-1.5 rounded-full bg-danger" /> : null);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill font-medium',
        size === 'xs' && 'h-5 px-2 text-[10.5px]',
        size === 'sm' && 'h-6 px-2.5 text-[11.5px]',
        size === 'md' && 'h-8 px-3.5 text-label',
        TONES[tone],
        className,
      )}
    >
      {auto}
      {children}
    </span>
  );
}

const DEAL_DOT: Record<DealType, string> = { SALE: 'bg-ink', RENT_LONG: 'bg-accent-strong', RENT_DAILY: 'bg-info' };

/** "• For Rent" meta tag — the dot colour encodes the deal type, the text names it. */
export function DealTag({ deal, label, className }: { deal: DealType; label: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DEAL_DOT[deal])} aria-hidden />
      {label}
    </span>
  );
}

/** Orange ★ 4.8 */
export function Rating({ value, count, className }: { value: number; count?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-medium text-ink', className)}>
      <StarIcon size={12} filled className="text-star" />
      {value.toFixed(1)}
      {count != null && <span className="font-normal text-muted">({count})</span>}
    </span>
  );
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
/** Status pill (Active / Pending / Rejected …) */
export function StatusPill({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <Badge tone={tone} size="md" className={cn('min-w-[84px] justify-center', className)}>
      {children}
    </Badge>
  );
}
