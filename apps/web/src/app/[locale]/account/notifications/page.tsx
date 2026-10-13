'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AppNotification } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/account/PageHeader';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { BellIcon } from '@/components/ui/icons';
import { Pagination } from '@/components/ui/Pagination';

/** Best-effort deep link from notification data. */
function targetOf(n: AppNotification, href: (p: string) => string): string | null {
  const d = n.data as Record<string, string | undefined>;
  if (d.conversationId) return `${href('/account/messages')}?c=${d.conversationId}`;
  if (d.bookingId) return href('/account/bookings');
  if (d.paymentId) return `${href('/payment/result')}?paymentId=${d.paymentId}`;
  if (d.savedSearchId) return href('/account/saved-searches');
  if (n.type.startsWith('SUBSCRIPTION')) return href('/account/business');
  if (n.type === 'PAYOUT') return href('/account/wallet');
  if (d.listingId) return href(`/listings/${d.listingId}`);
  return null;
}

export default function NotificationsPage() {
  const { t, href, relative } = useI18n();
  const { refresh } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.notifications(page), queryFn: () => api.notifications.list({ page, pageSize: 20 }), placeholderData: keepPreviousData });
  const after = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    refresh();
  };
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: after });
  const read = useMutation({ mutationFn: api.notifications.read, onSuccess: after, meta: { silent: true } });
  return (
    <div>
      <PageHeader
        title={t('account.nav.notifications')}
        actions={
          <Button variant="outline" size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>
            {t('notifications.readAll')}
          </Button>
        }
      />
      {q.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState title={t('notifications.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<BellIcon />} title={t('notifications.empty')} />
      ) : (
        <>
          <ul className="card divide-y divide-line overflow-hidden">
            {q.data.items.map((n) => {
              const target = targetOf(n, href);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) read.mutate(n.id);
                      if (target) router.push(target);
                    }}
                    className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface', !n.readAt && 'bg-brand-50/50')}
                  >
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{n.title}</span>
                      <span className="block text-sm text-ink/80">{n.body}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {t(`enums.notificationType.${n.type}`)} · {relative(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Pagination className="mt-6" page={page} total={q.data.total} pageSize={20} onChange={setPage} />
        </>
      )}
    </div>
  );
}
