import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { ApiRequestError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // Never retry client errors (4xx); retry network/5xx twice.
      retry: (count, err) => !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

// React Native has no window focus → refetch stale queries when the app returns to the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
}
onlineManager.setOnline(true);

/** Query keys, centralised so invalidations stay consistent. */
export const qk = {
  me: ['me'] as const,
  catalog: ['catalog'] as const,
  banners: (placement: string) => ['banners', placement] as const,
  featured: (kind: string, extra?: object) => ['featured', kind, extra ?? {}] as const,
  listings: (q: object) => ['listings', q] as const,
  map: (q: object) => ['map', q] as const,
  listing: (id: string) => ['listing', id] as const,
  similar: (id: string) => ['similar', id] as const,
  reviews: (id: string) => ['reviews', id] as const,
  availability: (id: string) => ['availability', id] as const,
  stats: (id: string) => ['listingStats', id] as const,
  myListings: (status?: string) => ['myListings', status ?? 'all'] as const,
  favorites: ['favorites'] as const,
  favoriteIds: ['favoriteIds'] as const,
  savedSearches: ['savedSearches'] as const,
  conversations: ['conversations'] as const,
  unread: ['unread'] as const,
  messages: (id: string) => ['messages', id] as const,
  bookings: (role: string) => ['bookings', role] as const,
  booking: (id: string) => ['booking', id] as const,
  payments: ['payments'] as const,
  payment: (id: string) => ['payment', id] as const,
  wallet: ['wallet'] as const,
  walletTx: ['walletTx'] as const,
  subscription: ['subscription'] as const,
  myAgency: ['myAgency'] as const,
  notifications: ['notifications'] as const,
  page: (slug: string, locale: string) => ['page', slug, locale] as const,
  mortgageBanks: ['mortgageBanks'] as const,
  quote: (q: object) => ['quote', q] as const,
};
