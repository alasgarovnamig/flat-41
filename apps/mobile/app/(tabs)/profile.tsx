import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, formatPhone } from '@evtap/shared';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { APP_VERSION } from '@/config';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Avatar, Badge, Button, Card, Divider, ListItem, Text } from '@/components/ui';
import { useRefresh } from '@/hooks/common';
import { useQueryClient } from '@tanstack/react-query';

export default function Profile() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { me, isAuthed, logout, refetchMe } = useAuth();
  const qc = useQueryClient();
  const { refreshing, onRefresh } = useRefresh(() => qc.invalidateQueries());
  const go = (href: Href) => () => router.push(href);

  const info = (
    <Card style={{ padding: 0 }}>
      <ListItem icon="information-circle-outline" title={t('profile.about')} onPress={go({ pathname: '/page/[slug]', params: { slug: 'about' } })} />
      <Divider style={{ marginLeft: 64 }} />
      <ListItem icon="document-text-outline" title={t('profile.terms')} onPress={go({ pathname: '/page/[slug]', params: { slug: 'terms' } })} />
      <Divider style={{ marginLeft: 64 }} />
      <ListItem icon="shield-checkmark-outline" title={t('profile.privacy')} onPress={go({ pathname: '/page/[slug]', params: { slug: 'privacy' } })} />
      <Divider style={{ marginLeft: 64 }} />
      <ListItem icon="help-buoy-outline" title={t('profile.help')} onPress={go({ pathname: '/page/[slug]', params: { slug: 'help' } })} />
    </Card>
  );

  if (!isAuthed) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <Text variant="h1">{t('tabs.profile')}</Text>
          <Card style={{ alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.guestIcon, { backgroundColor: c.primarySoft }]}>
              <Ionicons name="person-outline" size={34} color={c.primary} />
            </View>
            <Text variant="h3">{t('profile.guestTitle')}</Text>
            <Text muted style={{ textAlign: 'center' }}>
              {t('profile.guestText')}
            </Text>
            <Button title={t('common.login')} icon="log-in-outline" onPress={go('/auth/login')} />
          </Card>
          <Card style={{ padding: 0 }}>
            <ListItem icon="settings-outline" title={t('profile.settings')} onPress={go('/me/settings')} />
          </Card>
          {info}
          <Text variant="small" muted style={{ textAlign: 'center' }}>
            EvTap · {t('profile.version', { v: APP_VERSION })}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const quota = me?.quota;
  const isBusiness = me?.accountType === 'BUSINESS';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              refetchMe();
              return onRefresh();
            }}
            tintColor={c.primary}
          />
        }
      >
        {/* Header */}
        <Pressable onPress={go('/me/edit-profile')} accessibilityRole="button" style={styles.header}>
          <Avatar uri={me?.avatarUrl} name={me?.name} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text variant="h2" numberOfLines={1} style={{ flexShrink: 1 }}>
                {me?.name ?? '…'}
              </Text>
              {isBusiness && <Badge label={t('badge.business')} color={c.primary} icon="briefcase" />}
            </View>
            <Text muted>{me?.phone ? formatPhone(me.phone) : me?.email}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.muted} />
        </Pressable>

        {/* Wallet card */}
        <Pressable onPress={go('/me/wallet')} accessibilityRole="button" style={[styles.wallet, { backgroundColor: brand.primary }]}>
          <View style={{ flex: 1 }}>
            <Text color="#D1FAE5" variant="small">
              {t('profile.balance')}
            </Text>
            <Text color="#fff" variant="h1">
              {formatMoney(me?.wallet.balance ?? 0, me?.wallet.currency)}
            </Text>
            {!!me?.wallet.bonusBalance && (
              <Text color="#FDE68A" variant="small">
                {t('profile.bonus', { amount: formatMoney(me.wallet.bonusBalance, me.wallet.currency) })}
              </Text>
            )}
          </View>
          <View style={styles.topup}>
            <Ionicons name="add" size={18} color={brand.primary} />
            <Text color={brand.primary} style={{ fontWeight: '700' }}>
              {t('wallet.topup')}
            </Text>
          </View>
        </Pressable>

        {quota && quota.remaining !== -1 && (
          <Text variant="small" muted>
            {t('profile.quota', { left: quota.remaining, total: quota.freeLimit })}
          </Text>
        )}

        <Card style={{ padding: 0 }}>
          <ListItem icon="albums-outline" title={t('profile.myListings')} onPress={go('/me/listings')} />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem icon="calendar-outline" title={t('profile.bookings')} onPress={go('/me/bookings')} />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem icon="today-outline" title={t('profile.hostCalendar')} onPress={go('/me/calendar')} />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem icon="notifications-outline" title={t('profile.notifications')} badge={me?.unreadNotifications} onPress={go('/me/notifications')} />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem icon="bookmark-outline" title={t('profile.savedSearches')} onPress={go('/me/saved-searches')} />
        </Card>

        <Text variant="label" muted>
          {t('profile.sectionMoney')}
        </Text>
        <Card style={{ padding: 0 }}>
          <ListItem icon="wallet-outline" title={t('profile.wallet')} onPress={go('/me/wallet')} />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem icon="receipt-outline" title={t('profile.payments')} onPress={go('/me/payments')} />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem
            icon="briefcase-outline"
            title={t('profile.business')}
            subtitle={me?.subscription ? `${me.subscription.planCode} · ${me.subscription.period === 'YEAR' ? t('business.yearly') : t('business.monthly')}` : t('business.subtitle')}
            onPress={go('/me/business')}
          />
          <Divider style={{ marginLeft: 64 }} />
          <ListItem icon="business-outline" title={t('profile.agency')} onPress={go('/me/agency')} />
        </Card>

        <Text variant="label" muted>
          {t('profile.sectionInfo')}
        </Text>
        <Card style={{ padding: 0 }}>
          <ListItem icon="settings-outline" title={t('profile.settings')} onPress={go('/me/settings')} />
        </Card>
        {info}

        <Button
          title={t('common.logout')}
          kind="outline"
          icon="log-out-outline"
          onPress={() =>
            Alert.alert(t('common.logout'), t('settings.logoutConfirm'), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.logout'), style: 'destructive', onPress: () => logout() },
            ])
          }
        />
        <Text variant="small" muted style={{ textAlign: 'center' }}>
          EvTap · {t('profile.version', { v: APP_VERSION })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64 },
  guestIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  wallet: { borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', alignItems: 'center' },
  topup: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 40 },
});
