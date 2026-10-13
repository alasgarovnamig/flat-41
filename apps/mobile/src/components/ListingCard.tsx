import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatPrice, getCity, getDistrict, getMetro, type ListingCard as Card } from '@evtap/shared';
import { absUrl } from '../config';
import { useI18n } from '../i18n';
import { brand, radius, spacing, useTheme } from '../theme';
import { Badge, Skeleton, Text } from './ui';
import { useFavorites } from '../hooks/useFavorites';

export function usePriceLabel() {
  const { t } = useI18n();
  return (l: Pick<Card, 'price' | 'currency' | 'pricePeriod'>) =>
    `${formatPrice(l.price, l.currency)}${l.pricePeriod === 'DAY' ? ` ${t('common.perNight')}` : l.pricePeriod === 'MONTH' ? ` ${t('common.perMonth')}` : ''}`;
}

export function useListingFacts() {
  const { t } = useI18n();
  return (l: Pick<Card, 'rooms' | 'area' | 'floor' | 'totalFloors' | 'landArea' | 'propertyType'>) =>
    [
      l.rooms != null && l.rooms > 0 ? t('common.roomsShort', { n: l.rooms }) : null,
      l.area ? `${l.area} ${t('common.m2')}` : null,
      l.landArea ? `${l.landArea} ${t('common.sot')}` : null,
      l.floor != null && l.totalFloors ? t('common.floorOf', { floor: l.floor, total: l.totalFloors }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
}

export function useLocationLabel() {
  const { ln } = useI18n();
  return (l: Pick<Card, 'cityId' | 'districtId' | 'metroId'>) =>
    [l.metroId ? `Ⓜ ${ln(getMetro(l.metroId)?.name)}` : null, l.districtId ? ln(getDistrict(l.districtId)?.name) : null, ln(getCity(l.cityId)?.name)]
      .filter(Boolean)
      .join(', ');
}

export function ListingBadges({ l, size = 'sm' }: { l: Pick<Card, 'isVip' | 'isPremium' | 'isUrgent' | 'isVerified' | 'isBusiness'>; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const s = size === 'md' ? { paddingVertical: 4, paddingHorizontal: 8 } : undefined;
  return (
    <View style={styles.badges}>
      {l.isPremium && <Badge label={t('badge.premium')} color={brand.premium} icon="diamond" style={s} />}
      {l.isVip && <Badge label={t('badge.vip')} color={brand.vip} textColor="#1F1300" icon="star" style={s} />}
      {l.isUrgent && <Badge label={t('badge.urgent')} color={brand.urgent} icon="flash" style={s} />}
      {l.isVerified && <Badge label={t('badge.verified')} color={brand.primary} icon="checkmark-circle" style={s} />}
    </View>
  );
}

function ListingCardBase({ item, variant = 'list', width }: { item: Card; variant?: 'list' | 'carousel'; width?: number }) {
  const { c } = useTheme();
  const { t, fmtRelative } = useI18n();
  const fav = useFavorites();
  const price = usePriceLabel();
  const facts = useListingFacts();
  const loc = useLocationLabel();
  const isFav = fav.isFavorite(item.id);
  const highlight = item.isHighlighted;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/listing/[id]', params: { id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${price(item)}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: highlight ? c.highlightBg : c.card, borderColor: highlight ? c.vip : c.border, opacity: pressed ? 0.92 : 1 },
        variant === 'carousel' && { width: width ?? 260 },
      ]}
    >
      <View>
        {item.coverUrl ? (
          <Image
            source={{ uri: absUrl(item.coverUrl) }}
            style={[styles.image, variant === 'carousel' && { height: 150 }]}
            contentFit="cover"
            transition={150}
            recyclingKey={item.id}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.image, styles.noImage, { backgroundColor: c.surface }, variant === 'carousel' && { height: 150 }]}>
            <Ionicons name="home-outline" size={36} color={c.muted} />
          </View>
        )}
        <View style={styles.overlayTop}>
          <ListingBadges l={item} />
        </View>
        <Pressable
          onPress={() => fav.toggle(item.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('tabs.favorites')}
          accessibilityState={{ selected: isFav }}
          style={styles.heart}
        >
          <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? brand.urgent : '#fff'} />
        </Pressable>
        {item.imagesCount > 1 && (
          <View style={styles.count}>
            <Ionicons name="camera" size={12} color="#fff" />
            <Text variant="caption" color="#fff">
              {item.imagesCount}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="h3" style={{ color: c.text, flexShrink: 1 }} numberOfLines={1}>
            {price(item)}
          </Text>
          {item.rating != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Ionicons name="star" size={13} color={brand.vip} />
              <Text variant="small">{item.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={{ fontWeight: '500' }}>
          {item.title}
        </Text>
        {!!facts(item) && (
          <Text variant="small" muted numberOfLines={1}>
            {facts(item)}
          </Text>
        )}
        <Text variant="small" muted numberOfLines={1}>
          {loc(item)}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <Text variant="caption" muted>
            {fmtRelative(item.bumpedAt)}
          </Text>
          {item.isBusiness ? (
            <Text variant="caption" color={c.primary} style={{ fontWeight: '600' }}>
              {t('badge.business')}
            </Text>
          ) : (
            <Text variant="caption" muted>
              {t('badge.owner')}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export const ListingCard = memo(ListingCardBase);

export function ListingCardSkeleton({ variant = 'list' }: { variant?: 'list' | 'carousel' }) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { borderColor: c.border, backgroundColor: c.card }, variant === 'carousel' && { width: 260 }]}>
      <Skeleton height={variant === 'carousel' ? 150 : 190} style={{ borderRadius: 0 }} />
      <View style={[styles.body, { gap: 8 }]}>
        <Skeleton height={18} width="50%" />
        <Skeleton height={14} width="85%" />
        <Skeleton height={12} width="60%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  image: { width: '100%', height: 190 },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  overlayTop: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: 52 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heart: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  body: { padding: spacing.md, gap: 3 },
});
