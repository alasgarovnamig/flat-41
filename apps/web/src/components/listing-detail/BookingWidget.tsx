'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, calcBooking, formatMoney, formatPrice, nightsBetween, type ListingDetail, type PaymentMethod } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { addDays, cn, todayIso } from '@/lib/utils';
import { useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { Button } from '@/components/ui/Button';
import { DateRangePicker } from '@/components/ui/Calendar';
import { Alert, Spinner } from '@/components/ui/feedback';
import { ShieldCheckIcon, StarIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';

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
    <div className="card p-5" id="booking">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-2xl font-bold">{formatPrice(l.price, l.currency)}</span>
          <span className="text-muted"> / {t('common.perNight')}</span>
        </div>
        {l.rating != null && (
          <span className="flex items-center gap-1 text-sm font-semibold">
            <StarIcon size={14} className="text-vip" /> {l.rating.toFixed(1)} <span className="font-normal text-muted">({l.reviewsCount})</span>
          </span>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-line">
        <button type="button" onClick={() => setPicker(true)} className="grid w-full grid-cols-2 text-left hover:bg-surface">
          <span className="border-r border-line p-3">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{t('booking.checkIn')}</span>
            <span className={cn('text-sm', !checkIn && 'text-muted')}>{fmt(checkIn)}</span>
          </span>
          <span className="p-3">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{t('booking.checkOut')}</span>
            <span className={cn('text-sm', !checkOut && 'text-muted')}>{fmt(checkOut)}</span>
          </span>
        </button>
        <label className="flex items-center justify-between border-t border-line p-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{t('booking.guests')}</span>
          <select value={guests} onChange={(e) => setGuests(Number(e.target.value))} className="bg-transparent text-sm font-medium outline-none" aria-label={t('booking.guests')}>
            {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {t('booking.guestsN', { n })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(l.checkInTime || l.checkOutTime || minNights > 1) && (
        <p className="mt-2 text-xs text-muted">
          {l.checkInTime && `${t('booking.checkInFrom')} ${l.checkInTime}`}
          {l.checkOutTime && ` · ${t('booking.checkOutUntil')} ${l.checkOutTime}`}
          {minNights > 1 && ` · ${t('booking.minNights', { n: minNights })}`}
        </p>
      )}

      {ready && (
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">
              {formatPrice(l.price, l.currency)} × {t('booking.nightsN', { n: nights })}
            </span>
            <span>{formatMoney(subtotal, l.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{t('booking.serviceFee')}</span>
            <span>{formatMoney(guestFee, l.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
            <span>{t('booking.total')}</span>
            <span className="flex items-center gap-2">
              {quote.isFetching && <Spinner size={14} className="text-brand" />}
              {formatMoney(total, l.currency)}
            </span>
          </div>
          {unavailable && <Alert tone="error">{q?.unavailableReason || t('booking.unavailable')}</Alert>}
          {quote.isError && <p className="text-xs text-muted">{t('booking.quotePreview')}</p>}
        </div>
      )}

      {ready && !unavailable && (
        <div className="mt-4">
          <PayMethodPicker value={method} onChange={setMethod} amount={total} stacked />
        </div>
      )}

      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={!!unavailable || l.isOwner}
        loading={reserve.isPending}
        onClick={() => (ready ? gate(() => reserve.mutate()) : setPicker(true))}
      >
        {ready ? t('booking.reserve') : t('booking.checkAvailability')}
      </Button>
      {reserve.isError && <p className="mt-2 text-sm text-urgent">{errorMessage(reserve.error, t)}</p>}
      <div className="mt-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheckIcon size={16} className="shrink-0 text-brand" />
        <span>{t('booking.policy', { hours: DEFAULT_SETTINGS.freeCancellationHours })}</span>
      </div>

      <Modal
        open={picker}
        onClose={() => setPicker(false)}
        title={t('booking.selectDates')}
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
        {avail.isLoading && <p className="mb-2 flex items-center gap-2 text-sm text-muted"><Spinner size={14} /> {t('booking.loadingAvailability')}</p>}
        {avail.isError && <Alert tone="warning" className="mb-3">{t('booking.availabilityError')}</Alert>}
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
        <p className="mt-3 text-sm text-muted">
          {ready ? t('booking.nightsSelected', { n: nights }) : checkIn ? t('booking.pickCheckOut') : t('booking.pickCheckIn')}
        </p>
      </Modal>
    </div>
  );
}
