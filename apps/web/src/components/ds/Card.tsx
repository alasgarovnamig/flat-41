import Link from 'next/link';
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUpRightIcon } from './icons';

type Pad = 'none' | 'sm' | 'md' | 'lg';
const PAD: Record<Pad, string> = { none: '', sm: 'p-4', md: 'p-5 sm:p-6', lg: 'p-6 sm:p-8' };

/** `surface`, radius 28, soft inner highlight + shadow. `tone="raised"` = white body (inputs, property bodies). */
export function Card({
  as: As = 'div', pad = 'md', tone = 'surface', className, children, ...p
}: HTMLAttributes<HTMLElement> & { as?: ElementType; pad?: Pad; tone?: 'surface' | 'raised' | 'ink' | 'sunken' | 'glass'; noValidate?: boolean }) {
  return (
    <As
      className={cn(
        'rounded-xl',
        tone === 'surface' && 'bg-surface shadow-card',
        tone === 'raised' && 'bg-surface-raised shadow-card',
        tone === 'sunken' && 'bg-surface-sunken',
        tone === 'ink' && 'bg-ink text-on-ink',
        tone === 'glass' && 'glass shadow-raised',
        PAD[pad],
        className,
      )}
      {...p}
    >
      {children}
    </As>
  );
}

/** Card title row: title 19/500 top-left, optional sub, actions (e.g. ↗ / Segmented / FilterPill) top-right. */
export function CardHeader({ title, sub, action, className, as: H = 'h2', id }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string; as?: ElementType; id?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <H id={id} className="text-h3 text-ink">
          {title}
        </H>
        {sub && <p className="mt-0.5 text-label font-normal text-muted">{sub}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** The white 36px ↗ circle in a card's top-right corner. */
export function CardLink({ href, label, className, icon }: { href: string; label: string; className?: string; icon?: ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} className={cn("press relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-raised text-ink shadow-pill hover:bg-ink hover:text-on-ink sm:h-9 sm:w-9 after:absolute after:-inset-1 after:content-['']", className)}>
      {icon ?? <ArrowUpRightIcon size={18} />}
    </Link>
  );
}

/** Section title used on canvas (outside cards). */
export function SectionTitle({ title, sub, action, className, id }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-h2">
          {title}
        </h2>
        {sub && <p className="mt-1 text-label font-normal text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** Page title row (h1 + sub + actions). */
export function PageHeader({ title, sub, actions, eyebrow, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-h1">{title}</h1>
        {sub && <p className="mt-1 text-label font-normal text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
