import { useEffect } from 'react';
import { Platform } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import { AppThemeProvider, useTheme } from '@/theme';
import { I18nProvider, useI18n } from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { RealtimeProvider } from '@/realtime/socket';
import { PushManager } from '@/push/PushManager';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <I18nProvider>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <AuthProvider>
                <RealtimeProvider>
                  <PushManager />
                  <RootNavigator />
                </RealtimeProvider>
              </AuthProvider>
            </ToastProvider>
          </QueryClientProvider>
        </I18nProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { c, dark } = useTheme();
  const { t } = useI18n();
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  useEffect(() => {
    if (Platform.OS !== 'web') SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  const navTheme = dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, primary: c.primary, background: c.bg, card: c.bg, text: c.text, border: c.border } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: c.primary, background: c.bg, card: c.bg, text: c.text, border: c.border } };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTintColor: c.text,
          headerStyle: { backgroundColor: c.bg },
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="listing/[id]" options={{ headerTransparent: true, title: '' }} />
        <Stack.Screen name="listing/gallery" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="listing/book" options={{ title: t('booking.title') }} />
        <Stack.Screen name="listing/reviews" options={{ title: t('listing.reviews') }} />
        <Stack.Screen name="auth/login" options={{ presentation: 'modal', title: '' }} />
        <Stack.Screen name="auth/verify" options={{ title: '' }} />
        <Stack.Screen name="auth/email" options={{ title: '' }} />
        <Stack.Screen name="post/index" options={{ title: t('post.title'), gestureEnabled: false }} />
        <Stack.Screen name="post/fee" options={{ title: t('post.feeTitle') }} />
        <Stack.Screen name="promote/[id]" options={{ title: t('promote.title') }} />
        <Stack.Screen name="payment/result" options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: '' }} />
        <Stack.Screen name="chat/new" options={{ title: t('chat.newTitle'), presentation: 'modal' }} />
        <Stack.Screen name="booking/[id]" options={{ title: t('bookings.detail') }} />
        <Stack.Screen name="me/listings" options={{ title: t('myListings.title') }} />
        <Stack.Screen name="me/listing-stats" options={{ title: t('myListings.stats') }} />
        <Stack.Screen name="me/wallet" options={{ title: t('wallet.title') }} />
        <Stack.Screen name="me/payments" options={{ title: t('payments.title') }} />
        <Stack.Screen name="me/bookings" options={{ title: t('bookings.title') }} />
        <Stack.Screen name="me/calendar" options={{ title: t('calendar.title') }} />
        <Stack.Screen name="me/notifications" options={{ title: t('notifications.title') }} />
        <Stack.Screen name="me/saved-searches" options={{ title: t('saved.title') }} />
        <Stack.Screen name="me/business" options={{ title: t('business.title') }} />
        <Stack.Screen name="me/agency" options={{ title: t('agency.title') }} />
        <Stack.Screen name="me/settings" options={{ title: t('settings.title') }} />
        <Stack.Screen name="me/edit-profile" options={{ title: t('settings.editProfile') }} />
        <Stack.Screen name="page/[slug]" options={{ title: '' }} />
      </Stack>
    </ThemeProvider>
  );
}
