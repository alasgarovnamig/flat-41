import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './feedback';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'vip' | 'premium' | 'white';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark shadow-sm',
  secondary: 'bg-brand-50 text-brand-dark hover:bg-brand-100',
  outline: 'border border-line bg-white text-ink hover:border-ink/30 hover:bg-surface',
  ghost: 'text-ink hover:bg-ink/5',
  danger: 'bg-urgent text-white hover:brightness-95',
  vip: 'bg-vip text-ink hover:brightness-95',
  premium: 'bg-premium text-white hover:brightness-110',
  white: 'bg-white text-ink hover:bg-white/90 shadow-sm',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', className?: string) =>
  cn(
    'inline-flex shrink-0 items-center justify-center font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant, size, loading, icon, className, children, disabled, type = 'button', ...p }: BtnProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...p}>
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ variant, size, className, icon, children, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...p}>
      {icon}
      {children}
    </Link>
  );
}
