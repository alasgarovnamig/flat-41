'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEFAULT_SETTINGS, formatMoney, type ListingCard, type PaymentMethod } from '@evtap/shared';
import { api } from '@/lib/api';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { Button, Card, LinkButton, Money, Notice } from '@/components/ds';
import { DocIcon } from '@/components/ds/icons';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

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
    <Card pad="lg" className="mx-auto max-w-xl">
      <div className="flex h-18 w-18 items-center justify-center rounded-full bg-surface-sunken">
        <DocIcon size={30} />
      </div>
      <h1 className="mt-5 text-h1">{t('fee.title')}</h1>
      <p className="mt-2 text-ink-secondary">{t('fee.text', { free: user?.quota.freeLimit ?? DEFAULT_SETTINGS.freeListingsPerMonth })}</p>
      <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-5 py-4 shadow-pill">
        <span className="line-clamp-2 text-label">{listing.title}</span>
        <Money value={fee} minor className="shrink-0 font-display text-[28px] leading-none tracking-[-0.6px]" />
      </div>
      <div className="mt-5">
        <PayMethodPicker value={method} onChange={setMethod} amount={fee} />
      </div>
      <Notice tone="neutral" className="mt-4">
        {t('fee.draftNote')}
      </Notice>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <Button size="lg" className="flex-1" loading={pay.isPending} onClick={() => pay.mutate()}>
          {t('fee.pay', { amount: formatMoney(fee) })}
        </Button>
        <LinkButton href={href('/account/listings?status=DRAFT')} variant="ghost" size="lg">
          {t('fee.later')}
        </LinkButton>
      </div>
    </Card>
  );
}
