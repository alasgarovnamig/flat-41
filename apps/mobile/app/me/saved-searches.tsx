import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCity, type SavedSearch } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, IconButton, Skeleton, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function SavedSearchesScreen() {
  return (
    <RequireAuth>
      <SavedSearches />
    </RequireAuth>
  );
}

function SavedSearches() {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.savedSearches, queryFn: api.savedSearches });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteSavedSearch(id),
    onMutate: (id) => qc.setQueryData<SavedSearch[]>(qk.savedSearches, (old) => old?.filter((s) => s.id !== id)),
    onError: (e) => {
      toast.error(e);
      q.refetch();
    },
  });

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={q.data ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={c.primary} />}
      renderItem={({ item }) => <SavedRow s={item} onDelete={() => Alert.alert(t('saved.confirmDelete'), item.name, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: () => del.mutate(item.id) }])} />}
      ListEmptyComponent={
        q.isLoading ? (
          <Skeleton height={72} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <EmptyState icon="bookmark-outline" title={t('saved.empty')} text={t('saved.emptyHint')} action={t('common.search')} onAction={() => router.push('/search')} />
        )
      }
    />
  );
}

function SavedRow({ s, onDelete }: { s: SavedSearch; onDelete: () => void }) {
  const { c } = useTheme();
  const { t, te, ln, fmtDate } = useI18n();
  const query = s.query as Record<string, unknown>;
  const summary = [
    typeof query.dealType === 'string' ? te('dealType', query.dealType) : null,
    typeof query.cityId === 'string' ? ln(getCity(query.cityId)?.name) : null,
    query.priceMax ? `≤ ${query.priceMax}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card onPress={() => router.push({ pathname: '/search', params: { filters: JSON.stringify(s.query), t: String(Date.now()) } })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Ionicons name="search" size={22} color={c.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
            {s.name}
          </Text>
          {s.newMatches > 0 && <Badge label={t('saved.newMatches', { n: s.newMatches })} color={c.primary} />}
        </View>
        {!!summary && (
          <Text variant="small" muted numberOfLines={1}>
            {summary}
          </Text>
        )}
        <Text variant="caption" muted>
          {fmtDate(s.createdAt)}
          {s.notify ? ` · ${t('saved.notifyOn')}` : ''}
        </Text>
      </View>
      <IconButton name="trash-outline" label={t('common.delete')} color={c.danger} onPress={onDelete} />
    </Card>
  );
}
