import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppNotification, NotificationType } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Button, Divider, EmptyState, ErrorState, Skeleton, Text } from '@/components/ui';
import { hrefForNotificationData } from '@/push/notifications';

const ICON: Partial<Record<NotificationType, keyof typeof Ionicons.glyphMap>> = {
  LISTING_APPROVED: 'checkmark-circle-outline', LISTING_REJECTED: 'close-circle-outline', LISTING_EXPIRING: 'time-outline', LISTING_EXPIRED: 'time-outline',
  NEW_MESSAGE: 'chatbubble-outline', PAYMENT_SUCCEEDED: 'card-outline', PAYMENT_FAILED: 'alert-circle-outline', BOOKING_NEW: 'calendar-outline',
  BOOKING_CONFIRMED: 'calendar-outline', BOOKING_CANCELLED: 'calendar-clear-outline', PAYOUT: 'cash-outline', SAVED_SEARCH_MATCH: 'search-outline',
  PROMOTION_EXPIRED: 'rocket-outline', SUBSCRIPTION_RENEWED: 'briefcase-outline', SUBSCRIPTION_EXPIRED: 'briefcase-outline', SYSTEM: 'megaphone-outline',
};

export default function NotificationsScreen() {
  return (
    <RequireAuth>
      <Notifications />
    </RequireAuth>
  );
}

function Notifications() {
  const { c } = useTheme();
  const { t, fmtRelative } = useI18n();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: qk.notifications,
    queryFn: ({ pageParam }) => api.notifications({ page: pageParam, pageSize: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.notifications });
    qc.invalidateQueries({ queryKey: qk.me });
  };
  const readAll = useMutation({ mutationFn: api.readAllNotifications, onSuccess: refresh });

  const open = (n: AppNotification) => {
    if (!n.readAt) api.readNotification(n.id).then(refresh).catch(() => {});
    const href = hrefForNotificationData(n.data);
    if (href) router.push(href);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            items.some((n) => !n.readAt) ? <Button title={t('notifications.readAll')} kind="ghost" small full={false} onPress={() => readAll.mutate()} loading={readAll.isPending} /> : null,
        }}
      />
      <FlatList
        style={{ backgroundColor: c.bg }}
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ flexGrow: 1 }}
        ItemSeparatorComponent={Divider}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={c.primary} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        renderItem={({ item: n }) => (
          <Pressable onPress={() => open(n)} accessibilityRole="button" style={({ pressed }) => [styles.row, { backgroundColor: n.readAt ? c.bg : c.primarySoft }, pressed && { opacity: 0.8 }]}>
            <View style={[styles.icon, { backgroundColor: c.card }]}>
              <Ionicons name={ICON[n.type] ?? 'notifications-outline'} size={20} color={c.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: n.readAt ? '500' : '700' }}>{n.title}</Text>
              <Text variant="small" muted>
                {n.body}
              </Text>
              <Text variant="caption" muted>
                {fmtRelative(n.createdAt)}
              </Text>
            </View>
            {!n.readAt && <View style={[styles.dot, { backgroundColor: c.primary }]} />}
          </Pressable>
        )}
        ListEmptyComponent={
          q.isLoading ? (
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <Skeleton height={56} />
              <Skeleton height={56} />
            </View>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <EmptyState icon="notifications-off-outline" title={t('notifications.empty')} />
          )
        }
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
});
