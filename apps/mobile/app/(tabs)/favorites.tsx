import { useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { EmptyState, ErrorState, Text } from '@/components/ui';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { useFavorites } from '@/hooks/useFavorites';

export default function Favorites() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { isAuthed, requireAuth } = useAuth();
  const fav = useFavorites();

  const q = useInfiniteQuery({
    queryKey: qk.favorites,
    queryFn: ({ pageParam }) => api.favorites({ page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: isAuthed,
  });
  // Hide cards un-favorited in this session immediately (optimistic).
  const items = useMemo(() => (q.data?.pages.flatMap((p) => p.items) ?? []).filter((l) => !fav.loaded || fav.ids.has(l.id)), [q.data, fav.ids, fav.loaded]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <Text variant="h1" style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }} accessibilityRole="header">
        {t('favorites.title')}
      </Text>
      {!isAuthed ? (
        <EmptyState icon="heart-outline" title={t('favorites.empty')} text={t('profile.guestText')} action={t('common.login')} onAction={() => requireAuth()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => <ListingCard item={item} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={c.primary} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            q.isLoading ? (
              <View style={{ gap: spacing.md }}>
                <ListingCardSkeleton />
                <ListingCardSkeleton />
              </View>
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : (
              <EmptyState icon="heart-outline" title={t('favorites.empty')} text={t('favorites.emptyHint')} action={t('common.search')} onAction={() => router.push('/search')} />
            )
          }
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
        />
      )}
    </SafeAreaView>
  );
}
