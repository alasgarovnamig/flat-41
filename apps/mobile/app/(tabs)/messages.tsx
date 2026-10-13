import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatPrice, type Conversation } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Avatar, Badge, EmptyState, ErrorState, Skeleton, Text } from '@/components/ui';

export default function Messages() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { isAuthed, requireAuth } = useAuth();
  const q = useInfiniteQuery({
    queryKey: qk.conversations,
    queryFn: ({ pageParam }) => api.conversations({ page: pageParam, pageSize: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: isAuthed,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <Text variant="h1" style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }} accessibilityRole="header">
        {t('messages.title')}
      </Text>
      {!isAuthed ? (
        <EmptyState icon="chatbubbles-outline" title={t('messages.empty')} text={t('profile.guestText')} action={t('common.login')} onAction={() => requireAuth()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => <ConversationRow conv={item} />}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 84 }} />}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={c.primary} />}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            q.isLoading ? (
              <View style={{ padding: spacing.lg, gap: spacing.lg }}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: spacing.md }}>
                    <Skeleton width={56} height={56} round />
                    <View style={{ flex: 1, gap: 8 }}>
                      <Skeleton height={14} width="50%" />
                      <Skeleton height={12} width="80%" />
                    </View>
                  </View>
                ))}
              </View>
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : (
              <EmptyState icon="chatbubbles-outline" title={t('messages.empty')} text={t('messages.emptyHint')} />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const { c } = useTheme();
  const { t, fmtRelative } = useI18n();
  const { me } = useAuth();
  const mine = conv.lastMessage?.senderId === me?.id;
  const unread = conv.unreadCount > 0;
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/chat/[id]', params: { id: conv.id, name: conv.otherUser.name, listingTitle: conv.listing.title, listingId: conv.listing.id } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${conv.otherUser.name}, ${conv.listing.title}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
    >
      <View>
        {conv.listing.coverUrl ? (
          <Image source={{ uri: absUrl(conv.listing.coverUrl) }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, { backgroundColor: c.surface }]} />
        )}
        <View style={styles.avatar}>
          <Avatar uri={conv.otherUser.avatarUrl} name={conv.otherUser.name} size={26} />
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ flex: 1, fontWeight: unread ? '700' : '600' }} numberOfLines={1}>
            {conv.otherUser.name}
          </Text>
          <Text variant="caption" muted>
            {fmtRelative(conv.lastMessage?.createdAt ?? conv.updatedAt)}
          </Text>
        </View>
        <Text variant="small" muted numberOfLines={1}>
          {conv.listing.title} · {formatPrice(conv.listing.price, conv.listing.currency)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="small" numberOfLines={1} style={{ flex: 1, fontWeight: unread ? '600' : '400' }} muted={!unread}>
            {mine ? t('messages.you') : ''}
            {conv.lastMessage?.body ?? ''}
          </Text>
          {unread && <Badge label={String(conv.unreadCount)} color={c.primary} />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  avatar: { position: 'absolute', right: -6, bottom: -6, borderRadius: 15, borderWidth: 2, borderColor: '#fff' },
});
