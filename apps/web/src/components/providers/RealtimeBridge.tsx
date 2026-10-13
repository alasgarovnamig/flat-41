'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AppNotification, Message } from '@evtap/shared';
import { getSocket } from '@/lib/realtime';
import { qk } from '@/lib/query-keys';
import { useAuth } from './AuthProvider';
import { useToast } from './ToastProvider';

/** Global socket.io subscriptions: keep badges fresh and toast new notifications. */
export function RealtimeBridge() {
  const { status, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [, setConnected] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const s = getSocket();
    if (!s) return;
    const onMessage = (m: Message & { conversationId: string }) => {
      void qc.invalidateQueries({ queryKey: qk.unread });
      void qc.invalidateQueries({ queryKey: qk.conversations });
      if (m.senderId !== user?.id) qc.setQueryData<Message[]>(qk.messages(m.conversationId), (l) => (l && !l.some((x) => x.id === m.id) ? [...l, m] : l));
    };
    const onNotification = (n: AppNotification) => {
      toast.info(n.title);
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    const onPayment = () => {
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: qk.wallet });
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('message:new', onMessage);
    s.on('notification:new', onNotification);
    s.on('payment:updated', onPayment);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    return () => {
      s.off('message:new', onMessage);
      s.off('notification:new', onNotification);
      s.off('payment:updated', onPayment);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, [status, qc, toast, user?.id]);

  return null;
}
