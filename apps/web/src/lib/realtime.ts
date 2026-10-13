'use client';

import { io, type Socket } from 'socket.io-client';
import { REALTIME } from '@evtap/shared';
import { API_URL } from './config';
import { tokenStore } from './tokens';

let socket: Socket | null = null;
let socketToken: string | null = null;

/** Lazily connect a singleton socket.io client (path /ws, auth.token). Returns null when logged out. */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  const token = tokenStore.access;
  if (!token) {
    disconnectSocket();
    return null;
  }
  if (socket && socketToken === token) return socket;
  disconnectSocket();
  socketToken = token;
  socket = io(API_URL, {
    path: REALTIME.path,
    auth: (cb) => cb({ token: tokenStore.access }),
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelayMax: 30_000,
    timeout: 8000,
  });
  return socket;
}

export function disconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

tokenStore.subscribe((has) => {
  if (!has) disconnectSocket();
});
