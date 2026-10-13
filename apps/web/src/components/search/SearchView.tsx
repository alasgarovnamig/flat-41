'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPrice, getCity, type DealType, type ListingCard as Card, type MapPoint, type Paginated } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { countActiveFilters, parseSearchState, stateToApi, stateToQuery, stateToSearch, type SearchState } from '@/lib/search-state';
import { cn } from '@/lib/utils';
import { BannerSlot } from '@/components/BannerSlot';
import { ListingCard, ListingGrid, ListingGridSkeleton } from '@/components/listings/ListingCard';
import { SearchMap } from '@/components/map';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { CloseIcon, CrownIcon, FilterIcon, GridIcon, ListIcon, MapIcon, SearchIcon } from '@/components/ui/icons';
import { Drawer } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { FilterPanel } from './FilterPanel';
import { SaveSearchButton, useSearchTitle } from './SaveSearchButton';

type View = 'grid' | 'list' | 'map';
const VIEW_KEY = 'evtap.searchView';

function VipBlock({ dealType, cityId }: { dealType?: DealType; cityId?: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.featured({ kind: 'vip', dealType, cityId }), queryFn: () => api.listings.featured({ kind: 'vip', dealType, cityId, limit: 8 }), retry: false, staleTime: 60_000 });
  if (!q.data?.length) return null;
  return (
    <section className="mb-6 rounded-2xl border border-vip/30 bg-gradient-to-b from-vip-50 to-white p-3 sm:p-4" aria-labelledby="vip-title">
      <h2 id="vip-title" className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-700">
        <CrownIcon size={16} /> {t('search.vipBlock')}
      </h2>
      <div className="scrollbar-none -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
        {q.data.map((l) => (
          <div key={l.id} className="w-64 shrink-0 snap-start sm:w-72">
            <ListingCard l={l} />
          </div>
        ))}
      </div>
    </section>
  );
}

function MapPanel({ state }: { state: SearchState }) {
  const { t, href } = useI18n();
  const city = getCity(state.cityId ?? 'baku') ?? getCity('baku')!;
  const [bbox, setBbox] = useState<string | null>(null);
  const debounced = useDebounced(bbox, 350);
  const base = useMemo(() => {
    const { page: _p, pageSize: _ps, sort: _s, ...rest } = stateToApi(state) as Record<string, unknown>;
    void _p; void _ps; void _s;
    return rest;
  }, [state]);
  const q = useQuery({
    queryKey: qk.map({ ...base, bbox: debounced }),
    queryFn: () => api.listings.map({ ...(base as object), bbox: debounced! }),
    enabled: !!debounced,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const points: MapPoint[] = q.data ?? [];
  const onBounds = useCallback((b: string) => setBbox(b), []);
  return (
    <div className="relative h-[calc(100dvh-14rem)] min-h-[420px] overflow-hidden rounded-card border border-line">
      <SearchMap
        center={[city.lat, city.lng]}
        zoom={city.id === 'baku' || city.id === 'tbilisi' ? 12 : 13}
        points={points}
        onBoundsChange={onBounds}
        openLabel={t('search.openListing')}
        listingHref={(id) => href(`/listings/${id}`)}
        priceLabel={(p) => formatPrice(p.price, p.currency)}
      />
      <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-md">
          {q.isFetching ? <Spinner size={14} className="text-brand" /> : null}
          {q.isError ? t('search.mapError') : t('search.mapCount', { count: points.length })}
          {points.length >= 500 && <span className="text-muted">· {t('search.mapZoomIn')}</span>}
        </div>
      </div>
    </div>
  );
}

export function SearchView({ initialData, initialKey }: { initialData: Paginated<Card> | null; initialKey: string }) {
  const { t, number } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spString = sp.toString();
  const state = useMemo(() => parseSearchState(new URLSearchParams(spString)), [spString]);
  const apiQuery = useMemo(() => stateToApi(state), [state]);
  const key = stateToSearch(state);
  const title = useSearchTitle();

  const [view, setView] = useState<View>('grid');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY) as View | null;
      if (v === 'grid' || v === 'list' || v === 'map') setView(v);
    } catch {
      /* ignore */
    }
  }, []);
  const changeView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState<SearchState>(state);
  useEffect(() => setDraft(state), [state]);
  const [q, setQ] = useState(state.q ?? '');
  useEffect(() => setQ(state.q ?? ''), [state.q]);

  const navigate = useCallback(
    (next: SearchState) => {
      const s = stateToSearch(next);
      router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
    },
    [router, pathname],
  );
  const patch = useCallback((p: Partial<SearchState>) => navigate({ ...state, ...p, page: 1 }), [navigate, state]);

  const results = useQuery({
    queryKey: qk.search(apiQuery),
    queryFn: () => api.listings.search(apiQuery),
    initialData: key === initialKey && initialData ? initialData : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const active = countActiveFilters(state);
  const page = state.page ?? 1;
  const pageSize = state.pageSize ?? 24;
  const reset = () => navigate({ dealType: state.dealType });

  return (
    <div className="container-page py-6">
      {/* deal type tabs + keyword */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-card">
          {(['SALE', 'RENT_LONG', 'RENT_DAILY'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => patch({ dealType: d, checkIn: undefined, checkOut: undefined, guests: undefined })}
              className={cn('shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors', state.dealType === d ? 'bg-brand text-white' : 'text-ink/70 hover:bg-ink/5')}
            >
              {t(`enums.dealType.${d}`)}
            </button>
          ))}
        </div>
        <form
          className="relative flex-1"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            patch({ q: q.trim() || undefined });
          }}
        >
          <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.keywordPlaceholder')}
            aria-label={t('search.keyword')}
            className="h-12 w-full rounded-xl border border-line bg-white pl-10 pr-28 text-[15px] shadow-card focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
          />
          <Button type="submit" size="sm" className="absolute right-2 top-1/2 -translate-y-1/2">
            {t('common.search')}
          </Button>
        </form>
      </div>

      <BannerSlot placement="SEARCH_TOP" className="mb-5" aspect="aspect-[16/4] sm:aspect-[16/2.5]" />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* desktop filters */}
        <aside className="hidden lg:block" aria-label={t('search.filters')}>
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-card border border-line bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t('search.filters')}</h2>
              {active > 0 && (
                <button type="button" onClick={reset} className="text-sm font-semibold text-brand hover:underline">
                  {t('search.resetFilters')}
                </button>
              )}
            </div>
            <FilterPanel state={state} onChange={patch} />
          </div>
          <BannerSlot placement="SEARCH_SIDEBAR" className="mt-4" aspect="aspect-[3/4]" />
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="mr-auto min-w-0">
              <h1 className="truncate text-xl font-bold sm:text-2xl">{title(state)}</h1>
              <p className="text-sm text-muted" aria-live="polite">
                {results.data ? t('search.resultsCount', { count: number(results.data.total) }) : results.isLoading ? t('common.loading') : ' '}
              </p>
            </div>
            <Button variant="outline" className="lg:hidden" icon={<FilterIcon size={18} />} onClick={() => setDrawer(true)}>
              {t('search.filters')}
              {active > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{active}</span>}
            </Button>
            <Select aria-label={t('search.sort')} wrapperClass="w-44" value={state.sort ?? 'date_desc'} onChange={(e) => navigate({ ...state, sort: e.target.value as SearchState['sort'], page: 1 })}>
              {(['date_desc', 'price_asc', 'price_desc', 'area_asc', 'area_desc'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`enums.sort.${s}`)}
                </option>
              ))}
            </Select>
            <div className="flex rounded-xl border border-line bg-white p-0.5" role="group" aria-label={t('search.view')}>
              {(
                [
                  ['grid', <GridIcon key="g" size={18} />],
                  ['list', <ListIcon key="l" size={18} />],
                  ['map', <MapIcon key="m" size={18} />],
                ] as const
              ).map(([v, icon]) => (
                <button key={v} type="button" aria-pressed={view === v} aria-label={t(`search.view_${v}`)} title={t(`search.view_${v}`)} onClick={() => changeView(v)} className={cn('flex h-9 w-9 items-center justify-center rounded-lg', view === v ? 'bg-brand text-white' : 'text-muted hover:text-ink')}>
                  {icon}
                </button>
              ))}
            </div>
            <SaveSearchButton state={state} />
          </div>

          {/* active filter chips */}
          {active > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {Object.entries(stateToQuery(state))
                .filter(([k]) => !['dealType', 'sort', 'page', 'pageSize', 'q'].includes(k))
                .map(([k]) => (
                  <button key={k} type="button" onClick={() => patch({ [k]: undefined } as Partial<SearchState>)} className="flex items-center gap-1 rounded-full border border-brand/30 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-dark hover:bg-brand-100">
                    {t(`search.chip.${k}`)}
                    <CloseIcon size={12} />
                  </button>
                ))}
            </div>
          )}

          {view === 'map' ? (
            <MapPanel state={state} />
          ) : (
            <>
              {page === 1 && <VipBlock dealType={state.dealType as DealType | undefined} cityId={state.cityId} />}
              {results.isLoading ? (
                <ListingGridSkeleton n={9} layout={view} cols={3} />
              ) : results.isError && !results.data ? (
                <ErrorState title={t('search.loadError')} text={errorMessage(results.error, t)} onRetry={() => void results.refetch()} retryLabel={t('common.retry')} />
              ) : results.data && results.data.items.length === 0 ? (
                <EmptyState
                  icon={<SearchIcon />}
                  title={t('search.noResults')}
                  text={t('search.noResultsHint')}
                  action={
                    active > 0 ? (
                      <Button variant="outline" onClick={reset}>
                        {t('search.resetFilters')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : results.data ? (
                <div className={cn('transition-opacity', results.isPlaceholderData && 'opacity-60')}>
                  <ListingGrid items={results.data.items} layout={view} cols={3} />
                  <Pagination
                    className="mt-8"
                    page={page}
                    total={results.data.total}
                    pageSize={pageSize}
                    onChange={(p) => {
                      navigate({ ...state, page: p });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title={t('search.filters')}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDraft({ dealType: state.dealType })}>
              {t('search.resetFilters')}
            </Button>
            <Button
              className="flex-[2]"
              onClick={() => {
                navigate({ ...draft, page: 1 });
                setDrawer(false);
              }}
            >
              {t('search.showResults')}
            </Button>
          </div>
        }
      >
        <FilterPanel state={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} showDealType />
      </Drawer>
    </div>
  );
}
