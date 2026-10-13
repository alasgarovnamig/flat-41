import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getPushPref, hrefForNotificationData, registerForPush } from './notifications';
import { qk } from '../api/queryClient';

/** Registers the push token after login and routes notification taps to the right screen. */
export function PushManager() {
  const { isAuthed } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isAuthed || Platform.OS === 'web') return;
    getPushPref().then((p) => {
      if (p.enabled) registerForPush();
    });
  }, [isAuthed]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (data: Record<string, unknown> | undefined) => {
      const href = hrefForNotificationData(data);
      if (href) router.push(href);
    };
    // Cold start from a notification tap.
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      open(last.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
    }
    const tap = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    const received = Notifications.addNotificationReceivedListener(() => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.unread });
    });
    return () => {
      tap.remove();
      received.remove();
    };
  }, [qc]);

  return null;
}
