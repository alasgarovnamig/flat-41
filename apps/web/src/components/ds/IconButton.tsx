import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Circular icon button (44px default = touch target). Always needs `label` (aria-label + tooltip).
 * Variants: sunken (default, `surfaceSunken`), raised (white + soft shadow, for cards/photos), ink (black), glass, ghost.
 */
export type IconButtonVariant = 'sunken' | 'raised' | 'ink' | 'glass' | 'ghost' | 'pill';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<IconButtonVariant, string> = {
  sunken: 'bg-surface-sunken text-ink hover:bg-pill',
  pill: 'bg-pill text-ink hover:bg-pill-hover',
  raised: 'bg-surface-raised text-ink shadow-pill hover:bg-surface-sunken',
  ink: 'bg-ink text-on-ink hover:bg-ink-secondary',
  glass: 'glass text-ink hover:bg-surface-raised',
  ghost: 'text-ink hover:bg-pill',
};
/** sm is 36px visually; the ::after extends the hit area to 44px (touch-target rule). */
const SIZES: Record<Size, string> = { sm: "h-9 w-9 after:absolute after:-inset-1 after:content-['']", md: 'h-11 w-11', lg: 'h-13 w-13' };

export const iconButtonClass = (variant: IconButtonVariant = 'sunken', size: Size = 'md', className?: string) =>
  cn('press relative inline-flex shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-45', VARIANTS[variant], SIZES[size], className);

function Indicator({ dot, count }: { dot?: boolean; count?: number }) {
  if (count && count > 0)
    return (
      <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-on-ink ring-2 ring-frame" aria-hidden>
        {count > 99 ? '99+' : count}
      </span>
    );
  if (dot) return <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent-strong ring-2 ring-surface-sunken" aria-hidden />;
  return null;
}

interface Common {
  label: string;
  variant?: IconButtonVariant;
  size?: Size;
  dot?: boolean;
  count?: number;
  children: ReactNode;
  className?: string;
}

export function IconButton({ label, variant, size, dot, count, children, className, type = 'button', ...p }: Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button type={type} aria-label={label} title={label} className={iconButtonClass(variant, size, className)} {...p}>
      {children}
      <Indicator dot={dot} count={count} />
    </button>
  );
}

export function IconLink({ label, variant, size, dot, count, children, className, href, prefetch }: Common & { href: string; prefetch?: boolean }) {
  return (
    <Link href={href} prefetch={prefetch} aria-label={label} title={label} className={iconButtonClass(variant, size, className)}>
      {children}
      <Indicator dot={dot} count={count} />
    </Link>
  );
}
