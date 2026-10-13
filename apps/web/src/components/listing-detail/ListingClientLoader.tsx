'use client';

import { useQuery } from '@tanstack/react-query';
import { api, isApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { ErrorState, LinkButton, PageSpinner } from '@/components/ds';
import { SearchIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { ListingDetailView } from './ListingDetailView';

/**
 * Client-side fallback when SSR could not load the listing: either the API was unreachable,
 * or the listing is not public (DRAFT / PENDING / REJECTED…) and only the logged-in owner may see it.
 */
export function ListingClientLoader({ id }: { id: string }) {
  const { t, href } = useI18n();
  const { status } = useAuth();
  const q = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listings.get(id), enabled: status !== 'loading', retry: 1 });
  if (status === 'loading' || q.isLoading) return <PageSpinner />;
  if (q.data) return <ListingDetailView initial={q.data} />;
  const notFound = isApiError(q.error) && (q.error.status === 404 || q.error.status === 403);
  return (
    <div className="container-page py-16">
      {notFound ? (
        <div className="flex flex-col items-center text-center">
          <div className="font-display text-[96px] font-light leading-none tracking-[-4px]">404</div>
          <h1 className="mt-4 text-h2">{t('listing.notFound')}</h1>
          <p className="mt-2 max-w-md text-ink-secondary">{t('listing.notFoundText')}</p>
          <LinkButton href={href('/search')} className="mt-8" icon={<SearchIcon size={18} />}>
            {t('notFound.search')}
          </LinkButton>
        </div>
      ) : (
        <ErrorState title={t('listing.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      )}
    </div>
  );
}
