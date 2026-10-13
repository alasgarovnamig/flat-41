'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { DealType } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { HomeIcon } from '@/components/ui/icons';
import { Pagination } from '@/components/ui/Pagination';
import { Tabs } from '@/components/ui/Tabs';
import { ListingGrid, ListingGridSkeleton } from './ListingCard';

/** Listings of an agency (agencyId) or a user (ownerId) with deal-type tabs. */
export function OwnerListings({ agencyId, ownerId }: { agencyId?: string; ownerId?: string }) {
  const { t } = useI18n();
  const [deal, setDeal] = useState<'ALL' | DealType>('ALL');
  const [page, setPage] = useState(1);
  const params = { agencyId, ownerId, dealType: deal === 'ALL' ? undefined : deal, page, pageSize: 12, sort: 'date_desc' as const };
  const q = useQuery({ queryKey: qk.search(params), queryFn: () => api.listings.search(params), placeholderData: keepPreviousData });
  return (
    <section>
      <Tabs
        className="mb-4"
        value={deal}
        onChange={(v) => { setDeal(v); setPage(1); }}
        tabs={(['ALL', 'SALE', 'RENT_LONG', 'RENT_DAILY'] as const).map((d) => ({ value: d, label: d === 'ALL' ? t('common.all') : t(`enums.dealType.${d}`) }))}
      />
      {q.isLoading ? (
        <ListingGridSkeleton n={6} cols={3} />
      ) : q.isError && !q.data ? (
        <ErrorState title={t('search.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<HomeIcon />} title={t('agencies.noListings')} />
      ) : (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <ListingGrid items={q.data.items} cols={3} />
          <Pagination className="mt-6" page={page} total={q.data.total} pageSize={12} onChange={setPage} />
        </div>
      )}
    </section>
  );
}
