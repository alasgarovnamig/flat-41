'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BOOKING_STATUSES, DEFAULT_SETTINGS, formatPhone, reviewSchema, type Booking, type BookingStatus, type PaymentMethod } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { bookingStatusTone } from '@/lib/status';
import { cn, locationLabel, todayIso } from '@/lib/utils';
import {
  Button, DataTable, EmptyState, ErrorState, FilterPill, LinkButton, MenuItem, Modal, Money, Notice, OptionList, PageHeader, Pagination, Popover, RowCard,
  Segmented, StatusPill, TableThumb, Textarea, iconButtonClass, type Column,
} from '@/components/ds';
import { ArrowUpRightIcon, CalendarIcon, CardIcon, CloseIcon, FilterIcon, PhoneIcon, StarIcon } from '@/components/ds/icons';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

type Role = 'guest' | 'host';

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
      sub={b.listing.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={m.isPending} onClick={submit}>{t('common.send')}</Button>
        </>
      }
    >
      <div className="mb-4 flex gap-1" role="radiogroup" aria-label={t('bookings.rating')}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={`${i}`} onClick={() => setRating(i)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-sunken">
            <StarIcon size={28} filled={i <= rating} className={i <= rating ? 'text-star' : 'text-subtle'} />
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
      sub={b.listing.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.back')}</Button>
          <Button variant="destructive" loading={m.isPending} onClick={() => m.mutate()}>{t('bookings.cancelConfirm')}</Button>
        </>
      }
    >
      <Notice tone={full ? 'info' : 'warning'} className="mb-4">
        {full ? t('bookings.refundFull') : t('bookings.refundHalf', { hours: DEFAULT_SETTINGS.freeCancellationHours })}
      </Notice>
      <Textarea label={t('bookings.cancelReason')} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

/** Resume an unpaid booking: POST /bookings/:id/pay → bank page (CARD) or result page (WALLET). */
function PayModal({ b, open, onClose }: { b: Booking; open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const pay = useMutation({
    mutationFn: () => api.bookings.pay(b.id, { method, returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (c) => followCheckout(c, locale, router.push),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('bookings.payTitle')}
      sub={b.listing.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={pay.isPending} icon={<CardIcon size={18} />} onClick={() => pay.mutate()}>
            {t('bookings.payNow')}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-end justify-between rounded-lg bg-surface-sunken p-4">
        <span className="text-label text-ink-secondary">{t('booking.total')}</span>
        <Money value={b.total} currency={b.currency} minor className="font-display text-[28px] leading-none tracking-[-0.6px]" />
      </div>
      <PayMethodPicker value={method} onChange={setMethod} amount={b.total} />
      <p className="mt-3 text-caption text-muted">{t('bookings.holdNote')}</p>
    </Modal>
  );
}

function Actions({ b, role }: { b: Booking; role: Role }) {
  const { t, href } = useI18n();
  const [modal, setModal] = useState<'review' | 'cancel' | 'pay' | null>(null);
  const upcoming = b.checkIn >= todayIso();
  const canCancel = (b.status === 'CONFIRMED' && upcoming) || (b.status === 'PENDING_PAYMENT' && role === 'guest');
  const canPay = b.status === 'PENDING_PAYMENT' && role === 'guest';
  const other = role === 'guest' ? b.host : b.guest;
  return (
    <div className="flex items-center justify-end gap-2">
      {canPay && (
        <Button size="sm" icon={<CardIcon size={15} />} onClick={() => setModal('pay')}>
          {t('bookings.payNow')}
        </Button>
      )}
      {role === 'guest' && b.canReview && (
        <Button size="sm" variant="accent" icon={<StarIcon size={15} />} onClick={() => setModal('review')}>
          {t('bookings.writeReview')}
        </Button>
      )}
      <Popover
        align="right"
        width="w-64"
        trigger={({ open, toggle, id }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="menu" aria-label={t('common.actions')} title={t('common.actions')} className={iconButtonClass('raised', 'sm')}>
            <FilterIcon size={17} />
          </button>
        )}
      >
        {(close) => (
          <div role="menu" aria-label={t('common.actions')}>
            <MenuItem href={href(`/listings/${b.listing.id}`)} icon={<ArrowUpRightIcon size={18} />} onClick={close}>
              {t('result.toListing')}
            </MenuItem>
            {other.phone && b.status === 'CONFIRMED' && (
              <MenuItem href={`tel:${other.phone}`} icon={<PhoneIcon size={18} />} onClick={close}>
                {formatPhone(other.phone)}
              </MenuItem>
            )}
            {role === 'host' && (
              <MenuItem href={href(`/account/calendar?listing=${b.listing.id}`)} icon={<CalendarIcon size={18} />} onClick={close}>
                {t('owner.calendar')}
              </MenuItem>
            )}
            {canCancel && (
              <MenuItem danger icon={<CloseIcon size={18} />} onClick={() => { close(); setModal('cancel'); }}>
                {t('bookings.cancel')}
              </MenuItem>
            )}
          </div>
        )}
      </Popover>
      <ReviewModal b={b} open={modal === 'review'} onClose={() => setModal(null)} />
      <CancelModal b={b} role={role} open={modal === 'cancel'} onClose={() => setModal(null)} />
      {canPay && <PayModal b={b} open={modal === 'pay'} onClose={() => setModal(null)} />}
    </div>
  );
}

export default function BookingsPage() {
  const { t, href, date, locale } = useI18n();
  const [role, setRole] = useState<Role>('guest');
  const [status, setStatus] = useState<'' | BookingStatus>('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: qk.bookings(role, status, page), queryFn: () => api.bookings.list({ role, status: status || undefined, page, pageSize: 10 }), placeholderData: keepPreviousData });
  const unpaid = role === 'guest' ? (q.data?.items ?? []).filter((b) => b.status === 'PENDING_PAYMENT').length : 0;

  const columns: Column<Booking>[] = [
    {
      key: 'listing',
      header: t('overview.colListing'),
      cell: (b) => <TableThumb src={b.listing.coverUrl} title={b.listing.title} sub={`${locationLabel({ cityId: b.listing.cityId, districtId: null, metroId: null }, locale)}${b.listing.address ? `, ${b.listing.address}` : ''}`} href={href(`/listings/${b.listing.id}`)} />,
    },
    { key: 'dates', header: t('bookings.dates'), cell: (b) => <span className="whitespace-nowrap">{date(b.checkIn, { day: 'numeric', month: 'short' })} – {date(b.checkOut, { day: 'numeric', month: 'short' })}</span> },
    { key: 'guests', header: t('booking.guests'), cell: (b) => `${b.guests} · ${t('booking.nightsN', { n: b.nights })}`, minWidth: 'xl' },
    { key: 'who', header: role === 'guest' ? t('bookings.host') : t('bookings.guest'), cell: (b) => (role === 'guest' ? b.host : b.guest).name, minWidth: 'lg' },
    { key: 'total', header: role === 'guest' ? t('booking.total') : t('bookings.payout'), cell: (b) => <Money value={role === 'guest' ? b.total : b.hostPayout} currency={b.currency} minor className="font-medium" /> },
    { key: 'status', header: t('common.status'), cell: (b) => <StatusPill tone={bookingStatusTone(b.status)}>{t(`enums.bookingStatus.${b.status}`)}</StatusPill> },
    { key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, align: 'right', cell: (b) => <Actions b={b} role={role} /> },
  ];

  return (
    <div>
      <PageHeader title={t('account.nav.bookings')} sub={t('bookings.sub')} />
      {unpaid > 0 && (
        <Notice tone="warning" className="mb-4">
          {t('bookings.pendingPayment')}
        </Notice>
      )}
      {q.isError ? (
        <ErrorState title={t('bookings.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <DataTable
            caption={t('account.nav.bookings')}
            loading={q.isLoading}
            columns={columns}
            rows={q.data?.items}
            rowKey={(b) => b.id}
            toolbar={
              <>
                <Segmented ariaLabel={t('bookings.role')} value={role} onChange={(r) => { setRole(r); setPage(1); }} options={[{ value: 'guest', label: t('bookings.asGuest') }, { value: 'host', label: t('bookings.asHost') }]} />
                <FilterPill icon={<FilterIcon size={18} />} label={t('common.status')} value={status ? t(`enums.bookingStatus.${status}`) : undefined} active={!!status} width="w-64">
                  {(close) => (
                    <OptionList
                      value={status}
                      onSelect={(v) => {
                        setStatus(v as '' | BookingStatus);
                        setPage(1);
                        close();
                      }}
                      options={[{ value: '', label: t('common.all') }, ...BOOKING_STATUSES.map((s) => ({ value: s, label: t(`enums.bookingStatus.${s}`) }))]}
                    />
                  )}
                </FilterPill>
              </>
            }
            empty={<EmptyState className="shadow-none" icon={<CalendarIcon />} title={role === 'guest' ? t('bookings.emptyGuest') : t('bookings.emptyHost')} action={role === 'guest' ? <LinkButton href={href('/search?dealType=RENT_DAILY')}>{t('home.dailyCta')}</LinkButton> : undefined} />}
            mobileRow={(b) => (
              <RowCard>
                <TableThumb src={b.listing.coverUrl} title={b.listing.title} sub={`${date(b.checkIn, { day: 'numeric', month: 'short' })} – ${date(b.checkOut, { day: 'numeric', month: 'short' })} · ${t('booking.nightsN', { n: b.nights })}`} href={href(`/listings/${b.listing.id}`)} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Money value={role === 'guest' ? b.total : b.hostPayout} currency={b.currency} minor className="font-medium" />
                  <StatusPill tone={bookingStatusTone(b.status)}>{t(`enums.bookingStatus.${b.status}`)}</StatusPill>
                </div>
                <div className="mt-3">
                  <Actions b={b} role={role} />
                </div>
              </RowCard>
            )}
            footer={q.data && <Pagination className="mt-4" page={page} total={q.data.total} pageSize={10} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />}
          />
        </div>
      )}
    </div>
  );
}
