'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DEFAULT_SETTINGS, BOOKING_STATUSES, formatMoney, formatPhone, reviewSchema, type Booking, type BookingStatus } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn, locationLabel, todayIso } from '@/lib/utils';
import { PageHeader } from '@/components/account/PageHeader';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Segmented, Select, Textarea } from '@/components/ui/form';
import { CalendarIcon, PhoneIcon, StarIcon } from '@/components/ui/icons';
import { Img } from '@/components/ui/Img';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';

type Role = 'guest' | 'host';
const TONE: Record<BookingStatus, 'green' | 'gray' | 'urgent' | 'vip' | 'blue'> = { PENDING_PAYMENT: 'vip', CONFIRMED: 'green', CANCELLED: 'gray', COMPLETED: 'blue', REFUNDED: 'gray' };

function ReviewModal({ b, open, onClose }: { b: Booking; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.bookings.review(b.id, { rating, comment: comment.trim() }),
    onSuccess: () => {
      toast.success(t('bookings.reviewThanks'));
      onClose();
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
  const submit = () => {
    const r = reviewSchema.safeParse({ rating, comment });
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    m.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('bookings.writeReview')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={m.isPending} onClick={submit}>{t('common.send')}</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{b.listing.title}</p>
      <div className="mb-4 flex gap-1" role="radiogroup" aria-label={t('bookings.rating')}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={`${i}`} onClick={() => setRating(i)}>
            <StarIcon size={32} filled={i <= rating} className={i <= rating ? 'text-vip' : 'text-ink/20'} />
          </button>
        ))}
      </div>
      <Textarea label={t('bookings.comment')} rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} error={errors.comment} />
    </Modal>
  );
}

function CancelModal({ b, role, open, onClose }: { b: Booking; role: Role; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const hoursLeft = (Date.parse(b.checkIn + 'T00:00:00') - Date.now()) / 3_600_000;
  const full = role === 'host' || hoursLeft >= DEFAULT_SETTINGS.freeCancellationHours || b.status === 'PENDING_PAYMENT';
  const m = useMutation({
    mutationFn: () => api.bookings.cancel(b.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success(t('bookings.cancelled'));
      onClose();
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('bookings.cancelTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.back')}</Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>{t('bookings.cancelConfirm')}</Button>
        </>
      }
    >
      <Alert tone={full ? 'info' : 'warning'} className="mb-4">
        {full ? t('bookings.refundFull') : t('bookings.refundHalf', { hours: DEFAULT_SETTINGS.freeCancellationHours })}
      </Alert>
      <Textarea label={t('bookings.cancelReason')} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function BookingCard({ b, role }: { b: Booking; role: Role }) {
  const { t, href, date, locale } = useI18n();
  const [review, setReview] = useState(false);
  const [cancel, setCancel] = useState(false);
  const other = role === 'guest' ? b.host : b.guest;
  const upcoming = b.checkIn >= todayIso();
  const canCancel = (b.status === 'CONFIRMED' && upcoming) || (b.status === 'PENDING_PAYMENT' && role === 'guest');
  return (
    <li className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <Link href={href(`/listings/${b.listing.id}`)} className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl sm:w-44">
          <Img src={b.listing.coverUrl} alt={b.listing.title} fill sizes="180px" className="object-cover" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={href(`/listings/${b.listing.id}`)} className="line-clamp-1 font-semibold hover:text-brand">{b.listing.title}</Link>
              <div className="text-xs text-muted">{locationLabel({ cityId: b.listing.cityId, districtId: null, metroId: null }, locale)}{b.listing.address ? `, ${b.listing.address}` : ''}</div>
            </div>
            <Badge tone={TONE[b.status]}>{t(`enums.bookingStatus.${b.status}`)}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-muted">{t('booking.checkIn')}</div><div className="font-medium">{date(b.checkIn)}</div></div>
            <div><div className="text-xs text-muted">{t('booking.checkOut')}</div><div className="font-medium">{date(b.checkOut)}</div></div>
            <div><div className="text-xs text-muted">{t('booking.guests')}</div><div className="font-medium">{b.guests} · {t('booking.nightsN', { n: b.nights })}</div></div>
            <div>
              <div className="text-xs text-muted">{role === 'guest' ? t('booking.total') : t('bookings.payout')}</div>
              <div className="font-bold">{formatMoney(role === 'guest' ? b.total : b.hostPayout, b.currency)}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>{role === 'guest' ? t('bookings.host') : t('bookings.guest')}: <b className="text-ink">{other.name}</b></span>
            {other.phone && b.status === 'CONFIRMED' && (
              <a href={`tel:${other.phone}`} className="flex items-center gap-1 font-semibold text-brand"><PhoneIcon size={12} /> {formatPhone(other.phone)}</a>
            )}
            {role === 'host' && <span>{t('bookings.payoutStatus')}: {t(`enums.payoutStatus.${b.payoutStatus}`)}</span>}
            {role === 'host' && <span>{t('bookings.hostFee')}: {formatMoney(b.hostFee, b.currency)}</span>}
            {b.refundedAmount > 0 && <span className="text-urgent">{t('bookings.refunded')}: {formatMoney(b.refundedAmount, b.currency)}</span>}
            {b.cancelReason && <span>{t('bookings.reason')}: {b.cancelReason}</span>}
          </div>
          {b.status === 'PENDING_PAYMENT' && role === 'guest' && <Alert tone="warning" className="mt-3">{t('bookings.pendingPayment')}</Alert>}
          <div className="mt-3 flex flex-wrap gap-2">
            {role === 'guest' && b.canReview && <Button size="sm" variant="vip" icon={<StarIcon size={14} />} onClick={() => setReview(true)}>{t('bookings.writeReview')}</Button>}
            {canCancel && <Button size="sm" variant="ghost" className="text-urgent" onClick={() => setCancel(true)}>{t('bookings.cancel')}</Button>}
            {role === 'host' && <Link href={href(`/account/calendar?listing=${b.listing.id}`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:bg-ink/5"><CalendarIcon size={14} /> {t('owner.calendar')}</Link>}
          </div>
        </div>
      </div>
      <ReviewModal b={b} open={review} onClose={() => setReview(false)} />
      <CancelModal b={b} role={role} open={cancel} onClose={() => setCancel(false)} />
    </li>
  );
}

export default function BookingsPage() {
  const { t } = useI18n();
  const [role, setRole] = useState<Role>('guest');
  const [status, setStatus] = useState<'' | BookingStatus>('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.bookings(role, status, page), queryFn: () => api.bookings.list({ role, status: status || undefined, page, pageSize: 10 }), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title={t('account.nav.bookings')} sub={t('bookings.sub')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={role} onChange={(r) => { setRole(r); setPage(1); }} options={[{ value: 'guest', label: t('bookings.asGuest') }, { value: 'host', label: t('bookings.asHost') }]} />
        <Select aria-label={t('common.status')} wrapperClass="w-48" value={status} onChange={(e) => { setStatus(e.target.value as BookingStatus | ''); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{t(`enums.bookingStatus.${s}`)}</option>)}
        </Select>
      </div>
      {q.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      ) : q.isError ? (
        <ErrorState title={t('bookings.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<CalendarIcon />} title={role === 'guest' ? t('bookings.emptyGuest') : t('bookings.emptyHost')} />
      ) : (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <ul className="flex flex-col gap-3">{q.data.items.map((b) => <BookingCard key={b.id} b={b} role={role} />)}</ul>
          <Pagination className="mt-6" page={page} total={q.data.total} pageSize={10} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
