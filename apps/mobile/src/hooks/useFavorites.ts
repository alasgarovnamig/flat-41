import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { qk } from '../api/queryClient';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';

/** Favorite ids (GET /favorites/ids) with optimistic toggle + haptic feedback. */
export function useFavorites() {
  const { isAuthed, requireAuth } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: qk.favoriteIds, queryFn: api.favoriteIds, enabled: isAuthed, staleTime: 60_000 });
  const ids = useMemo(() => new Set(data ?? []), [data]);

  const m = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) => (add ? api.addFavorite(id) : api.removeFavorite(id)),
    onMutate: async ({ id, add }) => {
      await qc.cancelQueries({ queryKey: qk.favoriteIds });
      const prev = qc.getQueryData<string[]>(qk.favoriteIds);
      qc.setQueryData<string[]>(qk.favoriteIds, (old = []) => (add ? [...old, id] : old.filter((x) => x !== id)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(qk.favoriteIds, ctx?.prev);
      toast.error(e);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.favorites });
    },
  });

  const toggle = useCallback(
    (id: string) =>
      requireAuth(() => {
        const add = !ids.has(id);
        if (Platform.OS !== 'web') Haptics.impactAsync(add ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        m.mutate({ id, add });
      }),
    [ids, m, requireAuth],
  );

  return { ids, loaded: data !== undefined, isFavorite: (id: string) => ids.has(id), toggle };
}
