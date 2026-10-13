import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatMoney, type Booking } from '@evtap/shared';
import { BOOKING_TONE } from '@/lib/status';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Card, EmptyState, ErrorState, Segmented, Skeleton, StatusPill, Text } from '@/components/ui';

export default function BookingsScreen() {
  return (
    <RequireAuth>
      <Bookings />
    </RequireAuth>
  );
}

function Bookings() {
  const { c } = useTheme();
  const { t } = useI18n();
  const [role, setRole] = useState<'guest' | 'host'>('guest');
  const q = useInfiniteQuery({
    queryKey: qk.bookings(role),
    queryFn: ({ pageParam }) => api.bookings({ role, page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Segmented
        style={{ margin: spacing.lg, marginBottom: 0 }}
        options={[
          { value: 'guest', label: t('bookings.asGuest') },
          { value: 'host', label: t('bookings.asHost') },
        ]}
        value={role}
        onChange={setRole}
      />
      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        renderItem={({ item }) => <BookingCard b={item} role={role} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={c.primary} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListEmptyComponent={
          q.isLoading ? (
            <Skeleton height={100} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <EmptyState icon="calendar-outline" title={t('bookings.empty')} />
          )
        }
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
      />
    </View>
  );
}

function BookingCard({ b, role }: { b: Booking; role: 'guest' | 'host' }) {
  const { c } = useTheme();
  const { t, te, fmtDate } = useI18n();
  return (
    <Card onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })} style={{ flexDirection: 'row', gap: spacing.md }}>
      {b.listing.coverUrl ? (
        <Image source={{ uri: absUrl(b.listing.coverUrl) }} style={{ width: 80, height: 80, borderRadius: radius.sm }} contentFit="cover" />
      ) : (
        <View style={{ width: 80, height: 80, borderRadius: radius.sm, backgroundColor: c.surface }} />
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <StatusPill label={te('bookingStatus', b.status)} tone={BOOKING_TONE[b.status]} />
        <Text style={{ fontWeight: '600' }} numberOfLines={1}>
          {b.listing.title}
        </Text>
        <Text variant="small" muted>
          {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)} · {t('common.nights', { n: b.nights })}
        </Text>
        <Text variant="small">
          {role === 'host' ? `${b.guest.name} · ${formatMoney(b.hostPayout, b.currency)}` : formatMoney(b.total, b.currency)}
        </Text>
      </View>
    </Card>
  );
}
