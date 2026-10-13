import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardLink } from './Card';
import { BarcodeSpark } from './charts';
import { Skeleton } from './feedback';
import { BigNumber } from './Money';

/** Card + label + big number + caption ("This month") + BarcodeSpark right-aligned. */
export function StatCard({
  label, value, caption, spark, sparkLabel, href, hrefLabel, icon, className, loading, size = 'md',
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  spark?: number[];
  sparkLabel?: string;
  href?: string;
  hrefLabel?: string;
  icon?: ReactNode;
  className?: string;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <Card className={cn('flex min-h-[168px] flex-col justify-between gap-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-h3 text-ink">
          {icon && <span className="text-ink-secondary">{icon}</span>}
          {label}
        </h3>
        {href && <CardLink href={href} label={hrefLabel ?? label} />}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {loading ? <Skeleton className="h-9 w-32 rounded-sm" /> : <BigNumber size={size}>{value}</BigNumber>}
          {caption && <div className="mt-1 text-label font-normal text-ink-secondary">{caption}</div>}
        </div>
        {spark && <BarcodeSpark values={spark} label={sparkLabel ?? label} />}
      </div>
    </Card>
  );
}
