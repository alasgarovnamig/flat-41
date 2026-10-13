import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from '../components/Sheet';
import { Button, Text } from '../components/ui';
import { useI18n } from '../i18n';
import { spacing, useTheme } from '../theme';

/** Shown by `requireAuth()` when a guest tries a protected action (favorite, message, post, book…). */
export function LoginPromptSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} scroll={false}>
      <View style={{ alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person-circle-outline" size={36} color={c.primary} />
        </View>
        <Text variant="h2">{t('auth.promptTitle')}</Text>
        <Text muted style={{ textAlign: 'center' }}>
          {t('auth.promptBody')}
        </Text>
        <Button
          title={t('common.login')}
          icon="log-in-outline"
          onPress={() => {
            onClose();
            router.push('/auth/login');
          }}
        />
        <Button title={t('common.cancel')} kind="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}
