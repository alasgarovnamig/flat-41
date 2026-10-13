import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery } from '@tanstack/react-query';
import { calcBooking, formatMoney, formatPrice, nightsBetween, type PaymentMethod } from '@evtap/shared';
import { api } from '@/api/client';
import { qk, queryClient } from '@/api/queryClient';
import { absUrl } from '@/config';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Button, Card, Divider, ErrorState, Loading, Stepper, Text } from '@/components/ui';
import { Calendar, type DayState } from '@/components/Calendar';
import { PaymentMethodPicker } from '@/components/PaymentMethod';
import { useToast } from '@/components/Toast';
import { addDays, isoDay, useCatalog } from '@/hooks/common';
import { completeCheckout, paymentReturnUrl } from '@/payments/pay';

const MONTHS = 6;

export default function Book() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { catalog } = useCatalog();
  const today = isoDay(new Date());
  const until = addDays(today, MONTHS * 31);

  const listing = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listing(id) });
  const avail = useQuery({ queryKey: qk.availability(id), queryFn: () => api.availability(id, today, until) });

  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guests, setGuests] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>('CARD');

  /** Nights that cannot be booked: host-blocked dates + existing bookings (checkIn ≤ night < checkOut). */
  const unavailable = useMemo(() => {
    const s = new Set<string>(avail.data?.blockedDates ?? []);
    for (const r of avail.data?.bookedRanges ?? []) for (let d = r.checkIn; d < r.checkOut; d = addDays(d, 1)) s.add(d);
    return s;
  }, [avail.data]);

  const firstBlockedAfter = useMemo(() => {
    if (!checkIn) return null;
    return [...unavailable].filter((d) => d > checkIn).sort()[0] ?? null;
  }, [checkIn, unavailable]);

  const minNights = listing.data?.minNights ?? 1;
  const dayState = (iso: string): DayState => {
    if (iso < today) return 'past';
    if (checkIn && iso === checkIn) return checkOut ? 'start' : 'single';
    if (checkOut && iso === checkOut) return 'end';
    if (checkIn && checkOut && iso > checkIn && iso < checkOut) return 'inRange';
    if (checkIn && !checkOut && iso > checkIn) {
      if (firstBlockedAfter && iso > firstBlockedAfter) return 'disabled';
      if (nightsBetween(checkIn, iso) < minNights) return 'disabled';
      return 'normal';
    }
    return unavailable.has(iso) ? 'booked' : 'normal';
  };
  const onDay = (iso: string) => {
    if (checkIn && !checkOut && iso > checkIn) {
      if (dayState(iso) === 'normal') setCheckOut(iso);
      return;
    }
    if (unavailable.has(iso)) return;
    setCheckIn(iso);
    setCheckOut(null);
  };

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const quoteInput = checkIn && checkOut ? { listingId: id, checkIn, checkOut, guests } : null;
  const quote = useQuery({ queryKey: qk.quote(quoteInput ?? {}), queryFn: () => api.quote(quoteInput!), enabled: !!quoteInput });
  const preview = listing.data && nights ? calcBooking(listing.data.price, nights, catalog.settings) : null;
  const total = quote.data?.total ?? preview?.total ?? 0;

  const book = useMutation({
    mutationFn: () => api.createBooking({ listingId: id, checkIn: checkIn!, checkOut: checkOut!, guests, method, returnUrl: paymentReturnUrl() }),
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: qk.availability(id) });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await completeCheckout(res.checkout, { bookingId: res.booking.id, listingId: id });
    },
    onError: toast.error,
  });

  if (listing.isLoading || avail.isLoading) return <Loading />;
  if (listing.isError || !listing.data) return <ErrorState error={listing.error} onRetry={() => listing.refetch()} />;
  const l = listing.data;
  const currency = quote.data?.currency ?? l.currency;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 + insets.bottom }}>
        <Card style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          {l.coverUrl && <Image source={{ uri: absUrl(l.coverUrl) }} style={{ width: 64, height: 64, borderRadius: radius.sm }} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }} numberOfLines={2}>
              {l.title}
            </Text>
            <Text muted variant="small">
              {formatPrice(l.price, l.currency)} {t('common.perNight')}
            </Text>
          </View>
        </Card>

        <View style={styles.dates}>
          <DateBox label={t('booking.checkIn')} value={checkIn} />
          <DateBox label={t('booking.checkOut')} value={checkOut} />
        </View>
        <Text muted variant="small">
          {!checkIn ? t('booking.selectDates') : !checkOut ? t('booking.selectCheckOut') : t('common.nights', { n: nights })}
          {minNights > 1 ? ` · ${t('booking.minNights', { n: minNights })}` : ''}
        </Text>

        <Calendar months={MONTHS} dayState={dayState} onDayPress={onDay} />

        <Stepper label={t('booking.guests')} value={guests} min={1} max={l.maxGuests ?? 16} onChange={setGuests} />
        {l.maxGuests ? (
          <Text variant="small" muted>
            {t('booking.maxGuests', { n: l.maxGuests })}
          </Text>
        ) : null}

        {nights > 0 && (
          <Card style={{ gap: spacing.sm }}>
            <Text variant="h3">{t('booking.priceDetails')}</Text>
            <Row
              k={t('booking.nightsTimes', { price: formatPrice(quote.data?.nightlyPrice ?? l.price, currency), n: nights })}
              v={formatMoney(quote.data?.subtotal ?? preview?.subtotal ?? 0, currency)}
            />
            <Row k={t('booking.serviceFee')} v={formatMoney(quote.data?.guestFee ?? preview?.guestFee ?? 0, currency)} />
            <Divider />
            <Row k={t('booking.total')} v={formatMoney(total, currency)} bold />
            {quote.data && !quote.data.available && (
              <Text color={c.danger}>{quote.data.unavailableReason ?? t('booking.unavailable')}</Text>
            )}
          </Card>
        )}

        {nights > 0 && <PaymentMethodPicker value={method} onChange={setMethod} amount={total} />}

        <View style={{ gap: 4 }}>
          <Text variant="label">{t('booking.policyTitle')}</Text>
          <Text variant="small" muted>
            {t('booking.policyText', { h: catalog.settings.freeCancellationHours })}
          </Text>
          <Text variant="small" muted>
            {t('booking.held')}
          </Text>
        </View>
      </ScrollView>
      <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{nights ? formatMoney(total, currency) : '—'}</Text>
          {nights > 0 && (
            <Text variant="caption" muted>
              {t('common.nights', { n: nights })} · {t('common.guests', { n: guests })}
            </Text>
          )}
        </View>
        <Button
          title={t('booking.bookAndPay')}
          full={false}
          disabled={!nights || quote.isLoading || quote.data?.available === false}
          loading={book.isPending}
          onPress={() => book.mutate()}
        />
      </View>
    </View>
  );
}

function DateBox({ label, value }: { label: string; value: string | null }) {
  const { c } = useTheme();
  const { fmtDate } = useI18n();
  return (
    <View style={[styles.dateBox, { borderColor: value ? c.primary : c.border, backgroundColor: c.inputBg }]}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text style={{ fontWeight: '600' }}>{value ? fmtDate(value) : '—'}</Text>
    </View>
  );
}

const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
    <Text style={bold ? { fontWeight: '700' } : undefined} muted={!bold}>
      {k}
    </Text>
    <Text style={{ fontWeight: bold ? '700' : '500' }}>{v}</Text>
  </View>
);

const styles = StyleSheet.create({
  dates: { flexDirection: 'row', gap: spacing.sm },
  dateBox: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
