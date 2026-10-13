'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Payment } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { paymentStatusTone } from '@/lib/status';
import { DataTable, EmptyState, ErrorState, IconLink, Money, PageHeader, Pagination, RowCard, StatusPill, type Column } from '@/components/ds';
import { ArrowUpRightIcon, CardIcon, ReceiptIcon, WalletIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export default function PaymentsPage() {
  const { t, href, dateTime } = useI18n();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.payments(page), queryFn: () => api.payments.list({ page, pageSize: 15 }), placeholderData: keepPreviousData });
  const method = (p: Payment) => (p.method === 'WALLET' ? t('payment.wallet') : `${t('payment.card')}${p.cardMask ? ` ${p.cardMask}` : ''}`);
  const columns: Column<Payment>[] = [
    {
      key: 'desc',
      header: t('result.description'),
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-surface-sunken">{p.method === 'WALLET' ? <WalletIcon size={20} /> : <CardIcon size={20} />}</span>
          <span className="min-w-0">
            <span className="block max-w-[20rem] truncate font-medium">{p.description || t(`enums.paymentPurpose.${p.purpose}`)}</span>
            <span className="block truncate text-caption text-muted">{t(`enums.paymentPurpose.${p.purpose}`)}</span>
            {p.failureReason && <span className="block truncate text-caption text-danger">{p.failureReason}</span>}
          </span>
        </span>
      ),
    },
    { key: 'method', header: t('payment.method'), cell: method, minWidth: 'lg' },
    { key: 'date', header: t('common.date'), cell: (p) => <span className="whitespace-nowrap text-ink-secondary">{dateTime(p.createdAt)}</span>, minWidth: 'md' },
    {
      key: 'amount',
      header: t('common.amount'),
      align: 'right',
      cell: (p) => (
        <span className="flex flex-col items-end">
          <Money value={p.amount} currency={p.currency} minor className="font-medium" />
          {p.refundedAmount > 0 && <span className="text-caption text-muted">{t('bookings.refunded')}: <Money value={p.refundedAmount} currency={p.currency} minor /></span>}
        </span>
      ),
    },
    { key: 'status', header: t('common.status'), cell: (p) => <StatusPill tone={paymentStatusTone(p.status)}>{t(`enums.paymentStatus.${p.status}`)}</StatusPill> },
    {
      key: 'action',
      header: <span className="sr-only">{t('common.actions')}</span>,
      align: 'right',
      cell: (p) => (
        <IconLink href={`${href('/payment/result')}?paymentId=${p.id}`} label={p.status === 'PENDING' || p.status === 'CREATED' ? t('payments.check') : t('payments.details')} variant="raised" size="sm">
          <ArrowUpRightIcon size={16} />
        </IconLink>
      ),
    },
  ];
  return (
    <div>
      <PageHeader title={t('account.nav.payments')} sub={t('payments.sub')} />
      {q.isError ? (
        <ErrorState title={t('payments.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <DataTable
          caption={t('account.nav.payments')}
          loading={q.isLoading}
          columns={columns}
          rows={q.data?.items}
          rowKey={(p) => p.id}
          empty={<EmptyState className="shadow-none" icon={<ReceiptIcon />} title={t('payments.empty')} />}
          mobileRow={(p) => (
            <RowCard>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.description || t(`enums.paymentPurpose.${p.purpose}`)}</span>
                  <span className="block truncate text-caption text-muted">{method(p)} · {dateTime(p.createdAt)}</span>
                </span>
                <Money value={p.amount} currency={p.currency} minor className="font-medium" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <StatusPill tone={paymentStatusTone(p.status)}>{t(`enums.paymentStatus.${p.status}`)}</StatusPill>
                <IconLink href={`${href('/payment/result')}?paymentId=${p.id}`} label={t('payments.details')} variant="raised" size="sm">
                  <ArrowUpRightIcon size={16} />
                </IconLink>
              </div>
            </RowCard>
          )}
          footer={q.data && <Pagination className="mt-4" page={page} total={q.data.total} pageSize={15} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />}
        />
      )}
    </div>
  );
}
