import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { DEAL_TYPES, formatPrice, getCity, type ListingSort } from '@evtap/shared';
import { api } from '@/api/client';
import { qk, queryClient } from '@/api/queryClient';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Button, Chip, EmptyState, ErrorState, Field, IconButton, SwitchRow, Text } from '@/components/ui';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { ActionSheet, Sheet } from '@/components/Sheet';
import { FilterSheet, countFilters, type Filters } from '@/components/FilterSheet';
import { ListingsMap } from '@/components/map/Maps';
import { regionToBbox, type MapRegion } from '@/components/map/types';
import { useDebounced } from '@/hooks/common';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/Toast';

const PAGE_SIZE = 20;
const SORTS: ListingSort[] = ['date_desc', 'price_asc', 'price_desc', 'area_asc', 'area_desc'];

type Params = { q?: string; dealType?: string; cityId?: string; filters?: string; openFilters?: string; view?: string };

/** Compact price for map markers: 125000 → "125K", 1250000 → "1.3M". */
const shortPrice = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : String(n));

export default function Search() {
  const { c } = useTheme();
  const { t, te, ln } = useI18n();
  const toast = useToast();
  const { requireAuth } = useAuth();
  const params = useLocalSearchParams<Params>();

  const [filters, setFilters] = useState<Filters>({ sort: 'date_desc' });
  const [qText, setQText] = useState('');
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  // Apply params coming from Home / saved searches / deep links.
  const lastParams = useRef<string>('');
  useEffect(() => {
    const key = JSON.stringify(params);
    if (key === lastParams.current) return;
    lastParams.current = key;
    let next: Filters = { sort: 'date_desc' };
    if (params.filters) {
      try {
        next = { ...next, ...(JSON.parse(params.filters) as Filters) };
      } catch {
        /* ignore malformed */
      }
    }
    if (params.q) next.q = params.q;
    if (params.dealType && (DEAL_TYPES as string[]).includes(params.dealType)) next.dealType = params.dealType as Filters['dealType'];
    if (params.cityId) next.cityId = params.cityId;
    if (Object.keys(params).length) {
      setFilters(next);
      setQText(next.q ?? '');
    }
    if (params.openFilters) setFilterOpen(true);
    if (params.view === 'map') setMode('map');
  }, [params]);

  const debouncedQ = useDebounced(qText, 450);
  useEffect(() => {
    setFilters((f) => (f.q === (debouncedQ.trim() || undefined) ? f : { ...f, q: debouncedQ.trim() || undefined }));
  }, [debouncedQ]);

  const list = useInfiniteQuery({
    queryKey: qk.listings(filters),
    queryFn: ({ pageParam, signal }) => api.listings({ ...filters, page: pageParam, pageSize: PAGE_SIZE }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: mode === 'list',
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total;

  // ── Map
  const city = getCity(filters.cityId ?? 'baku') ?? getCity('baku')!;
  const initialRegion = useMemo<MapRegion>(
    () => ({ latitude: city.lat, longitude: city.lng, latitudeDelta: 0.18, longitudeDelta: 0.18 }),
    [city.lat, city.lng],
  );
  const [region, setRegion] = useState<MapRegion>(initialRegion);
  const [selected, setSelected] = useState<string | null>(null);
  const bbox = useDebounced(regionToBbox(region), 350);
  const mapQ = useQuery({
    queryKey: qk.map({ ...filters, bbox }),
    queryFn: ({ signal }) => api.map({ ...filters, bbox }, signal),
    enabled: mode === 'map',
    placeholderData: (prev) => prev,
  });
  const markers = useMemo(
    () =>
      (mapQ.data ?? []).map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        label: `${shortPrice(p.price)} ${p.currency === 'AZN' ? '₼' : p.currency}`,
        tone: p.isPremium ? ('premium' as const) : p.isVip ? ('vip' as const) : ('default' as const),
        selected: p.id === selected,
      })),
    [mapQ.data, selected],
  );
  const selectedListing = useQuery({ queryKey: qk.listing(selected ?? ''), queryFn: () => api.listing(selected!), enabled: !!selected });

  const activeCount = countFilters(filters);

  const save = useMutation({
    mutationFn: (v: { name: string; notify: boolean }) => {
      const { sort, ...query } = filters;
      return api.createSavedSearch({ name: v.name, notify: v.notify, query: { ...query, sort } });
    },
    onSuccess: () => {
      toast.success(t('search.searchSaved'));
      queryClient.invalidateQueries({ queryKey: qk.savedSearches });
      setSaveOpen(false);
    },
    onError: toast.error,
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Top bar */}
      <View style={styles.top}>
        <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput
            value={qText}
            onChangeText={setQText}
            placeholder={t('home.searchPlaceholder')}
            placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.text, paddingVertical: 10, fontSize: 15 }}
            returnKeyType="search"
            accessibilityLabel={t('common.search')}
          />
          {!!qText && <IconButton name="close-circle" size={18} color={c.muted} label={t('common.clear')} onPress={() => setQText('')} />}
        </View>
        <Pressable onPress={() => setFilterOpen(true)} accessibilityRole="button" accessibilityLabel={t('common.filters')} style={[styles.filterBtn, { backgroundColor: activeCount ? c.primary : c.surface, borderColor: c.border }]}>
          <Ionicons name="options-outline" size={20} color={activeCount ? c.onPrimary : c.text} />
          {activeCount > 0 && <Text style={{ color: c.onPrimary, fontWeight: '700' }}>{activeCount}</Text>}
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.chips}>
        <Chip icon={mode === 'list' ? 'map-outline' : 'list-outline'} label={mode === 'list' ? t('search.map') : t('search.list')} onPress={() => setMode((m) => (m === 'list' ? 'map' : 'list'))} />
        {DEAL_TYPES.map((d) => (
          <Chip key={d} label={te('dealTypeShort', d)} selected={filters.dealType === d} onPress={() => setFilters((f) => ({ ...f, dealType: f.dealType === d ? undefined : d }))} />
        ))}
        <Chip icon="swap-vertical" label={t(`sort.${(filters.sort ?? 'date_desc') as ListingSort}`)} onPress={() => setSortOpen(true)} />
      </ScrollView>

      {mode === 'list' ? (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
          renderItem={({ item }) => <ListingCard item={item} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={c.primary} />}
          ListHeaderComponent={
            total !== undefined ? (
              <View style={styles.resultsHeader}>
                <Text variant="label">{t('search.results', { n: total })}</Text>
                <Button title={t('search.saveSearch')} icon="bookmark-outline" kind="ghost" small full={false} onPress={() => requireAuth(() => setSaveOpen(true))} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            list.isLoading ? (
              <View style={{ gap: spacing.md }}>
                <ListingCardSkeleton />
                <ListingCardSkeleton />
                <ListingCardSkeleton />
              </View>
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : (
              <EmptyState icon="search-outline" title={t('search.noResults')} text={t('search.noResultsHint')} action={t('common.reset')} onAction={() => setFilters({ sort: 'date_desc' })} />
            )
          }
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={c.primary} style={{ margin: spacing.lg }} /> : null}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <ListingsMap
            key={`${initialRegion.latitude},${initialRegion.longitude}`}
            initialRegion={initialRegion}
            markers={markers}
            onRegionChangeComplete={setRegion}
            onMarkerPress={setSelected}
            onMapPress={() => setSelected(null)}
          />
          {mapQ.isFetching && (
            <View style={[styles.mapBadge, { backgroundColor: c.bg }]}>
              <ActivityIndicator size="small" color={c.primary} />
            </View>
          )}
          {(mapQ.data?.length ?? 0) >= 500 && (
            <View style={[styles.mapBadge, { backgroundColor: c.bg, right: undefined, left: spacing.lg }]}>
              <Text variant="small">{t('search.mapLimit')}</Text>
            </View>
          )}
          {selected && (
            <View style={styles.mapCard}>
              {selectedListing.data ? <ListingCard item={selectedListing.data} /> : <ListingCardSkeleton />}
            </View>
          )}
        </View>
      )}

      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={(f) => setFilters({ ...f, q: filters.q })} />

      <ActionSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        title={t('search.sort')}
        actions={SORTS.map((s) => ({ label: `${filters.sort === s ? '✓ ' : ''}${t(`sort.${s}`)}`, onPress: () => setFilters((f) => ({ ...f, sort: s })) }))}
      />

      <SaveSearchSheet
        visible={saveOpen}
        onClose={() => setSaveOpen(false)}
        loading={save.isPending}
        defaultName={[filters.dealType && te('dealType', filters.dealType), filters.cityId && ln(getCity(filters.cityId)?.name), filters.priceMax && `≤ ${formatPrice(filters.priceMax, (filters.currency as 'AZN') ?? 'AZN')}`].filter(Boolean).join(', ') || t('search.title')}
        onSave={(v) => save.mutate(v)}
      />
    </SafeAreaView>
  );
}

function SaveSearchSheet({ visible, onClose, onSave, loading, defaultName }: { visible: boolean; onClose: () => void; onSave: (v: { name: string; notify: boolean }) => void; loading: boolean; defaultName: string }) {
  const { t } = useI18n();
  const [name, setName] = useState(defaultName);
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    if (visible) setName(defaultName);
  }, [visible, defaultName]);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('search.saveSearch')}>
      <Field label={t('search.saveSearchName')} value={name} onChangeText={setName} maxLength={80} autoFocus />
      <SwitchRow label={t('search.saveSearchNotify')} value={notify} onChange={setNotify} />
      <Button title={t('common.save')} loading={loading} disabled={!name.trim()} onPress={() => onSave({ name: name.trim(), notify })} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, alignItems: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingLeft: spacing.md },
  filterBtn: { minWidth: 48, height: 46, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 10 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mapBadge: { position: 'absolute', top: spacing.md, right: spacing.lg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4 },
  mapCard: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
});
