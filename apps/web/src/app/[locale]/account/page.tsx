'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { MyListing } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { dailyCounts, deltaTag, sumSeries } from '@/lib/series';
import { listingStatusTone } from '@/lib/status';
import { locationLabel } from '@/lib/utils';
import {
  BarcodeSpark, BigNumber, Card, CardHeader, CardLink, DataTable, EmptyState, ErrorState, IconLink, LinkButton, Money, PageHeader, PillBarChart, Price,
  PropertyRow, RowCard, Skeleton, SplitMeter, StatCard, StatusPill, TableThumb, type Column,
} from '@/components/ds';
import { ArrowUpRightIcon, ChatIcon, EyeIcon, HomeIcon, PhoneIcon, PlusIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

function useMyStats(listings: MyListing[]) {
  const top = [...listings].sort((a, b) => b.views - a.views).slice(0, 4);
  const stats = useQueries({
    queries: top.map((l) => ({ queryKey: qk.listingStats(l.id), queryFn: () => api.listings.stats(l.id), retry: false, staleTime: 5 * 60_000 })),
  });
  const series = stats.map((s) => (s.data?.daily ?? []).slice(-28));
  const views = sumSeries(series.map((d) => d.map((x) => x.views)));
  const phone = sumSeries(series.map((d) => d.map((x) => x.phoneViews)));
  return { top, stats, views, phone, loading: stats.some((s) => s.isLoading) };
}

export default function AccountOverviewPage() {
  const { t, href, number, locale } = useI18n();
  const { user } = useAuth();
  const mine = useQuery({ queryKey: qk.myListings('ALL', 0), queryFn: () => api.listings.mine({ page: 1, pageSize: 50 }) });
  const tx = useQuery({ queryKey: qk.walletTx(1), queryFn: () => api.wallet.transactions({ page: 1, pageSize: 50 }), retry: false });
  const items = mine.data?.items ?? [];
  const { top, stats, views, phone, loading } = useMyStats(items);

  const active = items.filter((l) => l.status === 'ACTIVE').length;
  const waiting = items.filter((l) => l.status === 'PENDING' || l.status === 'DRAFT').length;
  const totalViews = items.reduce((s, l) => s + l.views, 0);
  const totalPhone = items.reduce((s, l) => s + l.phoneViews, 0);
  const totalFav = items.reduce((s, l) => s + l.favoritesCount, 0);
  const walletSpark = dailyCounts((tx.data?.items ?? []).map((x) => x.createdAt), 28);

  const columns: Column<MyListing>[] = [
    { key: 'name', header: t('overview.colListing'), cell: (l) => <TableThumb src={l.coverUrl} title={l.title} sub={locationLabel(l, locale)} href={href(`/listings/${l.id}`)} /> },
    { key: 'type', header: t('listing.facts.propertyType'), cell: (l) => t(`enums.propertyType.${l.propertyType}`), minWidth: 'xl' },
    { key: 'price', header: t('search.price'), cell: (l) => <Price l={l} className="font-medium" /> },
    { key: 'views', header: t('stats.views'), cell: (l) => <span className="tabular">{t('listing.views', { n: number(l.views) })}</span>, minWidth: 'lg' },
    { key: 'status', header: t('common.status'), cell: (l) => <StatusPill tone={listingStatusTone(l.status)}>{t(`enums.listingStatus.${l.status}`)}</StatusPill> },
    {
      key: 'action',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'right',
      cell: (l) => (
        <IconLink href={href(`/listings/${l.id}/stats`)} label={t('owner.stats')} variant="raised" size="sm">
          <ArrowUpRightIcon size={16} />
        </IconLink>
      ),
    },
  ];

  if (mine.isError) return <ErrorState title={t('myListings.loadError')} text={errorMessage(mine.error, t)} onRetry={() => void mine.refetch()} retryLabel={t('common.retry')} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('overview.hello', { name: user?.name?.split(' ')[0] || '' })}
        sub={t('overview.sub')}
        actions={
          <LinkButton href={href('/listings/new')} icon={<PlusIcon size={18} />}>
            {t('nav.postAd')}
          </LinkButton>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('overview.listingsState')} action={<CardLink href={href('/account/listings')} label={t('account.nav.listings')} />} />
          {mine.isLoading ? (
            <Skeleton className="h-24 rounded-md" />
          ) : (
            <>
              <SplitMeter
                left={{ label: t('overview.active'), amount: active, value: <BigNumber>{number(active)}</BigNumber> }}
                right={{ label: t('overview.waiting'), amount: waiting, value: <BigNumber>{number(waiting)}</BigNumber> }}
                capacity={Math.max(items.length, user?.quota.freeLimit ?? 0)}
              />
              <p className="mt-3 flex items-center gap-2 text-caption text-muted">
                <span className="hatch inline-block h-3 w-6 rounded-pill" aria-hidden />
                {user && user.quota.remaining !== -1 ? t('overview.quotaLeft', { n: Math.max(0, user.quota.remaining), total: user.quota.freeLimit }) : t('overview.otherStatuses', { n: items.length - active - waiting })}
              </p>
            </>
          )}
        </Card>
        <Card className="flex flex-col justify-between">
          <CardHeader title={t('account.wallet.balance')} action={<CardLink href={href('/account/wallet')} label={t('account.nav.wallet')} />} />
          <div className="flex items-end justify-between gap-4">
            <div>
              {user && <Money value={user.wallet.balance + user.wallet.bonusBalance} currency={user.wallet.currency} minor className="font-display text-[38px] leading-none tracking-[-1px]" />}
              <div className="mt-1 text-label font-normal text-ink-secondary">{t('overview.bonusIncluded', { amount: user ? (user.wallet.bonusBalance / 100).toFixed(2) : '0' })}</div>
            </div>
            <BarcodeSpark values={walletSpark} label={t('overview.walletActivity')} />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        <StatCard label={t('stats.views')} icon={<EyeIcon size={18} />} value={number(totalViews)} caption={t('overview.last28')} spark={views.length ? views : undefined} sparkLabel={t('stats.dailyViews')} loading={mine.isLoading} />
        <StatCard label={t('stats.phoneViews')} icon={<PhoneIcon size={18} />} value={number(totalPhone)} caption={t('overview.favoritesN', { n: number(totalFav) })} spark={phone.length ? phone : undefined} sparkLabel={t('stats.phoneViews')} loading={mine.isLoading} />
        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader title={t('overview.topListings')} sub={t('overview.deltaHint')} />
          {mine.isLoading || loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-8 rounded-pill" />
              ))}
            </div>
          ) : top.length ? (
            <PillBarChart
              ariaLabel={t('overview.topListings')}
              rows={top.map((l, i) => {
                const daily = stats[i]?.data?.daily.map((d) => d.views) ?? [];
                return {
                  key: l.id,
                  label: t('listing.views', { n: number(l.views) }),
                  value: l.views,
                  tag: deltaTag(daily) ?? '—',
                  heading: (
                    <Link href={href(`/listings/${l.id}/stats`)} className="truncate hover:underline">
                      {l.title}
                    </Link>
                  ),
                };
              })}
            />
          ) : (
            <p className="text-label text-muted">{t('overview.noStats')}</p>
          )}
        </Card>
      </div>

      {items.length > 0 ? (
        <>
          <Card>
            <CardHeader title={t('overview.propertyObject')} action={<CardLink href={href('/account/listings')} label={t('account.nav.listings')} />} />
            <PropertyRow items={[...items].sort((a, b) => b.views - a.views).slice(0, 4)} />
          </Card>
          <DataTable
            caption={t('overview.recent')}
            toolbar={
              <div className="flex w-full items-center justify-between gap-3 px-1">
                <h2 className="text-h3">{t('overview.recent')}</h2>
                <LinkButton href={href('/account/listings')} variant="secondary" size="sm" trailing={<ArrowUpRightIcon size={15} />}>
                  {t('common.seeAll')}
                </LinkButton>
              </div>
            }
            columns={columns}
            rows={items.slice(0, 5)}
            rowKey={(l) => l.id}
            mobileRow={(l) => (
              <RowCard className="flex items-center gap-3">
                <TableThumb src={l.coverUrl} title={l.title} sub={<Price l={l} />} href={href(`/listings/${l.id}`)} />
                <StatusPill tone={listingStatusTone(l.status)} className="ml-auto min-w-0">
                  {t(`enums.listingStatus.${l.status}`)}
                </StatusPill>
              </RowCard>
            )}
          />
        </>
      ) : (
        !mine.isLoading && <EmptyState icon={<HomeIcon />} title={t('myListings.empty')} text={t('myListings.emptyText')} action={<LinkButton href={href('/listings/new')} icon={<PlusIcon size={18} />}>{t('nav.postAd')}</LinkButton>} />
      )}

      <Card tone="sunken" className="flex flex-wrap items-center justify-between gap-4">
        <span className="flex items-center gap-3 text-label text-ink-secondary">
          <ChatIcon size={18} /> {t('overview.messagesHint', { n: user?.unreadMessages ?? 0 })}
        </span>
        <LinkButton href={href('/account/messages')} variant="primary" size="sm" trailing={<ArrowUpRightIcon size={15} />}>
          {t('account.nav.messages')}
        </LinkButton>
      </Card>
    </div>
  );
}
