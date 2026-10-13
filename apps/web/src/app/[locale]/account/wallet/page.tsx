'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_SETTINGS, formatMoney, topupBonus, type PlatformSettings, type WalletTransaction } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { dailyCounts } from '@/lib/series';
import { cn } from '@/lib/utils';
import { BarcodeSpark, Button, Card, CardHeader, ChoicePills, DataTable, EmptyState, ErrorState, Input, Money, PageHeader, Pagination, RowCard, Skeleton, type Column } from '@/components/ds';
import { CardIcon, WalletIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

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
  const spark = dailyCounts((tx.data?.items ?? []).map((x) => x.createdAt), 28);
  const cur = wallet.data?.currency;

  const columns: Column<WalletTransaction>[] = [
    { key: 'date', header: t('common.date'), cell: (x) => <span className="whitespace-nowrap text-ink-secondary">{dateTime(x.createdAt)}</span> },
    { key: 'type', header: t('wallet.type'), cell: (x) => t(`enums.walletTx.${x.type}`) },
    { key: 'desc', header: t('result.description'), cell: (x) => <span className="line-clamp-1">{x.description}</span>, minWidth: 'lg' },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (x) => <Money value={x.amount} minor signed className={cn('font-medium', x.amount >= 0 ? 'text-success' : 'text-danger')} /> },
    { key: 'after', header: t('wallet.balanceAfter'), align: 'right', cell: (x) => <Money value={x.balanceAfter} minor />, minWidth: 'md' },
  ];

  return (
    <div>
      <PageHeader title={t('account.nav.wallet')} sub={t('wallet.sub')} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card tone="ink" className="flex flex-col justify-between gap-6">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-label opacity-80">
              <WalletIcon size={18} /> {t('account.wallet.balance')}
            </span>
            <BarcodeSpark values={spark} label={t('overview.walletActivity')} inverse />
          </div>
          {wallet.isLoading ? (
            <Skeleton className="h-12 w-48 rounded-md opacity-30" />
          ) : wallet.isError ? (
            <div className="text-label">{errorMessage(wallet.error, t)}</div>
          ) : (
            <div>
              <Money value={(wallet.data?.balance ?? 0) + (wallet.data?.bonusBalance ?? 0)} currency={cur} minor className="font-display text-[48px] font-light leading-none tracking-[-1.6px]" symbolClassName="text-subtle" />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-on-ink/10 p-3">
                  <div className="text-caption opacity-70">{t('wallet.main')}</div>
                  <Money value={wallet.data?.balance ?? 0} currency={cur} minor className="text-[17px] font-medium" symbolClassName="text-subtle" />
                </div>
                <div className="rounded-lg bg-on-ink/10 p-3">
                  <div className="text-caption opacity-70">{t('wallet.bonus')}</div>
                  <Money value={wallet.data?.bonusBalance ?? 0} currency={cur} minor className="text-[17px] font-medium" symbolClassName="text-subtle" />
                </div>
              </div>
            </div>
          )}
          <p className="text-caption opacity-70">{t('wallet.bonusNote')}</p>
        </Card>

        <Card>
          <CardHeader title={t('wallet.topup')} />
          <ChoicePills size="sm" ariaLabel={t('common.amount')} value={Number(amount)} onChange={(v) => v != null && setAmount(String(v))} options={QUICK.map((q) => ({ value: q, label: `${q} ₼` }))} />
          <div className="mt-4">
            <Input
              label={t('common.amount')}
              inputMode="decimal"
              suffix="₼"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              error={amount && invalid ? t('wallet.range', { min: formatMoney(settings.minTopup), max: formatMoney(settings.maxTopup) }) : undefined}
            />
          </div>
          <dl className="mt-4 space-y-2 rounded-lg bg-surface-raised p-4 text-[14px] shadow-pill">
            <div className="flex justify-between"><dt className="text-ink-secondary">{t('wallet.youPay')}</dt><dd><Money value={minor} minor /></dd></div>
            <div className="flex justify-between"><dt className="text-ink-secondary">{t('wallet.bonusAdded')}</dt><dd className="font-medium text-success">+<Money value={bonus} minor /></dd></div>
            <div className="flex items-end justify-between border-t border-hairline pt-2"><dt className="font-medium">{t('wallet.youGet')}</dt><dd><Money value={minor + bonus} minor className="font-display text-[22px] leading-none" /></dd></div>
          </dl>
          <ul className="mt-3 grid grid-cols-3 gap-2 text-center">
            {tiers.map((tier) => {
              const on = minor >= tier.minAmount;
              return (
                <li key={tier.minAmount} className={cn('rounded-lg p-2.5', on ? 'bg-ink text-on-ink' : 'bg-surface-sunken text-ink-secondary')}>
                  <div className="font-display text-[20px] leading-tight">+{tier.bonusPercent}%</div>
                  <div className="text-[11px] opacity-80">{t('wallet.from', { amount: formatMoney(tier.minAmount) })}</div>
                </li>
              );
            })}
          </ul>
          <Button size="lg" className="mt-5 w-full" icon={<CardIcon size={18} />} disabled={invalid} loading={topup.isPending} onClick={() => topup.mutate()}>
            {t('wallet.payCard', { amount: formatMoney(minor) })}
          </Button>
        </Card>
      </div>

      <div className="mt-6">
        {tx.isError ? (
          <ErrorState title={t('wallet.loadError')} text={errorMessage(tx.error, t)} onRetry={() => void tx.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <DataTable
            caption={t('wallet.transactions')}
            loading={tx.isLoading}
            columns={columns}
            rows={tx.data?.items}
            rowKey={(x) => x.id}
            toolbar={<h2 className="px-2 text-h3">{t('wallet.transactions')}</h2>}
            empty={<EmptyState className="shadow-none" icon={<WalletIcon />} title={t('wallet.empty')} />}
            mobileRow={(x) => (
              <RowCard className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{t(`enums.walletTx.${x.type}`)}</span>
                  <span className="block truncate text-caption text-muted">{dateTime(x.createdAt)}</span>
                </span>
                <Money value={x.amount} minor signed className={cn('font-medium', x.amount >= 0 ? 'text-success' : 'text-danger')} />
              </RowCard>
            )}
            footer={tx.data && <Pagination className="mt-4" page={page} total={tx.data.total} pageSize={15} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />}
          />
        )}
      </div>
    </div>
  );
}
