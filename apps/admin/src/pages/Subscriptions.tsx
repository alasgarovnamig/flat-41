import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { PLANS, planPrice } from '@evtap/shared';
import * as api from '../api/client';
import type { AdminSubscriptionRow } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, Select } from '../components/FormField';
import { Badge, StatusBadge } from '../components/StatusBadge';
import { FilterBar, PageHeader, cx } from '../components/ui';
import { useT } from '../i18n';
import { enumLabel, fmtDate, fmtNumber, money } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

function UsageBar({ used, quota }: { used: number; quota: number }) {
  const { t } = useT();
  if (quota < 0) return <span className="text-xs text-muted">{t('{n} / unlimited', { n: used })}</span>;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div className="w-28">
      <div className="flex justify-between text-xs">
        <span className="tabular-nums">
          {used} / {quota}
        </span>
        <span className="text-muted">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover">
        <div className={cx('h-full rounded-full', pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-brand')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ status: '', page: '1' });
  const query = { status: f.status || undefined, page: Number(f.page) || 1, pageSize: 20 };
  const list = useQuery({ queryKey: ['admin', 'subscriptions', query], queryFn: () => api.listAdminSubscriptions(query), placeholderData: keepPreviousData });

  const columns: Column<AdminSubscriptionRow>[] = [
    {
      key: 'who',
      header: t('Customer'),
      sortValue: (s) => s.agency?.name ?? s.user?.name ?? '',
      render: (s) => (
        <div className="min-w-[160px]">
          <p className="font-medium">{s.agency?.name ?? s.user?.name ?? '—'}</p>
          {s.user && (
            <Link to={`/users/${s.user.id}`} className="text-xs text-muted hover:underline">
              {s.user.name}
            </Link>
          )}
        </div>
      ),
    },
    {
      key: 'plan',
      header: t('Plan'),
      sortValue: (s) => s.planCode,
      render: (s) => {
        const plan = PLANS.find((p) => p.code === s.planCode);
        return (
          <div className="whitespace-nowrap">
            <Badge tone={s.planCode === 'ENTERPRISE' ? 'violet' : s.planCode === 'PRO' ? 'gold' : 'brand'}>{plan?.name.en ?? s.planCode}</Badge>
            <p className="mt-0.5 text-xs text-muted">
              {enumLabel(s.period)}
              {plan && ` · ${money(planPrice(plan, s.period))}`}
            </p>
          </div>
        );
      },
    },
    { key: 'status', header: t('Status'), sortValue: (s) => s.status, render: (s) => <StatusBadge status={s.status} /> },
    {
      key: 'period',
      header: t('Current period'),
      hideBelow: '2xl',
      sortValue: (s) => s.currentPeriodStart,
      render: (s) => (
        <span className="whitespace-nowrap">
          {fmtDate(s.currentPeriodStart)} – {fmtDate(s.currentPeriodEnd)}
        </span>
      ),
    },
    {
      key: 'renewal',
      header: t('Renewal'),
      sortValue: (s) => s.currentPeriodEnd,
      render: (s) =>
        s.autoRenew && (s.status === 'ACTIVE' || s.status === 'PAST_DUE') ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <RefreshCw className="size-3 text-success" />
            {fmtDate(s.currentPeriodEnd)}
          </span>
        ) : (
          <span className="text-xs whitespace-nowrap text-muted">{s.status === 'EXPIRED' ? t('Expired') : t('Ends {d}', { d: fmtDate(s.currentPeriodEnd) })}</span>
        ),
    },
    { key: 'listings', header: t('Listings used'), render: (s) => <UsageBar used={s.usage.activeListings} quota={s.usage.listingQuota} /> },
    {
      key: 'credits',
      header: t('Credits left'),
      hideBelow: 'xl',
      render: (s) => (
        <span className="text-xs whitespace-nowrap text-muted">
          {t('Bumps')} <b className="text-fg">{s.usage.bumpsLeft}</b> · VIP <b className="text-fg">{s.usage.vipCreditsLeft}</b> · Premium <b className="text-fg">{s.usage.premiumCreditsLeft}</b>
        </span>
      ),
    },
    { key: 'card', header: t('Card'), hideBelow: '2xl', render: (s) => <span className="text-xs">{s.cardMask ?? '—'}</span> },
  ];

  return (
    <div>
      <PageHeader title={t('Subscriptions')} subtitle={list.data ? t('{n} business subscriptions', { n: fmtNumber(list.data.total) }) : undefined} />
      <FilterBar>
        <FormField label={t('Status')} className="w-40">
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('All')} options={['ACTIVE', 'CANCELLED', 'PAST_DUE', 'EXPIRED'].map((s) => ({ value: s, label: enumLabel(s) }))} />
        </FormField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(s) => s.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
    </div>
  );
}
