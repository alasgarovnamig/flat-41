import { currencySymbol, type Currency } from '@evtap/shared';
import { cn } from '@/lib/utils';

const NBSP = ' ';

/** 276880 → "276 880" (non-breaking thin grouping, ICU independent → no hydration mismatch). */
export function groupNumber(n: number, fraction = 0) {
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toFixed(fraction).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${neg ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/**
 * "Big quiet number": the currency symbol is `muted` grey and lighter, the value is ink (DESIGN_SYSTEM §1.4).
 * `minor` = amount in qəpik (wallet / payments); otherwise major units (listing prices).
 */
export function Money({
  value, currency = 'AZN', minor, className, symbolClassName, suffix, signed,
}: { value: number; currency?: Currency; minor?: boolean; className?: string; symbolClassName?: string; suffix?: React.ReactNode; signed?: boolean }) {
  const major = minor ? value / 100 : value;
  const digits = minor ? (Number.isInteger(major) ? 0 : 2) : 0;
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      {signed && major > 0 ? '+' : ''}
      <span className={cn('mr-[0.18em] font-light text-muted', symbolClassName)}>{currencySymbol(currency)}</span>
      {groupNumber(major, digits)}
      {suffix && <span className="ml-1 text-[0.55em] font-normal tracking-normal text-muted">{suffix}</span>}
    </span>
  );
}

/** Large KPI number (Outfit 400, tight tracking). */
export function BigNumber({ children, className, size = 'md' }: { children: React.ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span
      className={cn(
        'tabular font-display font-normal text-ink',
        size === 'sm' && 'text-[24px] leading-[28px] tracking-[-0.6px]',
        size === 'md' && 'text-number',
        size === 'lg' && 'text-[38px] leading-[42px] tracking-[-1px]',
        size === 'xl' && 'text-display',
        className,
      )}
    >
      {children}
    </span>
  );
}
