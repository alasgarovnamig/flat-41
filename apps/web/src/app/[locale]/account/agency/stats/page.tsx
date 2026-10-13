'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { Card, CardHeader, ColumnChart, EmptyState, ErrorState, LinkButton, PageHeader, Segmented, Skeleton, StatCard } from '@/components/ds';
import { useAuth } from '@/components/providers/AuthProvider';
import { BuildingIcon, ChatIcon, EyeIcon, HomeIcon, PhoneIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export default function AgencyStatsPage() {
  const { t, date, number } = useI18n();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { user } = useAuth();
  const { href } = useI18n();
  const hasAgency = !!user?.agencyId;
  const q = useQuery({ queryKey: qk.agencyStats(Number(days)), queryFn: () => api.agencies.stats(Number(days)), retry: false, enabled: hasAgency });
  const daily = (q.data?.daily ?? []).map((d) => Number(d.value) || 0);
  return (
    <div>
      <PageHeader
        title={t('account.nav.agencyStats')}
        actions={<Segmented ariaLabel={t('stats.period')} value={days} onChange={setDays} options={(['7', '30', '90'] as const).map((d) => ({ value: d, label: t('stats.days', { n: d }) }))} />}
      />
      {!hasAgency ? (
        <EmptyState icon={<BuildingIcon />} title={t('agency.noAgency')} text={t('agency.createIntro')} action={<LinkButton href={href('/account/agency')}>{t('agency.create')}</LinkButton>} />
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : q.isError || !q.data ? (
        <ErrorState title={t('stats.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard size="sm" label={t('stats.views')} icon={<EyeIcon size={18} />} value={number(q.data.views)} caption={t('stats.days', { n: days })} spark={daily} sparkLabel={t('stats.dailyViews')} />
            <StatCard size="sm" label={t('stats.phoneViews')} icon={<PhoneIcon size={18} />} value={number(q.data.phoneViews)} caption={t('stats.days', { n: days })} />
            <StatCard size="sm" label={t('stats.messages')} icon={<ChatIcon size={18} />} value={number(q.data.messages)} caption={t('stats.days', { n: days })} />
            <StatCard size="sm" label={t('stats.listings')} icon={<HomeIcon size={18} />} value={number(q.data.listings)} caption={t('stats.activeNow')} />
          </div>
          <Card className="mt-5">
            <CardHeader title={t('stats.dailyViews')} />
            <ColumnChart
              valueLabel={t('stats.viewsUnit')}
              tableLabel={t('stats.showTable')}
              chartLabel={t('stats.showChart')}
              data={q.data.daily.map((d) => ({ label: date(d.date, { day: 'numeric', month: 'short' }), value: Number(d.value) || 0 }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}
