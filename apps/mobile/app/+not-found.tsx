import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: '' }} />
      <EmptyState icon="compass-outline" title={t('page.notFound')} action={t('payment.backHome')} onAction={() => router.replace('/')} />
    </View>
  );
}
