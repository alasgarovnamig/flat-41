'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { EmptyState, ErrorState, LinkButton, PageHeader, Pagination, PropertyGrid, PropertyGridSkeleton } from '@/components/ds';
import { HeartIcon, SearchIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export default function FavoritesPage() {
  const { t, href } = useI18n();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.favorites(page), queryFn: () => api.favorites.list({ page, pageSize: 24 }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title={t('account.nav.favorites')} sub={q.data ? t('favorites.count', { n: q.data.total }) : undefined} />
      {q.isLoading ? (
        <PropertyGridSkeleton n={6} cols={3} />
      ) : q.isError ? (
        <ErrorState title={t('favorites.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<HeartIcon />} title={t('favorites.empty')} text={t('favorites.emptyText')} action={<LinkButton href={href('/search')} icon={<SearchIcon size={18} />}>{t('favorites.browse')}</LinkButton>} />
      ) : (
        <>
          <PropertyGrid items={q.data.items} cols={3} />
          <Pagination className="mt-8" page={page} total={q.data.total} pageSize={24} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />
        </>
      )}
    </div>
  );
}
