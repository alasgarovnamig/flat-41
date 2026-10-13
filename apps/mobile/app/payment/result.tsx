import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type Payment, type PaymentStatus } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Button, Card, Text } from '@/components/ui';

const FINAL: PaymentStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
const POLL_MS = 2000;
const MAX_WAIT_MS = 90_000;

/**
 * Route for `evtap://payment/result?paymentId=..&status=..` (bank → API → app).
 * The `status` query param is only a hint: GET /payments/:id is polled until the status is final.
 */
export default function PaymentResult() {
  const params = useLocalSearchParams<{ paymentId: string; status?: string; listingId?: string; bookingId?: string }>();
  const { c } = useTheme();
  const { t, te } = useI18n();
  const qc = useQueryClient();
  const started = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const q = useQuery({
    queryKey: qk.payment(params.paymentId),
    queryFn: () => api.payment(params.paymentId),
    enabled: !!params.paymentId,
    refetchInterval: (query) => {
      const p = query.state.data as Payment | undefined;
      if (p && FINAL.includes(p.status)) return false;
      if (Date.now() - started.current > MAX_WAIT_MS) return false;
      return POLL_MS;
    },
  });
  const p = q.data;
  const final = !!p && FINAL.includes(p.status);

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => clearTimeout(id);
  }, []);

  // Refresh everything money-related once the payment is final.
  useEffect(() => {
    if (!final) return;
    for (const key of [qk.me, qk.wallet, qk.walletTx, qk.payments, qk.subscription, ['myListings'], ['bookings'], ['listing']]) qc.invalidateQueries({ queryKey: key });
  }, [final, qc]);

  const status: PaymentStatus | 'PROCESSING' = final ? p!.status : 'PROCESSING';
  const view = {
    PROCESSING: { icon: 'time-outline' as const, color: c.primary, title: timedOut ? t('payment.pendingLong') : t('payment.processing') },
    SUCCEEDED: { icon: 'checkmark-circle' as const, color: c.success, title: t('payment.success') },
    FAILED: { icon: 'close-circle' as const, color: c.danger, title: t('payment.failed') },
    CANCELLED: { icon: 'remove-circle' as const, color: c.muted, title: t('payment.cancelled') },
    REFUNDED: { icon: 'return-up-back' as const, color: c.warning, title: t('payment.refunded') },
    PARTIALLY_REFUNDED: { icon: 'return-up-back' as const, color: c.warning, title: t('payment.refunded') },
    CREATED: { icon: 'time-outline' as const, color: c.primary, title: t('payment.processing') },
    PENDING: { icon: 'time-outline' as const, color: c.primary, title: t('payment.processing') },
  }[status];

  const listingId = p?.listingId ?? params.listingId;
  const bookingId = p?.bookingId ?? params.bookingId;
  const next: { label: string; href: Href } | null = !p
    ? null
    : p.purpose === 'BOOKING' && bookingId
      ? { label: t('payment.toBooking'), href: { pathname: '/booking/[id]', params: { id: bookingId } } }
      : p.purpose === 'WALLET_TOPUP'
        ? { label: t('payment.toWallet'), href: '/me/wallet' }
        : p.purpose === 'SUBSCRIPTION'
          ? { label: t('payment.toBusiness'), href: '/me/business' }
          : p.purpose === 'LISTING_FEE'
            ? { label: t('payment.toMyListings'), href: '/me/listings' }
            : listingId
              ? { label: t('payment.toListing'), href: { pathname: '/listing/[id]', params: { id: listingId } } }
              : null;

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center', backgroundColor: c.bg }}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        {status === 'PROCESSING' && !timedOut ? (
          <ActivityIndicator size="large" color={c.primary} style={{ height: 80 }} />
        ) : (
          <Ionicons name={view.icon} size={80} color={view.color} />
        )}
        <Text variant="h2" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
          {view.title}
        </Text>
        {p?.failureReason && status === 'FAILED' && (
          <Text muted style={{ textAlign: 'center' }}>
            {p.failureReason}
          </Text>
        )}
      </View>

      {p && (
        <Card style={{ gap: spacing.sm }}>
          <Row k={t('payment.amount')} v={formatMoney(p.amount, p.currency)} />
          <Row k={te('paymentPurpose', p.purpose)} v={te('paymentMethod', p.method) + (p.cardMask ? ` · ${p.cardMask}` : '')} />
          {!!p.description && <Text variant="small" muted>{p.description}</Text>}
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {next && final && <Button title={next.label} onPress={() => router.replace(next.href)} />}
        {(status === 'FAILED' || status === 'CANCELLED') && <Button title={t('payment.tryAgain')} kind="outline" onPress={() => router.back()} />}
        <Button title={t('payment.backHome')} kind="ghost" onPress={() => router.dismissTo('/')} />
      </View>
    </ScrollView>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <View style={styles.row}>
    <Text muted>{k}</Text>
    <Text style={{ fontWeight: '600' }}>{v}</Text>
  </View>
);

const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md } });
