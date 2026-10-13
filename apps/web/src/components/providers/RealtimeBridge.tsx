'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Message } from '@evtap/shared';
import { realtime } from '@/lib/realtime';
import { qk } from '@/lib/query-keys';
import { useAuth } from './AuthProvider';
import { useToast } from './ToastProvider';

/**
 * Global realtime subscriptions (plain WebSocket, see lib/realtime): keeps badges / threads fresh and toasts new
 * notifications. When the socket is down, screens poll instead (useRealtimeStatus).
 */
export function RealtimeBridge() {
  const { status, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const userId = useRef<string | undefined>(undefined);
  userId.current = user?.id;

  useEffect(() => {
    if (status !== 'authenticated') {
      if (status === 'anonymous') realtime.stop();
      return;
    }
    realtime.start();
    const offs = [
      realtime.on('message:new', (m) => {
        void qc.invalidateQueries({ queryKey: qk.unread });
        void qc.invalidateQueries({ queryKey: qk.conversations });
        if (m.senderId !== userId.current) qc.setQueryData<Message[]>(qk.messages(m.conversationId), (l) => (l && !l.some((x) => x.id === m.id) ? [...l, m] : l));
      }),
      realtime.on('conversation:read', (r) => {
        qc.setQueryData<Message[]>(qk.messages(r.conversationId), (l) => l?.map((m) => (m.senderId !== r.readerId && !m.readAt ? { ...m, readAt: r.readAt } : m)));
      }),
      realtime.on('notification:new', (n) => {
        toast.info(n.title);
        void qc.invalidateQueries({ queryKey: qk.me });
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      }),
      realtime.on('payment:updated', (p) => {
        void qc.invalidateQueries({ queryKey: ['payments'] });
        void qc.invalidateQueries({ queryKey: qk.payment(p.id) });
        void qc.invalidateQueries({ queryKey: qk.wallet });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [status, qc, toast]);

  return null;
}
