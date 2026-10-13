'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { PageHeader } from '@/components/account/PageHeader';
import { useI18n } from '@/components/providers/I18nProvider';
import { BarChart, StatTile } from '@/components/ui/BarChart';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { ChatIcon, EyeIcon, HomeIcon, PhoneIcon } from '@/components/ui/icons';

export default function AgencyStatsPage() {
  const { t, date, number } = useI18n();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const q = useQuery({ queryKey: qk.agencyStats(Number(days)), queryFn: () => api.agencies.stats(Number(days)), retry: false });
  return (
    <div>
      <PageHeader
        title={t('account.nav.agencyStats')}
        actions={<Segmented value={days} onChange={setDays} options={(['7', '30', '90'] as const).map((d) => ({ value: d, label: t('stats.days', { n: d }) }))} />}
      />
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError || !q.data ? (
        <ErrorState title={t('stats.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={t('stats.views')} value={number(q.data.views)} icon={<EyeIcon />} />
            <StatTile label={t('stats.phoneViews')} value={number(q.data.phoneViews)} icon={<PhoneIcon />} />
            <StatTile label={t('stats.messages')} value={number(q.data.messages)} icon={<ChatIcon />} />
            <StatTile label={t('stats.listings')} value={number(q.data.listings)} icon={<HomeIcon />} />
          </div>
          <div className="mt-6">
            <BarChart
              title={t('stats.dailyViews')}
              valueLabel={t('stats.viewsUnit')}
              tableLabel={t('stats.showTable')}
              chartLabel={t('stats.showChart')}
              data={q.data.daily.map((d) => ({ label: date(d.date, { day: 'numeric', month: 'short' }), value: Number(d.value) || 0 }))}
            />
          </div>
        </>
      )}
    </div>
  );
}
