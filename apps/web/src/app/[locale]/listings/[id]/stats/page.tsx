'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { deltaTag } from '@/lib/series';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Card, CardHeader, ColumnChart, ErrorState, Img, LinkButton, PageHeader, PageSpinner, PillBarChart, Price, StatCard } from '@/components/ds';
import { ArrowUpIcon, ChatIcon, EyeIcon, HeartIcon, PhoneIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

function Stats({ id }: { id: string }) {
  const { t, href, date, number } = useI18n();
  const listing = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listings.get(id), retry: false });
  const q = useQuery({ queryKey: qk.listingStats(id), queryFn: () => api.listings.stats(id), retry: false });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <ErrorState title={t('stats.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />;
  const s = q.data;
  const views = s.daily.map((d) => d.views);
  const phones = s.daily.map((d) => d.phoneViews);
  // weekly buckets (newest first) for the PillBarChart
  const weeks = Array.from({ length: Math.min(4, Math.floor(views.length / 7)) }, (_, i) => {
    const end = views.length - i * 7;
    const slice = views.slice(end - 7, end);
    const prev = views.slice(Math.max(0, end - 14), end - 7);
    return { i, total: slice.reduce((a, b) => a + b, 0), tag: deltaTag([...prev, ...slice]) ?? '—', from: s.daily[end - 7]?.date, to: s.daily[end - 1]?.date };
  });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('stats.title')}
        sub={listing.data?.title}
        actions={
          <LinkButton href={href(`/listings/${id}/promote`)} icon={<ArrowUpIcon size={18} />}>
            {t('owner.promote')}
          </LinkButton>
        }
      />
      {listing.data && (
        <Card pad="sm" className="mb-5 flex items-center gap-4">
          <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md">
            <Img src={listing.data.coverUrl} alt="" fill sizes="96px" className="object-cover" />
          </span>
          <span className="min-w-0">
            <Price l={listing.data} className="block font-display text-[22px] leading-tight" />
            <span className="block truncate text-label text-ink-secondary">{listing.data.title}</span>
          </span>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard size="sm" label={t('stats.views')} icon={<EyeIcon size={18} />} value={number(s.views)} caption={deltaTag(views) ? `${deltaTag(views)} · ${t('stats.weekOverWeek')}` : undefined} spark={views} sparkLabel={t('stats.dailyViews')} />
        <StatCard size="sm" label={t('stats.phoneViews')} icon={<PhoneIcon size={18} />} value={number(s.phoneViews)} caption={deltaTag(phones) ? `${deltaTag(phones)} · ${t('stats.weekOverWeek')}` : undefined} spark={phones} sparkLabel={t('stats.phoneViews')} />
        <StatCard size="sm" label={t('stats.favorites')} icon={<HeartIcon size={18} />} value={number(s.favorites)} />
        <StatCard size="sm" label={t('stats.messages')} icon={<ChatIcon size={18} />} value={number(s.messages)} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t('stats.dailyViews')} />
          <ColumnChart
            valueLabel={t('stats.viewsUnit')}
            tableLabel={t('stats.showTable')}
            chartLabel={t('stats.showChart')}
            data={s.daily.map((d) => ({ label: date(d.date, { day: 'numeric', month: 'short' }), value: d.views, extra: t('stats.phoneViewsN', { n: d.phoneViews }) }))}
          />
        </Card>
        <Card>
          <CardHeader title={t('stats.weekly')} sub={t('overview.deltaHint')} />
          {weeks.length ? (
            <PillBarChart
              ariaLabel={t('stats.weekly')}
              rows={weeks.map((w) => ({
                key: String(w.i),
                label: t('listing.views', { n: number(w.total) }),
                value: w.total,
                tag: w.tag,
                heading: <span>{w.from && w.to ? `${date(w.from, { day: 'numeric', month: 'short' })} – ${date(w.to, { day: 'numeric', month: 'short' })}` : ''}</span>,
              }))}
            />
          ) : (
            <p className="text-label text-muted">{t('overview.noStats')}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function ListingStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="container-page py-8">
      <RequireAuth>
        <Stats id={id} />
      </RequireAuth>
    </div>
  );
}
