/**
 * Push notifications (Expo push service).
 *  - register: permission → Expo push token → POST /users/me/push-tokens
 *  - unregister: DELETE /users/me/push-tokens/:token (logout / settings toggle)
 *  - taps: notification `data` → deep link (listing / conversation / booking / payment)
 *
 * Requires an EAS project id (EAS_PROJECT_ID → app.config extra.eas.projectId) and, for Android,
 * FCM credentials uploaded to EAS (`eas credentials`). iOS needs the Push Notifications capability (EAS sets it up).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { Href } from 'expo-router';
import { api } from '../api/client';
import { EAS_PROJECT_ID } from '../config';
import { storage, KEYS } from '../lib/storage';

type PushPref = { enabled: boolean; token?: string };

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

export const getPushPref = async (): Promise<PushPref> => (await storage.getJSON<PushPref>(KEYS.push)) ?? { enabled: true };

export type RegisterResult = 'ok' | 'denied' | 'unsupported' | 'error';

export async function registerForPush(opts: { ask?: boolean } = {}): Promise<RegisterResult> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'EvTap',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#0E7C66',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && opts.ask !== false) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const token = (await Notifications.getExpoPushTokenAsync(EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined)).data;
    await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    await storage.setJSON(KEYS.push, { enabled: true, token } satisfies PushPref);
    return 'ok';
  } catch (e) {
    if (__DEV__) console.warn('[push] registration failed', e);
    return 'error';
  }
}

/** Remove this device's token from the API. `disable` also remembers the user's opt-out. */
export async function unregisterPushToken(disable = false) {
  const pref = await getPushPref();
  if (pref.token) await api.deletePushToken(pref.token).catch(() => {});
  await storage.setJSON(KEYS.push, { enabled: disable ? false : pref.enabled } satisfies PushPref);
}

/**
 * Map a notification payload to an in-app route. The API's push `data` is expected to carry
 * one of: `url` (evtap:// or https://evtap.az/… link), `conversationId`, `bookingId`, `paymentId`, `listingId`.
 */
export function hrefForNotificationData(data: Record<string, unknown> | undefined | null): Href | null {
  if (!data) return null;
  const s = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);
  const url = s('url');
  if (url) {
    const path = url.replace(/^evtap:\/\//, '/').replace(/^https?:\/\/(www\.)?evtap\.az/, '');
    if (path.startsWith('/')) return path as Href;
  }
  if (s('conversationId')) return { pathname: '/chat/[id]', params: { id: s('conversationId')! } };
  if (s('paymentId')) return { pathname: '/payment/result', params: { paymentId: s('paymentId')!, status: s('status') ?? '' } };
  if (s('bookingId')) return { pathname: '/booking/[id]', params: { id: s('bookingId')! } };
  if (s('listingId')) return { pathname: '/listing/[id]', params: { id: s('listingId')! } };
  return null;
}
