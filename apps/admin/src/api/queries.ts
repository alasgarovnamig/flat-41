import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { BUNDLES, DEFAULT_SETTINGS, PLANS, SERVICE_CATALOG, type Catalog } from '@evtap/shared';
import { useToast } from '../components/Toast';
import { ApiRequestError } from './client';
import * as api from './client';

/** Overview powers the dashboard and the sidebar counters; refreshed every minute. */
export const useOverview = () =>
  useQuery({ queryKey: ['admin', 'overview'], queryFn: api.getOverview, refetchInterval: 60_000, retry: (n, e) => !(e instanceof ApiRequestError && e.status === 404) && n < 1 });

/** Public catalog (for "give free promotion"); falls back to shared defaults when the endpoint is missing. */
export const useCatalogForPromote = () =>
  useQuery({
    queryKey: ['catalog'],
    queryFn: async (): Promise<Catalog & { fallback?: boolean }> => {
      try {
        return await api.getCatalog();
      } catch {
        return { services: SERVICE_CATALOG, bundles: BUNDLES, plans: PLANS, settings: DEFAULT_SETTINGS, fallback: true };
      }
    },
    staleTime: 5 * 60_000,
  });

/**
 * Mutation with success toast + invalidation of the given query key prefixes.
 * Errors surface as toasts (the API's message, e.g. validation messages).
 */
export function useAction<TVars, TRes>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes, v: TVars) => string); invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r, v) : opts.success);
      for (const key of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(e),
  });
}
