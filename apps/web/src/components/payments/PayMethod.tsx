'use client';

import { useEffect } from 'react';
import { formatMoney, type PaymentMethod } from '@evtap/shared';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { CardIcon, WalletIcon } from '@/components/ui/icons';

/** CARD / WALLET radio cards. Shows wallet balance and warns when it is not enough. */
export function PayMethodPicker({ value, onChange, amount, allowWallet = true, stacked }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; amount?: number; allowWallet?: boolean; stacked?: boolean }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const balance = user ? user.wallet.balance + user.wallet.bonusBalance : null;
  const short = balance != null && amount != null && balance < amount;
  useEffect(() => {
    if (short && value === 'WALLET') onChange('CARD');
  }, [short, value, onChange]);
  const opts: { m: PaymentMethod; icon: React.ReactNode; title: string; sub: string; disabled?: boolean }[] = [
    { m: 'CARD', icon: <CardIcon />, title: t('payment.card'), sub: t('payment.cardSub') },
  ];
  if (allowWallet)
    opts.push({
      m: 'WALLET',
      icon: <WalletIcon />,
      title: t('payment.wallet'),
      sub: balance != null ? t('payment.walletBalance', { amount: formatMoney(balance, user!.wallet.currency) }) : t('payment.walletSub'),
      disabled: short,
    });
  return (
    <div className={cn('grid gap-2', !stacked && 'sm:grid-cols-2')} role="radiogroup" aria-label={t('payment.method')}>
      {opts.map((o) => (
        <button
          key={o.m}
          type="button"
          role="radio"
          aria-checked={value === o.m}
          disabled={o.disabled}
          onClick={() => onChange(o.m)}
          className={cn(
            'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            value === o.m ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line bg-white hover:border-ink/30',
          )}
        >
          <span className={cn('mt-0.5', value === o.m ? 'text-brand' : 'text-muted')}>{o.icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="block text-xs text-muted">{o.sub}</span>
            {o.m === 'WALLET' && short && <span className="mt-0.5 block text-xs font-semibold text-urgent">{t('payment.insufficient')}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
