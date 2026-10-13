'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/feedback';
import { CheckIcon } from '@/components/ui/icons';
import { ListingFeePayment } from '@/components/wizard/ListingFeePayment';

function PayFee({ id }: { id: string }) {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: ['listings', 'detail', id], queryFn: () => api.listings.get(id), retry: false });
  if (q.isLoading) return <PageSpinner />;
  if (q.isError || !q.data) return <ErrorState title={t('listing.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />;
  if (q.data.status !== 'DRAFT')
    return <EmptyState icon={<CheckIcon />} title={t('fee.notRequired')} action={<LinkButton href={href(`/listings/${id}`)}>{t('wizard.viewListing')}</LinkButton>} />;
  return <ListingFeePayment listing={q.data} />;
}

export default function PayListingFeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="container-page py-10">
      <RequireAuth>
        <PayFee id={id} />
      </RequireAuth>
    </div>
  );
}
