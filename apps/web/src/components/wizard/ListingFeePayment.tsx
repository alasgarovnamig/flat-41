'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_SETTINGS, formatMoney, type ListingCard, type PaymentMethod } from '@evtap/shared';
import { api } from '@/lib/api';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert } from '@/components/ui/feedback';
import { DocIcon } from '@/components/ui/icons';

/** DRAFT listing waiting for the listing fee (free quota exhausted) → POST /checkout { purpose: LISTING_FEE }. */
export function ListingFeePayment({ listing }: { listing: Pick<ListingCard, 'id' | 'title'> }) {
  const { t, href, locale } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const catalog = useQuery({ queryKey: qk.catalog, queryFn: api.ref.catalog, staleTime: 5 * 60_000, retry: false });
  const fee = user?.quota.listingFee ?? catalog.data?.settings.listingFee ?? DEFAULT_SETTINGS.listingFee;
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const pay = useMutation({
    mutationFn: () => api.payments.checkout({ purpose: 'LISTING_FEE', listingId: listing.id, method, returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (c) => followCheckout(c, locale, router.push),
  });
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-vip-50 text-amber-600">
        <DocIcon size={28} />
      </div>
      <h1 className="mt-4 text-2xl font-bold">{t('fee.title')}</h1>
      <p className="mt-1 text-muted">{t('fee.text', { free: user?.quota.freeLimit ?? DEFAULT_SETTINGS.freeListingsPerMonth })}</p>
      <div className="mt-5 flex items-center justify-between rounded-xl bg-surface px-4 py-3">
        <span className="line-clamp-1 pr-3 text-sm">{listing.title}</span>
        <span className="text-lg font-bold">{formatMoney(fee)}</span>
      </div>
      <div className="mt-5">
        <PayMethodPicker value={method} onChange={setMethod} amount={fee} />
      </div>
      <Alert tone="info" className="mt-4">{t('fee.draftNote')}</Alert>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <Button size="lg" className="flex-1" loading={pay.isPending} onClick={() => pay.mutate()}>
          {t('fee.pay', { amount: formatMoney(fee) })}
        </Button>
        <LinkButton href={href('/account/listings?status=DRAFT')} variant="ghost" size="lg">
          {t('fee.later')}
        </LinkButton>
      </div>
    </div>
  );
}
