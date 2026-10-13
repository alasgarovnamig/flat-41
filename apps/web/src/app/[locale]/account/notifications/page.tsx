'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { AppNotification } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '@/components/ds';
import { BellIcon, BookmarkIcon, BuildingIcon, CalendarIcon, CardIcon, ChatIcon, CheckCheckIcon, ChevronRight, HomeIcon, WalletIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

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

function iconOf(n: AppNotification): ReactNode {
  const d = n.data as Record<string, string | undefined>;
  if (d.conversationId) return <ChatIcon size={18} />;
  if (d.bookingId) return <CalendarIcon size={18} />;
  if (d.paymentId) return <CardIcon size={18} />;
  if (d.savedSearchId) return <BookmarkIcon size={18} />;
  if (n.type.startsWith('SUBSCRIPTION')) return <BuildingIcon size={18} />;
  if (n.type === 'PAYOUT') return <WalletIcon size={18} />;
  if (d.listingId) return <HomeIcon size={18} />;
  return <BellIcon size={18} />;
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
          <Button variant="secondary" loading={readAll.isPending} icon={<CheckCheckIcon size={18} />} onClick={() => readAll.mutate()}>
            {t('notifications.readAll')}
          </Button>
        }
      />
      {q.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState title={t('notifications.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<BellIcon />} title={t('notifications.empty')} />
      ) : (
        <>
          <Card pad="sm">
            <ul className="flex flex-col gap-1">
              {q.data.items.map((n) => {
                const target = targetOf(n, href);
                const unread = !n.readAt;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (unread) read.mutate(n.id);
                        if (target) router.push(target);
                      }}
                      className={cn('flex w-full items-center gap-4 rounded-lg p-3 text-left transition-colors hover:bg-surface-sunken', unread && 'bg-surface-raised shadow-pill')}
                    >
                      <span className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full', unread ? 'bg-ink text-on-ink' : 'bg-surface-sunken text-ink-secondary')}>
                        {iconOf(n)}
                        {unread && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-accent-strong ring-2 ring-surface-raised" aria-label={t('notifications.unread')} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[15px]', unread ? 'font-medium' : 'text-ink-secondary')}>{n.title}</span>
                        <span className="line-clamp-2 block text-label font-normal text-ink-secondary">{n.body}</span>
                        <span className="mt-0.5 block text-caption text-muted">
                          {t(`enums.notificationType.${n.type}`)} · {relative(n.createdAt)}
                        </span>
                      </span>
                      {target && <ChevronRight size={18} className="shrink-0 text-muted" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Pagination className="mt-6" page={page} total={q.data.total} pageSize={20} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />
        </>
      )}
    </div>
  );
}
