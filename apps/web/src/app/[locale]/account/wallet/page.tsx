'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_SETTINGS, formatMoney, topupBonus, type PlatformSettings } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/account/PageHeader';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { CardIcon, WalletIcon } from '@/components/ui/icons';
import { Pagination } from '@/components/ui/Pagination';

const QUICK = [10, 20, 50, 100, 300];

export default function WalletPage() {
  const { t, locale, dateTime } = useI18n();
  const router = useRouter();
  const wallet = useQuery({ queryKey: qk.wallet, queryFn: api.wallet.get });
  const catalog = useQuery({ queryKey: qk.catalog, queryFn: api.ref.catalog, staleTime: 5 * 60_000, retry: false });
  const settings = { ...DEFAULT_SETTINGS, ...(catalog.data?.settings ?? {}) } as PlatformSettings;
  const [page, setPage] = useState(1);
  const tx = useQuery({ queryKey: qk.walletTx(page), queryFn: () => api.wallet.transactions({ page, pageSize: 15 }), placeholderData: keepPreviousData });
  const [amount, setAmount] = useState('50');
  const minor = Math.round(Number(amount || 0) * 100);
  const bonus = topupBonus(minor, settings);
  const invalid = minor < settings.minTopup || minor > settings.maxTopup;
  const topup = useMutation({
    mutationFn: () => api.payments.checkout({ purpose: 'WALLET_TOPUP', amount: minor, method: 'CARD', returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (c) => followCheckout(c, locale, router.push),
  });
  const tiers = [...settings.topupBonuses].sort((a, b) => a.minAmount - b.minAmount);

  return (
    <div>
      <PageHeader title={t('account.nav.wallet')} sub={t('wallet.sub')} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-card bg-gradient-to-br from-brand to-brand-dark p-6 text-white shadow-card">
          <div className="flex items-center gap-2 text-sm text-white/80"><WalletIcon size={18} /> {t('account.wallet.balance')}</div>
          {wallet.isLoading ? (
            <Skeleton className="mt-3 h-10 w-40 opacity-30" />
          ) : wallet.isError ? (
            <div className="mt-3 text-sm">{errorMessage(wallet.error, t)}</div>
          ) : (
            <>
              <div className="mt-2 text-4xl font-extrabold tracking-tight">{formatMoney((wallet.data?.balance ?? 0) + (wallet.data?.bonusBalance ?? 0), wallet.data?.currency)}</div>
              <div className="mt-2 flex gap-4 text-sm text-white/80">
                <span>{t('wallet.main')}: {formatMoney(wallet.data?.balance ?? 0, wallet.data?.currency)}</span>
                <span>{t('wallet.bonus')}: {formatMoney(wallet.data?.bonusBalance ?? 0, wallet.data?.currency)}</span>
              </div>
            </>
          )}
          <p className="mt-4 text-xs text-white/70">{t('wallet.bonusNote')}</p>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold">{t('wallet.topup')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button key={q} type="button" onClick={() => setAmount(String(q))} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold', Number(amount) === q ? 'border-brand bg-brand text-white' : 'border-line hover:border-ink/30')}>
                {q} ₼
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Input
              label={t('common.amount')}
              inputMode="decimal"
              suffix="₼"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              error={amount && invalid ? t('wallet.range', { min: formatMoney(settings.minTopup), max: formatMoney(settings.maxTopup) }) : undefined}
            />
          </div>
          <div className="mt-3 rounded-xl bg-surface p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">{t('wallet.youPay')}</span><b>{formatMoney(minor)}</b></div>
            <div className="flex justify-between"><span className="text-muted">{t('wallet.bonusAdded')}</span><b className="text-brand">+{formatMoney(bonus)}</b></div>
            <div className="mt-1 flex justify-between border-t border-line pt-1"><span>{t('wallet.youGet')}</span><b>{formatMoney(minor + bonus)}</b></div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            {tiers.map((tier) => (
              <div key={tier.minAmount} className={cn('rounded-lg border p-2', minor >= tier.minAmount ? 'border-brand bg-brand-50 text-brand-dark' : 'border-line text-muted')}>
                <div className="text-base font-bold">+{tier.bonusPercent}%</div>
                {t('wallet.from', { amount: formatMoney(tier.minAmount) })}
              </div>
            ))}
          </div>
          <Button size="lg" className="mt-4 w-full" icon={<CardIcon size={18} />} disabled={invalid} loading={topup.isPending} onClick={() => topup.mutate()}>
            {t('wallet.payCard', { amount: formatMoney(minor) })}
          </Button>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">{t('wallet.transactions')}</h2>
      {tx.isLoading ? (
        <Skeleton className="h-40" />
      ) : tx.isError ? (
        <ErrorState title={t('wallet.loadError')} text={errorMessage(tx.error, t)} onRetry={() => void tx.refetch()} retryLabel={t('common.retry')} />
      ) : !tx.data?.items.length ? (
        <EmptyState icon={<WalletIcon />} title={t('wallet.empty')} />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">{t('common.date')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('wallet.type')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('result.description')}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{t('common.amount')}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{t('wallet.balanceAfter')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tx.data.items.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{dateTime(x.createdAt)}</td>
                    <td className="px-4 py-2.5">{t(`enums.walletTx.${x.type}`)}</td>
                    <td className="px-4 py-2.5">{x.description}</td>
                    <td className={cn('whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums', x.amount >= 0 ? 'text-brand' : 'text-urgent')}>
                      {x.amount >= 0 ? '+' : '−'}
                      {formatMoney(Math.abs(x.amount))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(x.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination className="mt-4" page={page} total={tx.data.total} pageSize={15} onChange={setPage} />
        </>
      )}
    </div>
  );
}
