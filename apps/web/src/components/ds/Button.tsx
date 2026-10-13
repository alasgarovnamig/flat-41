import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './feedback';

/**
 * Button — always a pill (DESIGN_SYSTEM §2). Primary = black pill with white text, Secondary = `pill` grey,
 * Ghost = transparent, Destructive = danger text on dangerBg. Press feedback: scale .98 / 150ms (off under reduced motion).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'glass' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-on-ink hover:bg-ink-secondary',
  secondary: 'bg-pill text-ink hover:bg-pill-hover',
  outline: 'bg-surface-raised text-ink ring-1 ring-inset ring-hairline hover:ring-ink/40',
  ghost: 'text-ink hover:bg-pill',
  destructive: 'bg-danger-bg text-danger hover:brightness-95',
  glass: 'glass text-ink hover:bg-surface-raised',
  accent: 'bg-accent text-on-accent hover:bg-accent-strong',
};
const SIZES: Record<ButtonSize, string> = {
  // 36px visual, 44px hit area via ::after
  sm: "relative h-9 gap-1.5 px-3.5 text-label after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
  md: 'h-11 gap-2 px-5 text-[14px]',
  lg: 'h-13 gap-2 px-6 text-body',
};

export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) =>
  cn(
    'press inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-pill font-medium',
    'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /** icon after the label (e.g. ↗) */
  trailing?: ReactNode;
}

export function Button({ variant, size, loading, icon, trailing, className, children, disabled, type = 'button', ...p }: BtnProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading ? <Spinner size={16} /> : icon}
      {children}
      {trailing}
    </button>
  );
}

export function LinkButton({ variant, size, className, icon, trailing, children, ...p }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode; trailing?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...p}>
      {icon}
      {children}
      {trailing}
    </Link>
  );
}
