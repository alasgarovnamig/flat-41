'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, calcBooking, nightsBetween, type ListingDetail, type PaymentMethod } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { addDays, cn, todayIso } from '@/lib/utils';
import { Button, DateRangePicker, Modal, Money, Notice, Rating, Spinner } from '@/components/ds';
import { CalendarIcon, MinusIcon, PlusIcon, ShieldCheckIcon } from '@/components/ds/icons';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

export function useBlockedDates(listingId: string) {
  const from = todayIso();
  const to = addDays(from, 365);
  const q = useQuery({ queryKey: qk.availability(listingId, from, to), queryFn: () => api.listings.availability(listingId, { from, to }), retry: false, staleTime: 60_000 });
  const blocked = useMemo(() => {
    const s = new Set(q.data?.blockedDates ?? []);
    for (const r of q.data?.bookedRanges ?? []) {
      for (let d = r.checkIn; d < r.checkOut; d = addDays(d, 1)) s.add(d);
    }
    return s;
  }, [q.data]);
  return { blocked, query: q };
}

/** Booking widget — glass card: price/night, date pills, guests stepper, quote, pay method, black reserve pill. */
export function BookingWidget({ l }: { l: ListingDetail }) {
  const { t, locale, date } = useI18n();
  const router = useRouter();
  const gate = useAuthGate();
  const { blocked, query: avail } = useBlockedDates(l.id);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(1);
  const [picker, setPicker] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const maxGuests = l.maxGuests ?? 10;
  const minNights = l.minNights ?? 1;
  const ready = !!(checkIn && checkOut);

  const quote = useQuery({
    queryKey: ['bookings', 'quote', l.id, checkIn, checkOut, guests],
    queryFn: () => api.bookings.quote({ listingId: l.id, checkIn: checkIn!, checkOut: checkOut!, guests }),
    enabled: ready,
    placeholderData: keepPreviousData,
    retry: false,
  });
  // client-side preview (same formula as the server) when the quote endpoint is unavailable
  const nights = ready ? nightsBetween(checkIn!, checkOut!) : 0;
  const preview = ready ? calcBooking(l.price, nights, DEFAULT_SETTINGS) : null;
  const q = quote.data && quote.data.checkIn === checkIn && quote.data.checkOut === checkOut ? quote.data : null;
  const subtotal = q?.subtotal ?? preview?.subtotal ?? 0;
  const guestFee = q?.guestFee ?? preview?.guestFee ?? 0;
  const total = q?.total ?? preview?.total ?? 0;
  const unavailable = q && !q.available;

  const reserve = useMutation({
    mutationFn: () => api.bookings.create({ listingId: l.id, checkIn: checkIn!, checkOut: checkOut!, guests, method, returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (r) => followCheckout(r.checkout, locale, router.push),
  });

  const fmt = (d: string | null) => (d ? date(d, { day: 'numeric', month: 'short' }) : t('booking.addDate'));

  return (
    <section className="glass rounded-xl p-5 shadow-raised sm:p-6" id="booking" aria-labelledby="booking-h">
      <h2 id="booking-h" className="sr-only">
        {t('booking.reserve')}
      </h2>
      <div className="flex items-end justify-between gap-3">
        <Money value={l.price} currency={l.currency} suffix={`/ ${t('common.perNight')}`} className="font-display text-[34px] font-normal leading-none tracking-[-0.8px]" />
        {l.rating != null && <Rating value={l.rating} count={l.reviewsCount} className="text-label" />}
      </div>

      <button type="button" onClick={() => setPicker(true)} className="press mt-5 grid w-full grid-cols-2 gap-2 text-left" aria-label={t('booking.selectDates')}>
        {[
          [t('booking.checkIn'), checkIn],
          [t('booking.checkOut'), checkOut],
        ].map(([label, v]) => (
          <span key={label} className="rounded-lg bg-surface-raised px-4 py-3 shadow-pill hover:bg-surface-sunken">
            <span className="flex items-center gap-1.5 text-caption text-muted">
              <CalendarIcon size={13} /> {label}
            </span>
            <span className={cn('mt-0.5 block text-[15px] font-medium', !v && 'text-muted')}>{fmt(v)}</span>
          </span>
        ))}
      </button>
      <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-raised px-4 py-2 shadow-pill">
        <span>
          <span className="block text-caption text-muted">{t('booking.guests')}</span>
          <span className="tabular text-[15px] font-medium">{t('booking.guestsN', { n: guests })}</span>
        </span>
        <span className="flex items-center gap-2">
          <button type="button" className="press flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken disabled:opacity-40" onClick={() => setGuests((g) => Math.max(1, g - 1))} disabled={guests <= 1} aria-label={t('booking.fewerGuests')}>
            <MinusIcon size={16} />
          </button>
          <button type="button" className="press flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken disabled:opacity-40" onClick={() => setGuests((g) => Math.min(maxGuests, g + 1))} disabled={guests >= maxGuests} aria-label={t('booking.moreGuests')}>
            <PlusIcon size={16} />
          </button>
        </span>
      </div>
      {(l.checkInTime || l.checkOutTime || minNights > 1) && (
        <p className="mt-3 text-caption text-muted">
          {l.checkInTime && `${t('booking.checkInFrom')} ${l.checkInTime}`}
          {l.checkOutTime && ` · ${t('booking.checkOutUntil')} ${l.checkOutTime}`}
          {minNights > 1 && ` · ${t('booking.minNights', { n: minNights })}`}
        </p>
      )}

      {ready && (
        <dl className="mt-5 space-y-2 text-[14px]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">
              <Money value={l.price} currency={l.currency} /> × {t('booking.nightsN', { n: nights })}
            </dt>
            <dd>
              <Money value={subtotal} currency={l.currency} minor />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-secondary">{t('booking.serviceFee')}</dt>
            <dd>
              <Money value={guestFee} currency={l.currency} minor />
            </dd>
          </div>
          <div className="flex items-end justify-between gap-3 border-t border-hairline pt-3">
            <dt className="font-medium">{t('booking.total')}</dt>
            <dd className="flex items-center gap-2">
              {quote.isFetching && <Spinner size={14} />}
              <Money value={total} currency={l.currency} minor className="font-display text-[24px] leading-none tracking-[-0.5px]" />
            </dd>
          </div>
          {unavailable && <Notice tone="error">{q?.unavailableReason || t('booking.unavailable')}</Notice>}
          {quote.isError && <p className="text-caption text-muted">{t('booking.quotePreview')}</p>}
        </dl>
      )}

      {ready && !unavailable && (
        <div className="mt-4">
          <PayMethodPicker value={method} onChange={setMethod} amount={total} stacked />
        </div>
      )}

      <Button size="lg" className="mt-5 w-full" disabled={!!unavailable || l.isOwner} loading={reserve.isPending} onClick={() => (ready ? gate(() => reserve.mutate()) : setPicker(true))}>
        {ready ? t('booking.reserve') : t('booking.checkAvailability')}
      </Button>
      {reserve.isError && <p className="mt-2 text-label text-danger">{errorMessage(reserve.error, t)}</p>}
      <p className="mt-4 flex items-start gap-2 text-caption text-ink-secondary">
        <ShieldCheckIcon size={16} className="shrink-0" />
        <span>{t('booking.policy', { hours: DEFAULT_SETTINGS.freeCancellationHours })}</span>
      </p>

      <Modal
        open={picker}
        onClose={() => setPicker(false)}
        title={t('booking.selectDates')}
        sub={ready ? t('booking.nightsSelected', { n: nights }) : checkIn ? t('booking.pickCheckOut') : t('booking.pickCheckIn')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setCheckIn(null); setCheckOut(null); }}>
              {t('common.clear')}
            </Button>
            <Button disabled={!ready} onClick={() => setPicker(false)}>
              {t('common.apply')}
            </Button>
          </>
        }
      >
        {avail.isLoading && (
          <p className="mb-3 flex items-center gap-2 text-label text-muted">
            <Spinner size={14} /> {t('booking.loadingAvailability')}
          </p>
        )}
        {avail.isError && <Notice tone="warning" className="mb-3">{t('booking.availabilityError')}</Notice>}
        <DateRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          minNights={minNights}
          isBlocked={(d) => blocked.has(d)}
          onChange={(a, b) => {
            setCheckIn(a);
            setCheckOut(b);
          }}
        />
      </Modal>
    </section>
  );
}
