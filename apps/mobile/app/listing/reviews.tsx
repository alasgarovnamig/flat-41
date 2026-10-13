import { useMemo } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Divider, EmptyState, ErrorState, Loading } from '@/components/ui';
import { ReviewItem } from '@/components/ReviewItem';

export default function Reviews() {
  const { id, isOwner } = useLocalSearchParams<{ id: string; isOwner?: string }>();
  const { c } = useTheme();
  const { t } = useI18n();
  const q = useInfiniteQuery({
    queryKey: ['reviews', id, 'all'],
    queryFn: ({ pageParam }) => api.reviews(id, { page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={items}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
      ItemSeparatorComponent={Divider}
      renderItem={({ item }) => <ReviewItem review={item} canReply={!!isOwner} />}
      onEndReached={() => q.hasNextPage && q.fetchNextPage()}
      ListEmptyComponent={<EmptyState icon="star-outline" title={t('listing.noReviews')} />}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : <View />}
    />
  );
}
