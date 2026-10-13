'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { formatMoney, type PaymentStatus } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { PageHeader } from '@/components/account/PageHeader';
import { useI18n } from '@/components/providers/I18nProvider';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { CardIcon } from '@/components/ui/icons';
import { Pagination } from '@/components/ui/Pagination';

const TONE: Record<PaymentStatus, 'green' | 'gray' | 'urgent' | 'vip' | 'blue'> = {
  CREATED: 'gray', PENDING: 'vip', SUCCEEDED: 'green', FAILED: 'urgent', CANCELLED: 'gray', REFUNDED: 'blue', PARTIALLY_REFUNDED: 'blue',
};

export default function PaymentsPage() {
  const { t, href, dateTime } = useI18n();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.payments(page), queryFn: () => api.payments.list({ page, pageSize: 15 }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title={t('account.nav.payments')} sub={t('payments.sub')} />
      {q.isLoading ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState title={t('payments.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<CardIcon />} title={t('payments.empty')} />
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {q.data.items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{p.description || t(`enums.paymentPurpose.${p.purpose}`)}</div>
                  <div className="text-xs text-muted">
                    {t(`enums.paymentPurpose.${p.purpose}`)} · {p.method === 'WALLET' ? t('payment.wallet') : `${t('payment.card')}${p.cardMask ? ` ${p.cardMask}` : ''}`} · {dateTime(p.createdAt)}
                  </div>
                  {p.items.length > 1 && <div className="mt-1 text-xs text-muted">{p.items.map((i) => i.name).join(', ')}</div>}
                  {p.failureReason && <div className="mt-1 text-xs text-urgent">{p.failureReason}</div>}
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">{formatMoney(p.amount, p.currency)}</div>
                  {p.refundedAmount > 0 && <div className="text-xs text-muted">{t('bookings.refunded')}: {formatMoney(p.refundedAmount, p.currency)}</div>}
                </div>
                <Badge tone={TONE[p.status]}>{t(`enums.paymentStatus.${p.status}`)}</Badge>
                {(p.status === 'PENDING' || p.status === 'CREATED') && (
                  <Link className="text-sm font-semibold text-brand hover:underline" href={`${href('/payment/result')}?paymentId=${p.id}`}>
                    {t('payments.check')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Pagination className="mt-4" page={page} total={q.data.total} pageSize={15} onChange={setPage} />
        </>
      )}
    </div>
  );
}
