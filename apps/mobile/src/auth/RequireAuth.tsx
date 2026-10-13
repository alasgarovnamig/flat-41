import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from './AuthContext';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { EmptyState, Loading } from '../components/ui';

/** Wraps screens that need a session (deep links / push taps can land on them while logged out). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { t } = useI18n();
  const { c } = useTheme();
  if (status === 'loading') return <Loading />;
  if (status === 'guest')
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <EmptyState icon="lock-closed-outline" title={t('auth.promptTitle')} text={t('auth.promptBody')} action={t('common.login')} onAction={() => router.push('/auth/login')} />
      </View>
    );
  return <>{children}</>;
}
