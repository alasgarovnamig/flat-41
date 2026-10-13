import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Card, ErrorState, Loading, Text } from '@/components/ui';

export default function ListingStatsScreen() {
  return (
    <RequireAuth>
      <Stats />
    </RequireAuth>
  );
}

function Stats() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { c } = useTheme();
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.stats(id), queryFn: () => api.listingStats(id) });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const daily = s.daily.slice(-30);
  const max = Math.max(1, ...daily.map((d) => d.views));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      {!!title && <Text variant="h3">{title}</Text>}
      <View style={styles.tiles}>
        {[
          [t('myListings.views'), s.views],
          [t('myListings.phoneViews'), s.phoneViews],
          [t('myListings.favorites'), s.favorites],
          [t('myListings.messages'), s.messages],
        ].map(([label, value]) => (
          <Card key={String(label)} style={styles.tile}>
            <Text variant="h1">{value}</Text>
            <Text variant="small" muted>
              {label}
            </Text>
          </Card>
        ))}
      </View>
      <Card style={{ gap: spacing.md }}>
        <Text variant="h3">
          {t('myListings.statsTitle')} · {t('myListings.views')}
        </Text>
        <View style={styles.chart} accessibilityLabel={daily.map((d) => `${d.date}: ${d.views}`).join(', ')}>
          {daily.map((d) => (
            <View key={d.date} style={styles.col}>
              <View style={{ height: `${(d.views / max) * 100}%`, backgroundColor: c.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: d.views ? 2 : 0 }} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" muted>
            {daily[0]?.date}
          </Text>
          <Text variant="caption" muted>
            max {max}
          </Text>
          <Text variant="caption" muted>
            {daily[daily.length - 1]?.date}
          </Text>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', flexGrow: 1, gap: 2, borderRadius: radius.md },
  chart: { height: 140, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end' },
});
