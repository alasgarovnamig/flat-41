import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowRight, Banknote, BadgeCheck, CalendarRange, CreditCard, Flag, Home, Hourglass, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { PAYMENT_PURPOSES, type PaymentPurpose, type TimeseriesPoint } from '@evtap/shared';
import * as api from '../api/client';
import { useOverview } from '../api/queries';
import { ChartCard, makeTooltip, type Series } from '../components/charts';
import { StatCard } from '../components/StatCard';
import { ErrorState, PageHeader, Tabs } from '../components/ui';
import { useT } from '../i18n';
import { enumLabel, fmtDay, fmtNumber, fmtPercent, money } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

const PURPOSE_COLORS: Record<PaymentPurpose, string> = {
  PROMOTION: 'var(--series-1)',
  SUBSCRIPTION: 'var(--series-2)',
  BOOKING: 'var(--series-3)',
  LISTING_FEE: 'var(--series-4)',
  WALLET_TOPUP: 'var(--series-5)',
  VERIFICATION: 'var(--series-6)',
};
// fixed stacking order (colour follows the purpose, never its rank)
const PURPOSE_ORDER: PaymentPurpose[] = ['PROMOTION', 'SUBSCRIPTION', 'BOOKING', 'LISTING_FEE', 'WALLET_TOPUP', 'VERIFICATION'];

const axisProps = {
  tick: { fill: 'var(--chart-axis)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--line)' },
} as const;

const compactMoney = (minor: number) => {
  const v = minor / 100;
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k ₼` : `${Math.round(v)} ₼`;
};

export default function DashboardPage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ days: '30' });
  const days = Number(f.days) || 30;

  const overview = useOverview();
  const revenue = useQuery({ queryKey: ['admin', 'stats', 'revenue', days], queryFn: () => api.getRevenueStats(days) });
  const listings = useQuery({ queryKey: ['admin', 'stats', 'listings', days], queryFn: () => api.getListingStats(days) });
  const users = useQuery({ queryKey: ['admin', 'stats', 'users', days], queryFn: () => api.getUserStats(days) });

  const o = overview.data;
  const successRate = o ? (o.payments.succeeded30d + o.payments.failed30d > 0 ? (o.payments.succeeded30d / (o.payments.succeeded30d + o.payments.failed30d)) * 100 : null) : null;

  // revenue series: only purposes that actually appear, in fixed order
  const revenueSeries: Series[] = useMemo(() => {
    const present = new Set<string>();
    for (const p of revenue.data ?? []) for (const k of PAYMENT_PURPOSES) if (Number(p[k] ?? 0) > 0) present.add(k);
    const keys = present.size ? PURPOSE_ORDER.filter((k) => present.has(k)) : PURPOSE_ORDER;
    return keys.map((k) => ({ key: k, label: enumLabel(k), color: PURPOSE_COLORS[k] }));
  }, [revenue.data, t]); // t: re-label on language change
  const revenueTotal = (revenue.data ?? []).reduce((a, p) => a + Number(p.value ?? 0), 0);

  const listingSeries: Series[] = useMemo(
    () => [
      { key: 'created', label: t('Created'), color: 'var(--series-1)' },
      { key: 'published', label: t('Published'), color: 'var(--series-2)' },
      { key: 'rejected', label: t('Rejected'), color: 'var(--series-3)' },
    ],
    [t],
  );
  // contract: "value = created, published, rejected" → read `created`, falling back to `value`
  const listingData = useMemo(
    () => listings.data?.map((p: TimeseriesPoint) => ({ ...p, created: Number(p.created ?? p.value ?? 0), published: Number(p.published ?? 0), rejected: Number(p.rejected ?? 0) })),
    [listings.data],
  );
  const userSeries: Series[] = useMemo(() => [{ key: 'value', label: t('New users'), color: 'var(--brand)' }], [t]);
  const newUsersTotal = (users.data ?? []).reduce((a, p) => a + Number(p.value ?? 0), 0);

  const RevenueTooltip = useMemo(() => makeTooltip(revenueSeries, (v) => money(v), t('Total')), [revenueSeries, t]);
  const ListingTooltip = useMemo(() => makeTooltip(listingSeries, (v) => fmtNumber(v)), [listingSeries]);
  const UserTooltip = useMemo(() => makeTooltip(userSeries, (v) => fmtNumber(v)), [userSeries]);

  return (
    <div>
      <PageHeader
        title={t('Dashboard')}
        subtitle={t('Platform health at a glance')}
        actions={
          <Tabs
            value={String(days)}
            onChange={(v) => setF({ days: v })}
            tabs={[
              { value: '7', label: t('7 days') },
              { value: '30', label: t('30 days') },
              { value: '90', label: t('90 days') },
            ]}
          />
        }
      />

      {overview.error ? (
        <div className="mb-5 rounded-xl border border-line bg-card">
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} compact />
        </div>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard loading={!o} label={t('Revenue today')} icon={<Banknote className="size-4" />} value={money(o?.revenue.today)} sub={t('Total: {v}', { v: money(o?.revenue.total) })} />
          <StatCard loading={!o} label={t('Revenue, 30 days')} icon={<TrendingUp className="size-4" />} value={money(o?.revenue.last30d)} sub={t('Booking GMV: {v}', { v: money(o?.bookings.gmv30d) })} />
          <StatCard loading={!o} label={t('MRR')} icon={<BadgeCheck className="size-4" />} value={money(o?.subscriptions.mrr)} sub={t('{n} active subscriptions', { n: fmtNumber(o?.subscriptions.active) })} to="/subscriptions" />
          <StatCard loading={!o} label={t('Users')} icon={<Users className="size-4" />} value={fmtNumber(o?.users.total)} sub={t('+{today} today · +{month} in 30 d · {biz} business', { today: fmtNumber(o?.users.newToday), month: fmtNumber(o?.users.new30d), biz: fmtNumber(o?.users.business) })} to="/users" />
          <StatCard loading={!o} label={t('Active listings')} icon={<Home className="size-4" />} value={fmtNumber(o?.listings.active)} sub={t('{total} total · +{today} today', { total: fmtNumber(o?.listings.total), today: fmtNumber(o?.listings.newToday) })} to="/listings?status=ACTIVE" />
          <StatCard loading={!o} label={t('Pending moderation')} icon={<Hourglass className="size-4" />} value={fmtNumber(o?.listings.pending)} sub={t('Open the queue')} to="/moderation" emphasis={o && o.listings.pending > 0 ? 'warning' : undefined} />
          <StatCard loading={!o} label={t('Open reports')} icon={<Flag className="size-4" />} value={fmtNumber(o?.reports.open)} sub={t('Complaints to review')} to="/reports" emphasis={o && o.reports.open > 0 ? 'danger' : undefined} />
          <StatCard loading={!o} label={t('Bookings')} icon={<CalendarRange className="size-4" />} value={fmtNumber(o?.bookings.confirmed)} sub={t('confirmed · {n} upcoming', { n: fmtNumber(o?.bookings.upcoming) })} to="/bookings" />
          <StatCard
            loading={!o}
            label={t('Payment success rate')}
            icon={<CreditCard className="size-4" />}
            value={fmtPercent(successRate)}
            sub={t('{ok} succeeded · {fail} failed (30 d)', { ok: fmtNumber(o?.payments.succeeded30d), fail: fmtNumber(o?.payments.failed30d) })}
            to="/payments"
            emphasis={successRate != null && successRate < 80 ? 'danger' : undefined}
          />
          <StatCard loading={!o} label={t('Total revenue')} icon={<Wallet className="size-4" />} value={money(o?.revenue.total)} sub={t('All time, succeeded payments')} to="/payments?status=SUCCEEDED" />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard
            title={t('Revenue per day')}
            subtitle={revenue.data ? t('{v} in the last {n} days, by purpose', { v: money(revenueTotal), n: days }) : t('By payment purpose')}
            series={revenueSeries}
            data={revenue.data}
            loading={revenue.isLoading}
            error={revenue.error}
            onRetry={() => revenue.refetch()}
            format={(v) => money(v)}
            height={280}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenue.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={days > 30 ? 1 : '18%'}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={16} {...axisProps} />
                <YAxis tickFormatter={compactMoney} width={56} {...axisProps} axisLine={false} />
                <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'var(--hover)' }} />
                {revenueSeries.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="rev"
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={days > 30 ? 0.5 : 1}
                    radius={i === revenueSeries.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <QuickLinks pending={o?.listings.pending} reports={o?.reports.open} byPurpose={o?.revenue.byPurpose30d} />

        <ChartCard
          title={t('Listings')}
          subtitle={t('Created, published and rejected per day')}
          series={listingSeries}
          data={listingData}
          loading={listings.isLoading}
          error={listings.error}
          onRetry={() => listings.refetch()}
          format={fmtNumber}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={listingData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={16} {...axisProps} />
              <YAxis allowDecimals={false} width={36} {...axisProps} axisLine={false} />
              <Tooltip content={<ListingTooltip />} cursor={{ stroke: 'var(--line-strong)' }} />
              {listingSeries.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="xl:col-span-2">
          <ChartCard
            title={t('New users')}
            subtitle={users.data ? t('{n} sign-ups in the last {d} days', { n: fmtNumber(newUsersTotal), d: days }) : undefined}
            series={userSeries}
            data={users.data}
            loading={users.isLoading}
            error={users.error}
            onRetry={() => users.refetch()}
            format={fmtNumber}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={users.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={days > 30 ? 1 : '18%'}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={16} {...axisProps} />
                <YAxis allowDecimals={false} width={36} {...axisProps} axisLine={false} />
                <Tooltip content={<UserTooltip />} cursor={{ fill: 'var(--hover)' }} />
                <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function QuickLinks({ pending, reports, byPurpose }: { pending?: number; reports?: number; byPurpose?: Record<PaymentPurpose, number> }) {
  const { t } = useT();
  const total = byPurpose ? Object.values(byPurpose).reduce((a, b) => a + b, 0) : 0;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
      <h2 className="text-[15px] font-semibold">{t('Needs attention')}</h2>
      <Link to="/moderation" className="group flex items-center gap-3 rounded-lg border border-line p-3 hover:border-brand/50 hover:bg-hover/50">
        <span className="rounded-lg bg-warning-soft p-2 text-warning">
          <Hourglass className="size-4" />
        </span>
        <span className="flex-1">
          <span className="block font-medium">{t('Moderation queue')}</span>
          <span className="text-xs text-muted">{pending == null ? '—' : t('{n} listings waiting', { n: pending })}</span>
        </span>
        <ArrowRight className="size-4 text-muted group-hover:text-fg" />
      </Link>
      <Link to="/reports" className="group flex items-center gap-3 rounded-lg border border-line p-3 hover:border-brand/50 hover:bg-hover/50">
        <span className="rounded-lg bg-danger-soft p-2 text-danger">
          <AlertTriangle className="size-4" />
        </span>
        <span className="flex-1">
          <span className="block font-medium">{t('Reports')}</span>
          <span className="text-xs text-muted">{reports == null ? '—' : t('{n} open complaints', { n: reports })}</span>
        </span>
        <ArrowRight className="size-4 text-muted group-hover:text-fg" />
      </Link>
      {byPurpose && (
        <div className="mt-1">
          <p className="mb-2 text-xs font-medium text-muted">{t('Revenue by purpose, 30 days')}</p>
          <ul className="space-y-2">
            {PURPOSE_ORDER.map((p) => {
              const v = byPurpose[p] ?? 0;
              const pct = total ? (v / total) * 100 : 0;
              return (
                <li key={p}>
                  <div className="flex justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-[2px]" style={{ background: PURPOSE_COLORS[p] }} />
                      {enumLabel(p)}
                    </span>
                    <span className="tabular-nums">{money(v)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: PURPOSE_COLORS[p] }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
