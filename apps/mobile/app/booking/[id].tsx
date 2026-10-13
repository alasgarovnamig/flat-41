import { useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, formatPhone, reviewSchema } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { useAuth } from '@/auth/AuthContext';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Avatar, Button, Card, Divider, ErrorState, Field, Loading, StatusPill, Text } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useCatalog, useRefresh } from '@/hooks/common';
import { BOOKING_TONE } from '@/lib/status';

export default function BookingDetailScreen() {
  return (
    <RequireAuth>
      <BookingDetail />
    </RequireAuth>
  );
}

function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { t, te, fmtDate } = useI18n();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { catalog } = useCatalog();
  const q = useQuery({ queryKey: qk.booking(id), queryFn: () => api.booking(id) });
  const { refreshing, onRefresh } = useRefresh(q.refetch);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const after = () => {
    qc.invalidateQueries({ queryKey: qk.booking(id) });
    qc.invalidateQueries({ queryKey: ['bookings'] });
    qc.invalidateQueries({ queryKey: qk.me });
  };
  const cancel = useMutation({
    mutationFn: () => api.cancelBooking(id, reason.trim() || undefined),
    onSuccess: () => {
      setCancelOpen(false);
      toast.success(t('bookings.cancelled'));
      after();
    },
    onError: toast.error,
  });
  const review = useMutation({
    mutationFn: () => api.reviewBooking(id, reviewSchema.parse({ rating, comment })),
    onSuccess: () => {
      setReviewOpen(false);
      toast.success(t('bookings.reviewSent'));
      after();
    },
    onError: toast.error,
  });

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const isHost = b.host.id === me?.id;
  const other = isHost ? b.guest : b.host;
  const canCancel = b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT';

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}>
      <Pressable onPress={() => router.push({ pathname: '/listing/[id]', params: { id: b.listing.id } })} accessibilityRole="link" style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        {b.listing.coverUrl && <Image source={{ uri: absUrl(b.listing.coverUrl) }} style={{ width: 72, height: 72, borderRadius: radius.sm }} />}
        <View style={{ flex: 1, gap: 4 }}>
          <StatusPill label={te('bookingStatus', b.status)} tone={BOOKING_TONE[b.status]} />
          <Text variant="h3" numberOfLines={2}>
            {b.listing.title}
          </Text>
          {b.listing.address && (
            <Text variant="small" muted>
              {b.listing.address}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.muted} />
      </Pressable>

      <Card style={{ gap: spacing.sm }}>
        <Row k={t('bookings.dates')} v={`${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`} />
        <Row k={t('booking.guests')} v={String(b.guests)} />
        <Divider />
        <Row k={t('booking.nightsTimes', { price: formatMoney(b.nightlyPrice * 100, b.currency), n: b.nights })} v={formatMoney(b.subtotal, b.currency)} />
        {isHost ? (
          <>
            <Row k={t('bookings.hostFee')} v={`− ${formatMoney(b.hostFee, b.currency)}`} />
            <Row k={t('bookings.hostPayout')} v={formatMoney(b.hostPayout, b.currency)} bold />
            <Row k={t('bookings.payout')} v={te('payoutStatus', b.payoutStatus)} />
          </>
        ) : (
          <>
            <Row k={t('booking.serviceFee')} v={formatMoney(b.guestFee, b.currency)} />
            <Row k={t('booking.total')} v={formatMoney(b.total, b.currency)} bold />
          </>
        )}
        {b.refundedAmount > 0 && <Row k={t('bookings.refunded')} v={formatMoney(b.refundedAmount, b.currency)} />}
        {b.cancelledBy && (
          <Text variant="small" color={c.danger}>
            {t('bookings.cancelledBy', { who: te('cancelledBy', b.cancelledBy) })}
            {b.cancelReason ? ` — ${b.cancelReason}` : ''}
          </Text>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="label" muted>
          {isHost ? t('bookings.guest') : t('bookings.host')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar uri={other.avatarUrl} name={other.name} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }}>{other.name}</Text>
            {other.phone && (
              <Text variant="small" muted>
                {formatPhone(other.phone)}
              </Text>
            )}
          </View>
          {other.phone && (
            <Pressable onPress={() => Linking.openURL(`tel:${other.phone}`)} accessibilityRole="button" accessibilityLabel={t('listing.call')} style={[styles.round, { backgroundColor: c.primarySoft }]}>
              <Ionicons name="call" size={20} color={c.primary} />
            </Pressable>
          )}
        </View>
      </Card>

      {b.canReview && !isHost && <Button title={t('bookings.writeReview')} kind="vip" icon="star-outline" onPress={() => setReviewOpen(true)} />}
      {canCancel && (
        <View style={{ gap: spacing.sm }}>
          {!isHost && (
            <Text variant="small" muted>
              {t('booking.policyText', { h: catalog.settings.freeCancellationHours })}
            </Text>
          )}
          <Button title={t('bookings.cancel')} kind="outline" icon="close-circle-outline" onPress={() => setCancelOpen(true)} />
        </View>
      )}

      <Sheet visible={cancelOpen} onClose={() => setCancelOpen(false)} title={t('bookings.cancel')}>
        <Text>{t('bookings.cancelConfirm')}</Text>
        <Field label={t('bookings.cancelReason')} value={reason} onChangeText={setReason} multiline maxLength={500} />
        <Button
          title={t('bookings.cancel')}
          kind="danger"
          loading={cancel.isPending}
          onPress={() =>
            Alert.alert(t('common.confirm'), t('bookings.cancelConfirm'), [
              { text: t('common.no'), style: 'cancel' },
              { text: t('common.yes'), style: 'destructive', onPress: () => cancel.mutate() },
            ])
          }
        />
      </Sheet>

      <Sheet visible={reviewOpen} onClose={() => setReviewOpen(false)} title={t('bookings.writeReview')}>
        <Text variant="label">{t('bookings.rating')}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="adjustable" accessibilityValue={{ min: 1, max: 5, now: rating }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Pressable key={i} onPress={() => setRating(i)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${i}`}>
              <Ionicons name={rating >= i ? 'star' : 'star-outline'} size={36} color={brand.vip} />
            </Pressable>
          ))}
        </View>
        <Field label={t('bookings.comment')} value={comment} onChangeText={setComment} multiline maxLength={2000} />
        <Button title={t('common.send')} disabled={comment.trim().length < 5} loading={review.isPending} onPress={() => review.mutate()} />
      </Sheet>
    </ScrollView>
  );
}

const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
    <Text muted={!bold} style={bold ? { fontWeight: '700' } : undefined}>
      {k}
    </Text>
    <Text style={{ fontWeight: bold ? '700' : '500', flexShrink: 1, textAlign: 'right' }}>{v}</Text>
  </View>
);

const styles = StyleSheet.create({ round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } });
