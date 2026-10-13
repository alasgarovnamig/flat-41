import Link from 'next/link';
import { cn } from '@/lib/utils';

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0E7C66" />
      <path d="M8 15.5 16 9l8 6.5V23a1 1 0 0 1-1 1h-4.5v-5h-5v5H9a1 1 0 0 1-1-1z" fill="#fff" />
      <circle cx="23.5" cy="9.5" r="3" fill="#F5A524" />
    </svg>
  );
}

export function Logo({ href, light, className }: { href: string; light?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2', className)} aria-label="EvTap">
      <LogoMark />
      <span className={cn('text-xl font-extrabold tracking-tight', light ? 'text-white' : 'text-ink')}>
        Ev<span className={light ? 'text-vip' : 'text-brand'}>Tap</span>
      </span>
    </Link>
  );
}
