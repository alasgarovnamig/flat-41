import { useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatPrice, pricePerM2, type ListingDetail } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl, listingWebUrl } from '@/config';
import { useI18n } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Avatar, Button, Card, Divider, ErrorState, IconButton, SectionHeader, Skeleton, Text } from '@/components/ui';
import { ListingBadges, ListingCard, useListingFacts, useLocationLabel, usePriceLabel } from '@/components/ListingCard';
import { StaticMap } from '@/components/map/Maps';
import { MortgageCalculator } from '@/components/MortgageCalculator';
import { ReportSheet } from '@/components/ReportSheet';
import { ReviewItem, Stars } from '@/components/ReviewItem';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/Toast';
import { useRefresh } from '@/hooks/common';
import { whatsappUrl } from '@/lib/phone';

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listing(id) });

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 100 }}>
        <Stack.Screen options={{ headerTransparent: false, title: '' }} />
        <ErrorState error={q.error} onRetry={() => q.refetch()} title={t('common.errorTitle')} />
      </View>
    );
  return <Detail l={q.data} refetch={q.refetch} />;
}

function Detail({ l, refetch }: { l: ListingDetail; refetch: () => Promise<unknown> }) {
  const { c } = useTheme();
  const { t, te, fmtDate } = useI18n();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const fav = useFavorites();
  const { requireAuth } = useAuth();
  const price = usePriceLabel();
  const facts = useListingFacts();
  const loc = useLocationLabel();
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const { refreshing, onRefresh } = useRefresh(refetch);
  const isFav = fav.loaded ? fav.isFavorite(l.id) : l.isFavorite;
  const daily = l.dealType === 'RENT_DAILY';

  const similar = useQuery({ queryKey: qk.similar(l.id), queryFn: () => api.similar(l.id) });
  const reviews = useQuery({ queryKey: qk.reviews(l.id), queryFn: () => api.reviews(l.id, { pageSize: 3 }), enabled: daily });

  const reveal = useMutation({
    mutationFn: () => api.revealPhone(l.id),
    onSuccess: (r) => {
      setPhone(r.phone);
      toast.show(t('listing.phoneRevealed'));
    },
    onError: toast.error,
  });
  const getPhone = async () => phone ?? (await reveal.mutateAsync()).phone;
  const call = async () => {
    const p = await getPhone().catch(() => null);
    if (p) Linking.openURL(`tel:${p}`).catch(() => {});
  };
  const whatsapp = async () => {
    const p = await getPhone().catch(() => null);
    if (p) Linking.openURL(whatsappUrl(p, t('listing.whatsappText', { url: listingWebUrl(l.id) }))).catch(() => {});
  };
  const share = () =>
    Share.share({ message: t('listing.shareText', { title: l.title, price: price(l), url: listingWebUrl(l.id) }), url: listingWebUrl(l.id), title: l.title }).catch(() => {});
  const message = () => requireAuth(() => router.push({ pathname: '/chat/new', params: { listingId: l.id, title: l.title, name: l.contactName } }));

  const images = l.images.length ? [...l.images].sort((a, b) => a.order - b.order) : [];

  const factRows: [string, string | null | undefined][] = [
    [t('listing.dealType'), te('dealType', l.dealType)],
    [t('listing.propertyType'), te('propertyType', l.propertyType)],
    [t('listing.buildingType'), l.buildingType ? te('buildingType', l.buildingType) : null],
    [t('listing.area'), l.area ? `${l.area} ${t('common.m2')}` : null],
    [t('listing.landArea'), l.landArea ? `${l.landArea} ${t('common.sot')}` : null],
    [t('listing.rooms'), l.rooms != null ? String(l.rooms) : null],
    [t('listing.bathrooms'), l.bathrooms != null ? String(l.bathrooms) : null],
    [t('listing.floor'), l.floor != null ? (l.totalFloors ? `${l.floor} / ${l.totalFloors}` : String(l.floor)) : null],
    [t('listing.yearBuilt'), l.yearBuilt ? String(l.yearBuilt) : null],
    [t('listing.ceilingHeight'), l.ceilingHeight ? `${l.ceilingHeight} m` : null],
    [t('listing.repair'), l.repair ? te('repair', l.repair) : null],
    [t('listing.document'), l.dealType === 'SALE' ? (l.hasDocument ? t('common.yes') : t('common.no')) : null],
    [t('listing.mortgage'), l.dealType === 'SALE' ? (l.mortgageAvailable ? t('common.yes') : t('common.no')) : null],
    [t('listing.maxGuests'), daily && l.maxGuests ? String(l.maxGuests) : null],
    [t('listing.minNights'), daily && l.minNights ? String(l.minNights) : null],
    [t('listing.checkInTime'), daily ? l.checkInTime : null],
    [t('listing.checkOutTime'), daily ? l.checkOutTime : null],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          headerTransparent: true,
          title: '',
          headerTintColor: '#fff',
          headerLeft: () => <IconButton name="chevron-back" label={t('common.back')} color="#fff" bg="rgba(0,0,0,0.35)" onPress={() => router.back()} />,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <IconButton name="share-outline" label={t('common.share')} color="#fff" bg="rgba(0,0,0,0.35)" onPress={share} />
              <IconButton
                name={isFav ? 'heart' : 'heart-outline'}
                label={t('tabs.favorites')}
                color={isFav ? brand.urgent : '#fff'}
                bg="rgba(0,0,0,0.35)"
                onPress={() => fav.toggle(l.id)}
              />
            </View>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        contentInsetAdjustmentBehavior="never"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} progressViewOffset={insets.top + 40} />}
      >
        {/* Gallery */}
        <View>
          {images.length ? (
            <FlatList
              data={images}
              keyExtractor={(i) => i.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item, index: i }) => (
                <Pressable onPress={() => router.push({ pathname: '/listing/gallery', params: { id: l.id, index: String(i) } })} accessibilityRole="imagebutton">
                  <Image source={{ uri: absUrl(item.url) }} placeholder={{ uri: absUrl(item.thumbUrl) }} style={{ width, height: 320 }} contentFit="cover" transition={150} />
                </Pressable>
              )}
            />
          ) : (
            <View style={{ width, height: 260, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="home-outline" size={56} color={c.muted} />
            </View>
          )}
          {images.length > 1 && (
            <View style={styles.counter}>
              <Text variant="small" color="#fff">
                {index + 1} / {images.length}
              </Text>
            </View>
          )}
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          {l.status !== 'ACTIVE' && (
            <View style={[styles.notice, { backgroundColor: c.highlightBg, borderColor: c.vip }]}>
              <Ionicons name="information-circle" size={20} color={c.warning} />
              <Text style={{ flex: 1 }}>
                {l.isOwner ? `${t('listing.yourListing')} · ${te('listingStatus', l.status)}` : t('listing.notActive')}
                {l.rejectionReason ? `\n${t('myListings.rejected', { reason: l.rejectionReason })}` : ''}
              </Text>
            </View>
          )}

          {/* Price & title */}
          <View style={{ gap: spacing.xs }}>
            <ListingBadges l={l} size="md" />
            <Text variant="h1" style={{ marginTop: spacing.xs }}>
              {price(l)}
            </Text>
            {l.dealType === 'SALE' && l.area > 0 && (
              <Text muted>{t('listing.pricePerM2', { price: formatPrice(pricePerM2(l.price, l.area), l.currency) })}</Text>
            )}
            <Text variant="h3" style={{ marginTop: spacing.xs }}>
              {l.title}
            </Text>
            <Text muted>{facts(l)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="location-outline" size={16} color={c.muted} />
              <Text muted style={{ flex: 1 }}>
                {[l.address, loc(l)].filter(Boolean).join(', ')}
              </Text>
            </View>
            {daily && l.rating != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Stars value={l.rating} />
                <Text variant="small" muted>
                  {l.rating.toFixed(1)} · {t('listing.reviewsCount', { n: l.reviewsCount })}
                </Text>
              </View>
            )}
          </View>

          {/* Facts */}
          <Card style={{ gap: 0, paddingVertical: spacing.sm }}>
            <Text variant="h3" style={{ marginBottom: spacing.sm }}>
              {t('listing.details')}
            </Text>
            {factRows
              .filter(([, v]) => !!v)
              .map(([k, v], i) => (
                <View key={k}>
                  {i > 0 && <Divider />}
                  <View style={styles.factRow}>
                    <Text muted>{k}</Text>
                    <Text style={{ fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text>
                  </View>
                </View>
              ))}
          </Card>

          {/* Description */}
          <View style={{ gap: spacing.sm }}>
            <Text variant="h3">{t('listing.description')}</Text>
            <Text numberOfLines={expanded ? undefined : 6} style={{ lineHeight: 22 }}>
              {l.description}
            </Text>
            {l.description.length > 280 && (
              <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8} accessibilityRole="button">
                <Text color={c.primary} style={{ fontWeight: '600' }}>
                  {expanded ? t('listing.showLess') : t('listing.showMore')}
                </Text>
              </Pressable>
            )}
            {daily && !!l.houseRules && (
              <View style={{ gap: 4, marginTop: spacing.sm }}>
                <Text variant="label">{t('listing.houseRules')}</Text>
                <Text>{l.houseRules}</Text>
              </View>
            )}
          </View>

          {/* Amenities */}
          {l.amenities.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Text variant="h3">{t('listing.amenities')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {l.amenities.map((a) => (
                  <View key={a} style={[styles.amenity, { backgroundColor: c.surface }]}>
                    <Ionicons name="checkmark" size={14} color={c.primary} />
                    <Text variant="small">{te('amenity', a)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Map snippet */}
          {l.lat != null && l.lng != null && (
            <View style={{ gap: spacing.sm }}>
              <Text variant="h3">{t('listing.location')}</Text>
              <Pressable
                onPress={() => Linking.openURL(`https://maps.google.com/?q=${l.lat},${l.lng}`).catch(() => {})}
                accessibilityRole="link"
                style={{ borderRadius: radius.md, overflow: 'hidden' }}
              >
                <StaticMap lat={l.lat} lng={l.lng} style={{ height: 180, width: '100%' }} />
              </Pressable>
            </View>
          )}

          {/* Owner card */}
          <Card style={{ gap: spacing.md }}>
            <Text variant="label" muted>
              {t('listing.owner')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar uri={l.agency?.logoUrl ?? l.owner.avatarUrl} name={l.agency?.name ?? l.contactName} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {l.agency?.name ?? l.contactName}
                  </Text>
                  {l.agency?.verified && <Ionicons name="checkmark-circle" size={16} color={c.primary} />}
                </View>
                {l.agency && <Text variant="small">{l.contactName}</Text>}
                <Text variant="small" muted>
                  {l.isBusiness || l.agency ? t('badge.business') : t('badge.owner')} · {t('listing.activeListings', { n: l.owner.activeListings })}
                </Text>
                <Text variant="caption" muted>
                  {t('listing.memberSince', { date: fmtDate(l.owner.memberSince) })}
                </Text>
              </View>
              {l.owner.rating != null && (
                <View style={{ alignItems: 'center' }}>
                  <Ionicons name="star" size={16} color={brand.vip} />
                  <Text variant="small">{l.owner.rating.toFixed(1)}</Text>
                </View>
              )}
            </View>
            {!l.isOwner && (
              <Pressable onPress={() => (phone ? call() : reveal.mutate())} accessibilityRole="button" style={[styles.phone, { borderColor: c.border }]}>
                <Ionicons name="call-outline" size={18} color={c.primary} />
                <Text style={{ fontWeight: '600', letterSpacing: 0.5 }}>{phone ?? l.contactPhoneMasked}</Text>
                {!phone && (
                  <Text color={c.primary} variant="small" style={{ marginLeft: 'auto', fontWeight: '600' }}>
                    {t('listing.showPhone')}
                  </Text>
                )}
              </Pressable>
            )}
          </Card>

          {/* Reviews (daily rent) */}
          {daily && (
            <View>
              <SectionHeader
                title={`${t('listing.reviews')} (${l.reviewsCount})`}
                action={l.reviewsCount > 3 ? t('common.seeAll') : undefined}
                onAction={() => router.push({ pathname: '/listing/reviews', params: { id: l.id, isOwner: l.isOwner ? '1' : '' } })}
              />
              {reviews.data?.items.length ? (
                reviews.data.items.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 && <Divider />}
                    <ReviewItem review={r} canReply={l.isOwner} />
                  </View>
                ))
              ) : (
                <Text muted>{reviews.isLoading ? t('common.loading') : t('listing.noReviews')}</Text>
              )}
            </View>
          )}

          {/* Mortgage */}
          {l.dealType === 'SALE' && l.currency === 'AZN' && ['APARTMENT', 'HOUSE'].includes(l.propertyType) && (
            <MortgageCalculator price={l.price} currency={l.currency} listingId={l.id} />
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text variant="caption" muted>
                {t('listing.id', { id: l.id.slice(0, 8).toUpperCase() })} · {t('common.views')}: {l.views}
              </Text>
              <Text variant="caption" muted>
                {t('listing.updated', { date: fmtDate(l.updatedAt) })}
              </Text>
            </View>
            {!l.isOwner && <Button title={t('listing.report')} kind="ghost" small full={false} icon="flag-outline" onPress={() => setReportOpen(true)} />}
          </View>
        </View>

        {/* Similar */}
        {!!similar.data?.length && (
          <View style={{ gap: spacing.md }}>
            <SectionHeader title={t('listing.similar')} style={{ paddingHorizontal: spacing.lg, marginBottom: 0 }} />
            <FlatList
              horizontal
              data={similar.data}
              keyExtractor={(x) => x.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
              renderItem={({ item }) => <ListingCard item={item} variant="carousel" />}
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + spacing.sm }]}>
        {l.isOwner ? (
          <>
            <Button title={t('listing.manage')} kind="outline" icon="settings-outline" style={{ flex: 1 }} onPress={() => router.push('/me/listings')} />
            <Button title={t('post.promoteNow')} kind="vip" icon="rocket-outline" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/promote/[id]', params: { id: l.id } })} />
          </>
        ) : daily ? (
          <>
            <View style={{ flex: 1 }}>
              <Text variant="h3">{price(l)}</Text>
              {l.minNights ? (
                <Text variant="caption" muted>
                  {t('booking.minNights', { n: l.minNights })}
                </Text>
              ) : null}
            </View>
            <IconButton name="chatbubble-ellipses-outline" label={t('listing.message')} onPress={message} bg={c.surface} color={c.primary} />
            <Button title={t('listing.book')} full={false} style={{ paddingHorizontal: spacing.xl }} onPress={() => requireAuth(() => router.push({ pathname: '/listing/book', params: { id: l.id } }))} />
          </>
        ) : (
          <>
            <Button title={t('listing.call')} icon="call" style={{ flex: 1 }} loading={reveal.isPending} onPress={call} />
            <Pressable onPress={whatsapp} accessibilityRole="button" accessibilityLabel={t('listing.whatsapp')} style={[styles.wa, { backgroundColor: brand.whatsapp }]}>
              <Ionicons name="logo-whatsapp" size={24} color="#fff" />
            </Pressable>
            <Button title={t('listing.message')} kind="secondary" icon="chatbubble-ellipses-outline" style={{ flex: 1 }} onPress={message} />
          </>
        )}
      </View>

      <ReportSheet listingId={l.id} visible={reportOpen} onClose={() => setReportOpen(false)} />
    </View>
  );
}

function DetailSkeleton() {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Skeleton height={320} style={{ borderRadius: 0 }} />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton height={28} width="45%" />
        <Skeleton height={18} width="80%" />
        <Skeleton height={14} width="60%" />
        <Skeleton height={160} />
        <Skeleton height={14} />
        <Skeleton height={14} width="90%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { position: 'absolute', right: spacing.md, bottom: spacing.md, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, alignItems: 'flex-start' },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 40, alignItems: 'center', gap: spacing.md },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  phone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  wa: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
