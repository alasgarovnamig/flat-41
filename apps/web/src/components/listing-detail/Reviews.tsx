'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Review } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { qk } from '@/lib/query-keys';
import { cn, initials } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { StarIcon } from '@/components/ui/icons';
import { Pagination } from '@/components/ui/Pagination';

export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex', className)} aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} size={size} filled={i <= Math.round(value)} className={i <= Math.round(value) ? 'text-vip' : 'text-ink/20'} />
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
  const avatar = assetUrl(r.author.avatarUrl);
  return (
    <li className="border-b border-line py-4 last:border-0">
      <div className="flex items-center gap-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand">{initials(r.author.name)}</span>
        )}
        <div>
          <div className="text-sm font-semibold">{r.author.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Stars value={r.rating} size={12} /> {date(r.createdAt, { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{r.comment}</p>
      {r.hostReply && (
        <div className="ml-6 mt-3 rounded-xl bg-surface p-3 text-sm">
          <div className="mb-1 text-xs font-semibold text-muted">{t('reviews.hostReply')}</div>
          {r.hostReply}
        </div>
      )}
      {canReply && !r.hostReply && (
        <div className="ml-6 mt-2">
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
            <button type="button" className="text-sm font-semibold text-brand hover:underline" onClick={() => setOpen(true)}>
              {t('reviews.reply')}
            </button>
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
    <section aria-labelledby="reviews-h">
      <h2 id="reviews-h" className="flex items-center gap-2 text-xl font-bold">
        <StarIcon className="text-vip" /> {rating != null ? rating.toFixed(1) : '—'} · {t('reviews.count', { n: q.data?.total ?? count })}
      </h2>
      {q.isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : q.isError ? (
        <p className="mt-3 text-sm text-muted">{t('reviews.loadError')}</p>
      ) : !q.data?.items.length ? (
        <p className="mt-3 text-sm text-muted">{t('reviews.empty')}</p>
      ) : (
        <>
          <ul className="mt-2">
            {q.data.items.map((r) => (
              <ReviewItem key={r.id} r={r} canReply={isOwner} />
            ))}
          </ul>
          <Pagination className="mt-4" page={page} total={q.data.total} pageSize={5} onChange={setPage} />
        </>
      )}
    </section>
  );
}
