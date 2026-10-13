import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Black rounded square with a white roof-and-door mark (inverts in dark mode via tokens). */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden focusable="false">
      <rect width="40" height="40" rx="12" style={{ fill: 'var(--c-ink)' }} />
      <path d="M10 27.5 20 13l10 14.5" fill="none" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--c-on-ink)' }} />
      <rect x="17.4" y="22.6" width="5.2" height="6.4" rx="1.4" style={{ fill: 'var(--c-accent)' }} />
    </svg>
  );
}

export function Logo({ href, className, size = 40, label = 'EvTap' }: { href: string; className?: string; size?: number; label?: string }) {
  return (
    <Link href={href} className={cn('flex shrink-0 items-center gap-2.5 rounded-pill', className)} aria-label={label}>
      <LogoMark size={size} />
      <span className="font-display text-[22px] font-medium tracking-[-0.4px] text-ink">EvTap</span>
    </Link>
  );
}
