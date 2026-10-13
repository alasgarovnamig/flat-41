import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { EmptyState, ErrorState, Loading, Text } from '@/components/ui';
import { isNotFound } from '@/lib/errors';

/** Minimal Markdown/HTML → blocks renderer for CMS pages (headings, lists, paragraphs). */
function toBlocks(body: string) {
  const text = body
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<h([1-3])[^>]*>/gi, (_, n: string) => '#'.repeat(Number(n)) + ' ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

export default function CmsPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c } = useTheme();
  const { t, locale, fmtDate } = useI18n();
  const q = useQuery({ queryKey: qk.page(slug, locale), queryFn: () => api.page(slug) });

  if (q.isLoading) return <Loading />;
  if (q.isError)
    return isNotFound(q.error) ? <EmptyState icon="document-outline" title={t('page.notFound')} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const page = q.data!;
  const title = page.title[locale] || page.title.az;
  const blocks = toBlocks(page.body[locale] || page.body.az);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Stack.Screen options={{ title }} />
      <Text variant="h1">{title}</Text>
      <Text variant="caption" muted>
        {fmtDate(page.updatedAt)}
      </Text>
      {blocks.map((b, i) => {
        if (b.startsWith('### ')) return <Text key={i} variant="h3">{b.slice(4)}</Text>;
        if (b.startsWith('## ')) return <Text key={i} variant="h2">{b.slice(3)}</Text>;
        if (b.startsWith('# ')) return <Text key={i} variant="h1">{b.slice(2)}</Text>;
        if (/^[-*] /.test(b))
          return (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Text>•</Text>
              <Text style={{ flex: 1, lineHeight: 22 }}>{b.slice(2).replace(/\*\*/g, '')}</Text>
            </View>
          );
        return (
          <Text key={i} style={{ lineHeight: 22 }}>
            {b.replace(/\*\*/g, '')}
          </Text>
        );
      })}
    </ScrollView>
  );
}
