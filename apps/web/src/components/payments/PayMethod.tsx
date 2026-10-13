'use client';

import { useEffect } from 'react';
import type { PaymentMethod } from '@evtap/shared';
import { cn } from '@/lib/utils';
import { Money } from '@/components/ds';
import { CardIcon, CheckIcon, WalletIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

/** CARD / WALLET radio cards (selected = ink outline + check). Shows wallet balance and disables it when short. */
export function PayMethodPicker({ value, onChange, amount, allowWallet = true, stacked }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; amount?: number; allowWallet?: boolean; stacked?: boolean }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const balance = user ? user.wallet.balance + user.wallet.bonusBalance : null;
  const short = balance != null && amount != null && balance < amount;
  useEffect(() => {
    if (short && value === 'WALLET') onChange('CARD');
  }, [short, value, onChange]);
  const opts: { m: PaymentMethod; icon: React.ReactNode; title: string; sub: React.ReactNode; disabled?: boolean }[] = [{ m: 'CARD', icon: <CardIcon size={20} />, title: t('payment.card'), sub: t('payment.cardSub') }];
  if (allowWallet)
    opts.push({
      m: 'WALLET',
      icon: <WalletIcon size={20} />,
      title: t('payment.wallet'),
      sub: balance != null ? <Money value={balance} currency={user!.wallet.currency} minor /> : t('payment.walletSub'),
      disabled: short,
    });
  return (
    <div className={cn('grid gap-2', !stacked && 'sm:grid-cols-2')} role="radiogroup" aria-label={t('payment.method')}>
      {opts.map((o) => {
        const on = value === o.m;
        return (
          <button
            key={o.m}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.m)}
            className={cn(
              'press flex items-center gap-3 rounded-lg bg-surface-raised p-3 text-left shadow-pill disabled:cursor-not-allowed disabled:opacity-55',
              on ? 'ring-[1.5px] ring-inset ring-ink' : 'hover:bg-surface-sunken',
            )}
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', on ? 'bg-ink text-on-ink' : 'bg-surface-sunken text-ink')}>{o.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">{o.title}</span>
              <span className="block text-caption text-muted">{o.sub}</span>
              {o.m === 'WALLET' && short && <span className="mt-0.5 block text-caption font-medium text-danger">{t('payment.insufficient')}</span>}
            </span>
            {on && <CheckIcon size={18} className="shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
