import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { LOCALES, type Locale } from '@evtap/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { LOCALE_NAMES, useI18n } from '@/i18n';
import { APP_VERSION } from '@/config';
import { spacing, useTheme, type ThemePref } from '@/theme';
import { Button, Card, Divider, ListItem, Segmented, SwitchRow, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { getPushPref, registerForPush, unregisterPushToken } from '@/push/notifications';

export default function Settings() {
  const { c, pref, setPref } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { isAuthed, logout, refetchMe } = useAuth();
  const toast = useToast();
  const [push, setPush] = useState(true);

  useEffect(() => {
    getPushPref().then((p) => setPush(p.enabled));
  }, []);

  const changeLocale = (l: Locale) => {
    setLocale(l);
    // Server-side locale drives push/SMS language.
    if (isAuthed) api.updateMe({ locale: l }).then(refetchMe).catch(() => {});
  };

  const togglePush = async (v: boolean) => {
    setPush(v);
    if (!isAuthed) return;
    if (v) {
      const r = await registerForPush({ ask: true });
      if (r === 'denied') {
        setPush(false);
        Alert.alert(t('settings.push'), t('settings.pushDenied'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('profile.settings'), onPress: () => Linking.openSettings() },
        ]);
      }
    } else await unregisterPushToken(true);
  };

  const del = useMutation({
    mutationFn: api.deleteMe,
    onSuccess: async () => {
      await logout();
      toast.success(t('settings.deleted'));
      router.dismissTo('/');
    },
    onError: toast.error,
  });

  // App Store guideline 5.1.1(v): in-app account deletion.
  const confirmDelete = () =>
    Alert.alert(t('settings.deleteTitle'), t('settings.deleteText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('settings.deleteFinal'), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.deleteAccount'), style: 'destructive', onPress: () => del.mutate() },
          ]),
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">{t('settings.language')}</Text>
        <Segmented options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))} value={locale} onChange={changeLocale} />
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">{t('settings.theme')}</Text>
        <Segmented<ThemePref>
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
          value={pref}
          onChange={setPref}
        />
      </View>

      {isAuthed && (
        <>
          <Text variant="label" muted>
            {t('settings.account')}
          </Text>
          <Card style={{ padding: 0 }}>
            <ListItem icon="person-outline" title={t('settings.editProfile')} onPress={() => router.push('/me/edit-profile')} />
            {Platform.OS !== 'web' && <Divider style={{ marginLeft: 64 }} />}
            {Platform.OS !== 'web' && (
              <View style={{ paddingHorizontal: spacing.lg }}>
                <SwitchRow label={t('settings.push')} hint={t('settings.pushHint')} value={push} onChange={togglePush} />
              </View>
            )}
          </Card>
        </>
      )}

      <Text variant="label" muted>
        {t('settings.legal')}
      </Text>
      <Card style={{ padding: 0 }}>
        <ListItem icon="document-text-outline" title={t('profile.terms')} onPress={() => router.push({ pathname: '/page/[slug]', params: { slug: 'terms' } })} />
        <Divider style={{ marginLeft: 64 }} />
        <ListItem icon="shield-checkmark-outline" title={t('profile.privacy')} onPress={() => router.push({ pathname: '/page/[slug]', params: { slug: 'privacy' } })} />
        <Divider style={{ marginLeft: 64 }} />
        <ListItem icon="information-circle-outline" title={t('profile.about')} onPress={() => router.push({ pathname: '/page/[slug]', params: { slug: 'about' } })} />
      </Card>

      {isAuthed && (
        <View style={{ gap: spacing.sm }}>
          <Button
            title={t('common.logout')}
            kind="outline"
            icon="log-out-outline"
            onPress={() =>
              Alert.alert(t('common.logout'), t('settings.logoutConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.logout'), style: 'destructive', onPress: () => logout().then(() => router.dismissTo('/')) },
              ])
            }
          />
          <Card style={{ padding: 0 }}>
            <ListItem icon="trash-outline" title={t('settings.deleteAccount')} danger chevron={false} onPress={del.isPending ? undefined : confirmDelete} />
          </Card>
        </View>
      )}

      <Text variant="small" muted style={{ textAlign: 'center' }}>
        {t('settings.app')}: EvTap · {t('profile.version', { v: APP_VERSION })}
      </Text>
    </ScrollView>
  );
}
