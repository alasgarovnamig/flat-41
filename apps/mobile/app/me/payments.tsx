import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatMoney, type PaymentStatus } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Divider, EmptyState, ErrorState, Skeleton, StatusPill, Text } from '@/components/ui';

const TONE: Record<PaymentStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  CREATED: 'neutral', PENDING: 'warning', SUCCEEDED: 'success', FAILED: 'danger', CANCELLED: 'neutral', REFUNDED: 'info', PARTIALLY_REFUNDED: 'info',
};

export default function PaymentsScreen() {
  return (
    <RequireAuth>
      <Payments />
    </RequireAuth>
  );
}

function Payments() {
  const { c } = useTheme();
  const { t, te, fmtDateTime } = useI18n();
  const q = useInfiniteQuery({
    queryKey: qk.payments,
    queryFn: ({ pageParam }) => api.payments({ page: pageParam, pageSize: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      ItemSeparatorComponent={Divider}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={c.primary} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      renderItem={({ item: p }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/payment/result', params: { paymentId: p.id, status: p.status } })}
          accessibilityRole="button"
          style={styles.row}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontWeight: '600' }}>{te('paymentPurpose', p.purpose)}</Text>
            <Text variant="small" muted numberOfLines={1}>
              {p.description}
            </Text>
            <Text variant="caption" muted>
              {fmtDateTime(p.createdAt)} · {te('paymentMethod', p.method)}
              {p.cardMask ? ` ${p.cardMask}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={{ fontWeight: '700' }}>{formatMoney(p.amount, p.currency)}</Text>
            <StatusPill label={te('paymentStatus', p.status)} tone={TONE[p.status]} />
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        q.isLoading ? (
          <Skeleton height={60} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <EmptyState icon="receipt-outline" title={t('payments.empty')} />
        )
      }
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
    />
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'center', minHeight: 64 } });
