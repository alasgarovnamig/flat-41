import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { DEAL_TYPES, type Banner, type DealType } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl, WEB_URL } from '@/config';
import { useI18n } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Chip, IconButton, SectionHeader, Text } from '@/components/ui';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { popularCities, useRefresh } from '@/hooks/common';
import { useAuth } from '@/auth/AuthContext';

const DEAL_ICONS: Record<DealType, keyof typeof Ionicons.glyphMap> = { SALE: 'pricetag-outline', RENT_LONG: 'key-outline', RENT_DAILY: 'calendar-outline' };

export default function Home() {
  const { c } = useTheme();
  const { t, te, ln } = useI18n();
  const { width } = useWindowDimensions();
  const { me, requireAuth } = useAuth();
  const [q, setQ] = useState('');

  const premium = useQuery({ queryKey: qk.featured('premium'), queryFn: () => api.featured({ kind: 'premium', limit: 12 }) });
  const vip = useQuery({ queryKey: qk.featured('vip'), queryFn: () => api.featured({ kind: 'vip', limit: 6 }) });
  const latest = useQuery({ queryKey: qk.listings({ home: true }), queryFn: () => api.listings({ sort: 'date_desc', pageSize: 10 }) });
  const banners = useQuery({ queryKey: qk.banners('MOBILE_HOME'), queryFn: () => api.banners('MOBILE_HOME'), staleTime: 5 * 60_000 });

  const { refreshing, onRefresh } = useRefresh(() => Promise.all([premium.refetch(), vip.refetch(), latest.refetch(), banners.refetch()]));

  const goSearch = (params: Record<string, string>) => router.push({ pathname: '/search', params });

  const openBanner = (b: Banner) => {
    api.bannerClick(b.id).catch(() => {});
    if (b.linkUrl.startsWith(WEB_URL)) {
      const path = b.linkUrl.slice(WEB_URL.length) || '/';
      router.push(path as never);
    } else WebBrowser.openBrowserAsync(b.linkUrl).catch(() => {});
  };

  const cardW = Math.min(280, width * 0.72);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[styles.logo, { backgroundColor: brand.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>E</Text>
            </View>
            <Text variant="h2" style={{ color: c.primary }}>
              EvTap
            </Text>
          </View>
          <IconButton
            name="notifications-outline"
            label={t('notifications.title')}
            badge={!!me?.unreadNotifications}
            onPress={() => requireAuth(() => router.push('/me/notifications'))}
          />
        </View>

        {/* Search */}
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Ionicons name="search" size={20} color={c.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={c.muted}
              style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 12 }}
              returnKeyType="search"
              onSubmitEditing={() => goSearch(q.trim() ? { q: q.trim() } : {})}
              accessibilityLabel={t('home.searchPlaceholder')}
            />
            <IconButton name="options-outline" label={t('common.filters')} onPress={() => goSearch({ openFilters: '1' })} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {DEAL_TYPES.map((d) => (
              <Chip key={d} label={te('dealType', d)} icon={DEAL_ICONS[d]} onPress={() => goSearch({ dealType: d })} />
            ))}
          </ScrollView>
        </View>

        {/* Banners (placement MOBILE_HOME) */}
        {!!banners.data?.length && (
          <FlatList
            horizontal
            data={banners.data}
            keyExtractor={(b) => b.id}
            showsHorizontalScrollIndicator={false}
            snapToInterval={width - spacing.lg * 2 + spacing.sm}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, marginTop: spacing.lg }}
            renderItem={({ item }) => (
              <Pressable onPress={() => openBanner(item)} accessibilityRole="link" accessibilityLabel={item.title}>
                <Image source={{ uri: absUrl(item.imageUrl) }} style={[styles.banner, { width: width - spacing.lg * 2 }]} contentFit="cover" />
              </Pressable>
            )}
          />
        )}

        {/* Premium carousel */}
        <View style={styles.section}>
          <SectionHeader title={t('home.premium')} style={{ paddingHorizontal: spacing.lg }} />
          {premium.isLoading ? (
            <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }} showsHorizontalScrollIndicator={false}>
              <ListingCardSkeleton variant="carousel" />
              <ListingCardSkeleton variant="carousel" />
            </ScrollView>
          ) : (
            <FlatList
              horizontal
              data={premium.data ?? []}
              keyExtractor={(l) => l.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
              renderItem={({ item }) => <ListingCard item={item} variant="carousel" width={cardW} />}
              ListEmptyComponent={<PostPromo />}
            />
          )}
        </View>

        {/* VIP */}
        {(vip.isLoading || !!vip.data?.length) && (
          <View style={[styles.section, { paddingHorizontal: spacing.lg }]}>
            <SectionHeader title={t('home.vip')} action={t('common.seeAll')} onAction={() => goSearch({})} />
            <View style={{ gap: spacing.md }}>
              {vip.isLoading ? <ListingCardSkeleton /> : vip.data?.map((l) => <ListingCard key={l.id} item={l} />)}
            </View>
          </View>
        )}

        {/* Daily rent promo */}
        <Pressable
          onPress={() => goSearch({ dealType: 'RENT_DAILY' })}
          accessibilityRole="button"
          style={[styles.promo, { backgroundColor: c.primarySoft, marginHorizontal: spacing.lg }]}
        >
          <Ionicons name="sunny-outline" size={34} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="h3">{t('home.dailyPromoTitle')}</Text>
            <Text variant="small" muted>
              {t('home.dailyPromoText')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.primary} />
        </Pressable>

        {/* Popular cities */}
        <View style={[styles.section, { paddingHorizontal: spacing.lg }]}>
          <SectionHeader title={t('home.popularCities')} />
          <View style={styles.cities}>
            {popularCities.map((city) => (
              <Pressable
                key={city.id}
                onPress={() => goSearch({ cityId: city.id })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.city, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <Ionicons name="location-outline" size={18} color={c.primary} />
                <Text style={{ fontWeight: '600' }}>{ln(city.name)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Latest */}
        <View style={[styles.section, { paddingHorizontal: spacing.lg }]}>
          <SectionHeader title={t('home.latest')} action={t('common.seeAll')} onAction={() => goSearch({})} />
          <View style={{ gap: spacing.md }}>
            {latest.isLoading ? (
              <>
                <ListingCardSkeleton />
                <ListingCardSkeleton />
              </>
            ) : (
              latest.data?.items.map((l) => <ListingCard key={l.id} item={l} />)
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PostPromo() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { requireAuth } = useAuth();
  return (
    <Pressable
      onPress={() => requireAuth(() => router.push('/post'))}
      accessibilityRole="button"
      style={[styles.promo, { backgroundColor: c.highlightBg, width: 300 }]}
    >
      <Ionicons name="add-circle-outline" size={34} color={c.vip} />
      <View style={{ flex: 1 }}>
        <Text variant="h3">{t('home.postPromoTitle')}</Text>
        <Text variant="small" muted>
          {t('home.postPromoText')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  logo: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, paddingLeft: spacing.md },
  banner: { height: 140, borderRadius: radius.md },
  section: { marginTop: spacing.xl },
  promo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, marginTop: spacing.xl },
  cities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  city: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, minHeight: 44, borderRadius: radius.md, borderWidth: 1 },
});
