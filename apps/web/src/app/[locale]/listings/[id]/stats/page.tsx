'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useI18n } from '@/components/providers/I18nProvider';
import { BarChart, StatTile } from '@/components/ui/BarChart';
import { LinkButton } from '@/components/ui/Button';
import { ErrorState, PageSpinner } from '@/components/ui/feedback';
import { ArrowUpIcon, ChatIcon, EyeIcon, HeartIcon, PhoneIcon } from '@/components/ui/icons';

function Stats({ id }: { id: string }) {
  const { t, href, date, number } = useI18n();
  const listing = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listings.get(id), retry: false });
  const q = useQuery({ queryKey: qk.listingStats(id), queryFn: () => api.listings.stats(id), retry: false });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <ErrorState title={t('stats.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />;
  const s = q.data;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
          {listing.data && <p className="line-clamp-1 text-muted">{listing.data.title}</p>}
        </div>
        <LinkButton href={href(`/listings/${id}/promote`)} variant="premium" icon={<ArrowUpIcon size={18} />}>
          {t('owner.promote')}
        </LinkButton>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t('stats.views')} value={number(s.views)} icon={<EyeIcon />} />
        <StatTile label={t('stats.phoneViews')} value={number(s.phoneViews)} icon={<PhoneIcon />} />
        <StatTile label={t('stats.favorites')} value={number(s.favorites)} icon={<HeartIcon />} />
        <StatTile label={t('stats.messages')} value={number(s.messages)} icon={<ChatIcon />} />
      </div>
      <div className="mt-6">
        <BarChart
          title={t('stats.dailyViews')}
          valueLabel={t('stats.viewsUnit')}
          tableLabel={t('stats.showTable')}
          chartLabel={t('stats.showChart')}
          data={s.daily.map((d) => ({ label: date(d.date, { day: 'numeric', month: 'short' }), value: d.views, extra: t('stats.phoneViewsN', { n: d.phoneViews }) }))}
        />
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
