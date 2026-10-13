'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { ErrorState, PageSpinner } from '@/components/ds';
import { ListingWizard } from './ListingWizard';
import { fromListing } from './wizard-model';

export function EditListing({ id }: { id: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['listings', 'edit', id],
    // owner request → the DTO carries contactPhone and image uploadIds
    queryFn: async () => fromListing(await api.listings.get(id), user?.phone ?? ''),
    retry: false,
    staleTime: Infinity,
  });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <ErrorState title={t('listing.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />;
  return <ListingWizard mode="edit" initial={q.data} listingId={id} />;
}
