/**
 * socket.io realtime (contract: REALTIME in @evtap/shared): `${API_URL}` path `/ws`, handshake auth `{ token }`.
 * Server events update the TanStack Query cache so screens re-render without polling.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { REALTIME, type AppNotification, type Message, type Payment } from '@evtap/shared';
import { API_URL } from '../config';
import { getTokens, refreshTokens } from '../api/tokens';
import { qk } from '../api/queryClient';
import { useAuth } from '../auth/AuthContext';

const SocketCtx = createContext<Socket | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthed, me } = useAuth();
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const meId = useRef<string | undefined>(undefined);
  meId.current = me?.id;

  useEffect(() => {
    if (!isAuthed) return;
    const s = io(API_URL, {
      path: REALTIME.path,
      transports: ['websocket'],
      // Called on every (re)connect → always uses the freshest access token.
      auth: (cb) => cb({ token: getTokens()?.accessToken }),
      reconnectionDelayMax: 10_000,
    });

    s.on('connect_error', async (err) => {
      if (/unauth|jwt|token|expired/i.test(err.message)) await refreshTokens();
    });

    s.on('message:new', (m: Message) => {
      qc.setQueryData<Message[]>(qk.messages(m.conversationId), (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
      qc.invalidateQueries({ queryKey: qk.conversations });
      if (m.senderId !== meId.current) qc.invalidateQueries({ queryKey: qk.unread });
    });

    s.on('conversation:read', (e: { conversationId: string; readerId: string; readAt: string }) => {
      qc.setQueryData<Message[]>(qk.messages(e.conversationId), (old) =>
        old?.map((m) => (m.senderId !== e.readerId && !m.readAt && m.createdAt <= e.readAt ? { ...m, readAt: e.readAt } : m)),
      );
      qc.invalidateQueries({ queryKey: qk.conversations });
    });

    s.on('notification:new', (_n: AppNotification) => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.me });
    });

    s.on('payment:updated', (p: Payment) => {
      qc.setQueryData(qk.payment(p.id), p);
      qc.invalidateQueries({ queryKey: qk.payments });
    });

    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [isAuthed, qc]);

  return <SocketCtx.Provider value={socket}>{children}</SocketCtx.Provider>;
}

export const useSocket = () => useContext(SocketCtx);

/** Subscribe to a socket event while the component is mounted. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const socket = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}
