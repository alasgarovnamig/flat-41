'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Review } from '@evtap/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Avatar, BigNumber, Button, Card, Pagination, Skeleton, Textarea } from '@/components/ds';
import { StarIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex', className)} role="img" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={size} filled={i <= Math.round(value)} className={i <= Math.round(value) ? 'text-star' : 'text-subtle'} />
      ))}
    </span>
  );
}

function ReviewItem({ r, canReply }: { r: Review; canReply: boolean }) {
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const reply = useMutation({
    mutationFn: () => api.bookings.replyReview(r.id, text.trim()),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['listings', r.listingId, 'reviews'] });
    },
  });
  return (
    <li className="rounded-lg bg-surface-raised p-4 shadow-pill">
      <div className="flex items-center gap-3">
        <Avatar name={r.author.name} url={r.author.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{r.author.name}</div>
          <div className="flex items-center gap-2 text-caption text-muted">
            <Stars value={r.rating} size={12} /> {date(r.createdAt, { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ink-secondary">{r.comment}</p>
      {r.hostReply && (
        <div className="mt-3 rounded-md bg-surface-sunken p-3 text-[14px]">
          <div className="mb-1 text-caption text-muted">{t('reviews.hostReply')}</div>
          {r.hostReply}
        </div>
      )}
      {canReply && !r.hostReply && (
        <div className="mt-3">
          {open ? (
            <div className="flex flex-col gap-2">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={t('reviews.reply')} maxLength={2000} />
              <div className="flex gap-2">
                <Button size="sm" loading={reply.isPending} disabled={!text.trim()} onClick={() => reply.mutate()}>
                  {t('common.send')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              {t('reviews.reply')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function Reviews({ listingId, rating, count, isOwner }: { listingId: string; rating: number | null; count: number; isOwner: boolean }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.reviews(listingId, page), queryFn: () => api.listings.reviews(listingId, { page, pageSize: 5 }), retry: false });
  return (
    <Card aria-labelledby="reviews-h">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 id="reviews-h" className="text-h3">
          {t('reviews.title')}
        </h2>
        <div className="flex items-center gap-2">
          <StarIcon size={20} filled className="text-star" />
          <BigNumber size="sm">{rating != null ? rating.toFixed(1) : '—'}</BigNumber>
          <span className="text-label font-normal text-muted">· {t('reviews.count', { n: q.data?.total ?? count })}</span>
        </div>
      </div>
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : q.isError ? (
        <p className="text-label text-muted">{t('reviews.loadError')}</p>
      ) : !q.data?.items.length ? (
        <p className="rounded-lg bg-surface-sunken p-4 text-label text-ink-secondary">{t('reviews.empty')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {q.data.items.map((r) => (
              <ReviewItem key={r.id} r={r} canReply={isOwner} />
            ))}
          </ul>
          <Pagination className="mt-4" page={page} total={q.data.total} pageSize={5} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />
        </>
      )}
    </Card>
  );
}
