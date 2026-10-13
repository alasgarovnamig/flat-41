import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListingStatus, MyListing } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { useAuth } from '@/auth/AuthContext';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n, type TKey } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, IconButton, Skeleton, StatusPill, Text } from '@/components/ui';
import { ActionSheet } from '@/components/Sheet';
import { usePriceLabel } from '@/components/ListingCard';
import { useToast } from '@/components/Toast';

const TABS: ListingStatus[] = ['ACTIVE', 'PENDING', 'DRAFT', 'REJECTED', 'EXPIRED', 'ARCHIVED'];
const TONE: Partial<Record<ListingStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'>> = {
  ACTIVE: 'success', PENDING: 'warning', DRAFT: 'warning', REJECTED: 'danger', BLOCKED: 'danger', EXPIRED: 'neutral', ARCHIVED: 'neutral', SOLD: 'info',
};

export default function MyListingsScreen() {
  return (
    <RequireAuth>
      <MyListings />
    </RequireAuth>
  );
}

function MyListings() {
  const { c } = useTheme();
  const { t } = useI18n();
  const [status, setStatus] = useState<ListingStatus>('ACTIVE');
  const q = useInfiniteQuery({
    queryKey: qk.myListings(status),
    queryFn: ({ pageParam }) => api.myListings({ status, page: pageParam, pageSize: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerRight: () => <IconButton name="add-circle-outline" label={t('myListings.newListing')} color={c.primary} onPress={() => router.push('/post')} /> }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        {TABS.map((s) => (
          <Chip key={s} label={t(`myListings.tabs.${s}` as TKey)} selected={status === s} onPress={() => setStatus(s)} />
        ))}
      </ScrollView>
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => <MyListingCard l={item} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={c.primary} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListEmptyComponent={
          q.isLoading ? (
            <View style={{ gap: spacing.md }}>
              <Skeleton height={150} />
              <Skeleton height={150} />
            </View>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <EmptyState icon="albums-outline" title={t('myListings.empty')} action={t('myListings.newListing')} onAction={() => router.push('/post')} />
          )
        }
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
      />
    </View>
  );
}

function MyListingCard({ l }: { l: MyListing }) {
  const { c } = useTheme();
  const { t, te, fmtDate } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const price = usePriceLabel();
  const [menu, setMenu] = useState(false);
  const [creditMenu, setCreditMenu] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['myListings'] });
    qc.invalidateQueries({ queryKey: qk.listing(l.id) });
    qc.invalidateQueries({ queryKey: qk.me });
  };
  const action = useMutation({
    mutationFn: (a: 'MARK_SOLD' | 'ARCHIVE' | 'RENEW' | 'RESTORE') => api.listingAction(l.id, a),
    onSuccess: () => {
      toast.success(t('myListings.done'));
      refresh();
    },
    onError: toast.error,
  });
  const credit = useMutation({
    mutationFn: (cr: 'BUMP' | 'VIP_7' | 'PREMIUM_7') => api.applyCredit(l.id, cr),
    onSuccess: () => {
      toast.success(t('promote.creditApplied'));
      refresh();
    },
    onError: toast.error,
  });

  const confirm = (msg: string, fn: () => void) =>
    Alert.alert(msg, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.yes'), onPress: fn },
    ]);

  const usage = me?.subscription && me.subscription.status !== 'EXPIRED' ? me.subscription.usage : null;
  const credits = usage
    ? ([
        ['BUMP', usage.bumpsLeft],
        ['VIP_7', usage.vipCreditsLeft],
        ['PREMIUM_7', usage.premiumCreditsLeft],
      ] as const).filter(([, n]) => n > 0)
    : [];

  const actions = [
    { label: t('myListings.view'), onPress: () => router.push({ pathname: '/listing/[id]', params: { id: l.id } }) },
    { label: t('myListings.stats'), onPress: () => router.push({ pathname: '/me/listing-stats', params: { id: l.id, title: l.title } }) },
    ...(l.dealType === 'RENT_DAILY' ? [{ label: t('myListings.calendar'), onPress: () => router.push({ pathname: '/me/calendar', params: { id: l.id } }) }] : []),
    ...(l.requiresPayment ? [{ label: t('myListings.payFee'), onPress: () => router.push({ pathname: '/post/fee', params: { id: l.id } }) }] : []),
    ...(l.status === 'ACTIVE' && credits.length ? [{ label: t('myListings.applyCredit'), onPress: () => setCreditMenu(true) }] : []),
    ...(['ACTIVE', 'EXPIRED'].includes(l.status) ? [{ label: t('myListings.renew'), onPress: () => action.mutate('RENEW') }] : []),
    ...(['ARCHIVED', 'SOLD', 'EXPIRED'].includes(l.status) ? [{ label: t('myListings.restore'), onPress: () => action.mutate('RESTORE') }] : []),
    ...(l.status === 'ACTIVE' ? [{ label: t('myListings.markSold'), onPress: () => confirm(t('myListings.confirmSold'), () => action.mutate('MARK_SOLD')) }] : []),
    ...(!['ARCHIVED', 'SOLD'].includes(l.status) ? [{ label: t('myListings.archive'), danger: true, onPress: () => confirm(t('myListings.confirmArchive'), () => action.mutate('ARCHIVE')) }] : []),
  ];

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }} highlight={l.isHighlighted}>
      <Pressable onPress={() => router.push({ pathname: '/listing/[id]', params: { id: l.id } })} style={styles.top} accessibilityRole="button">
        {l.coverUrl ? (
          <Image source={{ uri: absUrl(l.coverUrl) }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, { backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="image-outline" size={24} color={c.muted} />
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <StatusPill label={te('listingStatus', l.status)} tone={TONE[l.status]} />
          <Text style={{ fontWeight: '700' }}>{price(l)}</Text>
          <Text numberOfLines={2} variant="small">
            {l.title}
          </Text>
          {l.expiresAt && l.status === 'ACTIVE' && (
            <Text variant="caption" muted>
              {t('myListings.expires', { date: fmtDate(l.expiresAt) })}
            </Text>
          )}
        </View>
      </Pressable>
      <View style={[styles.stats, { borderColor: c.border }]}>
        <Stat icon="eye-outline" value={l.views} label={t('myListings.views')} />
        <Stat icon="call-outline" value={l.phoneViews} label={t('myListings.phoneViews')} />
        <Stat icon="heart-outline" value={l.favoritesCount} label={t('myListings.favorites')} />
      </View>
      {(l.promotions.length > 0 || l.isVip || l.isPremium) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          {l.isPremium && <Badge label={t('badge.premium')} color={brand.premium} icon="diamond" />}
          {l.isVip && <Badge label={t('badge.vip')} color={brand.vip} textColor="#1F1300" icon="star" />}
          {l.isUrgent && <Badge label={t('badge.urgent')} color={brand.urgent} icon="flash" />}
          {l.promotions
            .filter((p) => p.endsAt)
            .slice(0, 3)
            .map((p) => (
              <Text key={p.id} variant="caption" muted>
                {p.type} → {fmtDate(p.endsAt)}
              </Text>
            ))}
        </View>
      )}
      {l.rejectionReason && l.status === 'REJECTED' && (
        <Text variant="small" color={c.danger} style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          {t('myListings.rejected', { reason: l.rejectionReason })}
        </Text>
      )}
      {l.requiresPayment && (
        <Text variant="small" color={c.warning} style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          {t('myListings.waitingPayment')}
        </Text>
      )}
      <View style={styles.actions}>
        {l.requiresPayment ? (
          <Button title={t('myListings.payFee')} small style={{ flex: 1 }} icon="card-outline" onPress={() => router.push({ pathname: '/post/fee', params: { id: l.id } })} />
        ) : (
          ['ACTIVE', 'PENDING'].includes(l.status) && (
            <Button title={t('post.promoteNow')} small kind="vip" style={{ flex: 1 }} icon="rocket-outline" onPress={() => router.push({ pathname: '/promote/[id]', params: { id: l.id } })} />
          )
        )}
        <Button title={t('common.edit')} small kind="outline" style={{ flex: 1 }} icon="create-outline" onPress={() => router.push({ pathname: '/post', params: { editId: l.id } })} />
        <IconButton name="ellipsis-horizontal" label={t('myListings.actions')} onPress={() => setMenu(true)} bg={c.surface} />
      </View>
      <ActionSheet visible={menu} onClose={() => setMenu(false)} title={t('myListings.actions')} actions={actions} />
      <ActionSheet
        visible={creditMenu}
        onClose={() => setCreditMenu(false)}
        title={t('promote.credits')}
        actions={credits.map(([code, n]) => ({ label: `${te('credit', code)} · ${t('promote.creditsLeft', { n })}`, onPress: () => credit.mutate(code) }))}
      />
    </Card>
  );
}

function Stat({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }} accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={14} color={c.muted} />
        <Text style={{ fontWeight: '700' }}>{value}</Text>
      </View>
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  thumb: { width: 96, height: 96, borderRadius: radius.sm },
  stats: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, alignItems: 'center' },
});
