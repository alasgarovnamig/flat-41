import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CITIES, DEFAULT_SETTINGS, PLANS, SERVICE_CATALOG, BUNDLES, type Catalog } from '@evtap/shared';
import { api } from '../api/client';
import { qk } from '../api/queryClient';

export function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Pull-to-refresh helper that only shows the spinner for user-initiated refreshes. */
export function useRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);
  return { refreshing, onRefresh };
}

/** Current prices from the API (GET /catalog), falling back to the shared defaults while loading/offline. */
export function useCatalog() {
  const q = useQuery({ queryKey: qk.catalog, queryFn: api.catalog, staleTime: 10 * 60_000 });
  const fallback: Catalog = {
    services: SERVICE_CATALOG,
    bundles: BUNDLES,
    plans: PLANS,
    settings: DEFAULT_SETTINGS,
  };
  return { ...q, catalog: q.data ?? fallback };
}

export const popularCities = CITIES.filter((c) => c.popular);

/** YYYY-MM-DD in local time. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
