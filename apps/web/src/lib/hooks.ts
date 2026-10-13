'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { qk } from './query-keys';
import { useAuth, useAuthGate } from '@/components/providers/AuthProvider';

/** Favorite ids of the current user + toggle with optimistic update. */
export function useFavorites() {
  const { status } = useAuth();
  const gate = useAuthGate();
  const qc = useQueryClient();
  const ids = useQuery({ queryKey: qk.favoriteIds, queryFn: api.favorites.ids, enabled: status === 'authenticated', staleTime: 60_000 });
  const set = new Set(ids.data ?? []);

  const mut = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? api.favorites.add(id) : api.favorites.remove(id)),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: qk.favoriteIds });
      const prev = qc.getQueryData<string[]>(qk.favoriteIds);
      qc.setQueryData<string[]>(qk.favoriteIds, (l = []) => (on ? [...new Set([...l, id])] : l.filter((x) => x !== id)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.favoriteIds, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const toggle = useCallback((id: string) => gate(() => mut.mutate({ id, on: !set.has(id) })), [gate, mut, set]);
  return { ids: set, count: set.size, isFavorite: (id: string) => set.has(id), toggle };
}

/** Debounce a changing value. */
export function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** media query hook (client only, false during SSR) */
export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    setM(mq.matches);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}
