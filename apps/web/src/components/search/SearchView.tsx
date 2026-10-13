'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CITIES, COUNTRIES, formatPrice, getCity, localized, type DealType, type ListingCard as Card, type MapPoint, type Paginated } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { countActiveFilters, parseSearchState, stateToApi, stateToQuery, stateToSearch, type SearchState } from '@/lib/search-state';
import { cn } from '@/lib/utils';
import { BannerSlot } from '@/components/BannerSlot';
import {
  BigNumber, Button, Card as DsCard, CardHeader, EmptyState, ErrorState, FilterPill, MapCard, OptionList, Pagination, PillTabs, PropertyCard, PropertyGrid,
  PropertyGridSkeleton, PropertyRow, SearchField, Segmented, Sheet, Spinner,
} from '@/components/ds';
import { AreaIcon, BedIcon, BuildingIcon, CloseIcon, FilterIcon, GridIcon, ListIcon, MapIcon, PinIcon, SearchIcon, WalletIcon } from '@/components/ds/icons';
import { SearchMap } from '@/components/map';
import { useI18n } from '@/components/providers/I18nProvider';
import { AreaFields, FilterPanel, PriceFields, RoomsPills, TypePills } from './FilterPanel';
import { SaveSearchButton, useSearchTitle } from './SaveSearchButton';

type View = 'grid' | 'list' | 'map';
const VIEW_KEY = 'evtap.searchView';
const SORTS = ['date_desc', 'price_asc', 'price_desc', 'area_asc', 'area_desc'] as const;

function VipBlock({ dealType, cityId }: { dealType?: DealType; cityId?: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.featured({ kind: 'vip', dealType, cityId }), queryFn: () => api.listings.featured({ kind: 'vip', dealType, cityId, limit: 8 }), retry: false, staleTime: 60_000 });
  if (!q.data?.length) return null;
  return (
    <DsCard className="mb-6" aria-labelledby="vip-title">
      <CardHeader id="vip-title" title={t('search.vipBlock')} sub={t('home.vipSub')} />
      <PropertyRow items={q.data} />
    </DsCard>
  );
}

function MapPanel({ state, activeId, onActive, className }: { state: SearchState; activeId: string | null; onActive: (id: string | null) => void; className?: string }) {
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
    <MapCard
      title={t('map.title')}
      className={className}
      overlay={
        <span className="glass pointer-events-auto inline-flex h-9 items-center gap-2 rounded-pill px-4 text-label shadow-pill" role="status">
          {q.isFetching ? <Spinner size={14} /> : <PinIcon size={14} />}
          {q.isError ? t('search.mapError') : t('search.mapCount', { count: points.length })}
          {points.length >= 500 && <span className="text-muted">· {t('search.mapZoomIn')}</span>}
        </span>
      }
    >
      <SearchMap
        center={[city.lat, city.lng]}
        zoom={city.id === 'baku' || city.id === 'tbilisi' ? 12 : 13}
        points={points}
        onBoundsChange={onBounds}
        openLabel={t('search.openListing')}
        listingHref={(id) => href(`/listings/${id}`)}
        priceLabel={(p) => formatPrice(p.price, p.currency)}
        activeId={activeId}
        onActiveChange={onActive}
      />
    </MapCard>
  );
}

/** FilterPills row (reference "District / Type / Status / Cost" filters) + sort + view + save. */
function FilterBar({ state, patch, onAll, active, view, setView }: { state: SearchState; patch: (p: Partial<SearchState>) => void; onAll: () => void; active: number; view: View; setView: (v: View) => void }) {
  const { t, locale, number } = useI18n();
  const cityName = state.cityId ? localized(getCity(state.cityId)?.name, locale) : undefined;
  const types = state.propertyType ?? [];
  const typeValue = types.length === 1 ? t(`enums.propertyType.${types[0]}`) : types.length > 1 ? String(types.length) : undefined;
  const roomsValue = state.rooms?.length ? state.rooms.map((r) => (r >= 5 ? '5+' : r)).join(', ') : undefined;
  const priceValue = state.priceMin != null || state.priceMax != null ? `${state.priceMin != null ? number(state.priceMin) : '…'}–${state.priceMax != null ? number(state.priceMax) : '…'}` : undefined;
  const areaValue = state.areaMin != null || state.areaMax != null ? `${state.areaMin ?? '…'}–${state.areaMax ?? '…'} ${t('common.sqm')}` : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="scrollbar-none -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1">
        <FilterPill icon={<PinIcon size={18} />} label={t('search.city')} value={cityName} active={!!state.cityId} width="w-72">
          {(close) => (
            <OptionList
              value={state.cityId ?? ''}
              onSelect={(v) => {
                patch({ cityId: v || undefined, districtId: undefined, metroId: undefined });
                close();
              }}
              options={[{ value: '', label: t('search.allCities') }, ...COUNTRIES.flatMap((c) => CITIES.filter((x) => x.country === c.code).map((x) => ({ value: x.id, label: localized(x.name, locale) })))]}
            />
          )}
        </FilterPill>
        <FilterPill icon={<BuildingIcon size={18} />} label={t('search.propertyType')} value={typeValue} active={types.length > 0} width="w-[22rem]">
          <TypePills state={state} onChange={patch} />
        </FilterPill>
        <FilterPill icon={<BedIcon size={18} />} label={t('search.rooms')} value={roomsValue} active={!!state.rooms?.length}>
          <RoomsPills state={state} onChange={patch} />
        </FilterPill>
        <FilterPill icon={<WalletIcon size={18} />} label={t('search.price')} value={priceValue} active={!!priceValue} width="w-[22rem]">
          <PriceFields state={state} onChange={patch} />
        </FilterPill>
        <FilterPill icon={<AreaIcon size={18} />} label={t('search.area')} value={areaValue} active={!!areaValue}>
          <AreaFields state={state} onChange={patch} />
        </FilterPill>
        <button type="button" onClick={onAll} className={cn('press inline-flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-[14px]', active > 0 ? 'bg-ink text-on-ink' : 'bg-surface-raised text-ink shadow-pill hover:bg-surface-sunken')}>
          <FilterIcon size={18} />
          {t('search.allFilters')}
          {active > 0 && <span className="tabular rounded-pill bg-on-ink px-1.5 text-[11px] font-semibold text-ink">{active}</span>}
        </button>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
        <FilterPill icon={<ListIcon size={18} />} label={t('search.sort')} labelClassName="hidden sm:inline" value={t(`enums.sort.${state.sort ?? 'date_desc'}`)} align="right" width="w-64">
          {(close) => (
            <OptionList
              value={state.sort ?? 'date_desc'}
              onSelect={(v) => {
                patch({ sort: v });
                close();
              }}
              options={SORTS.map((s) => ({ value: s, label: t(`enums.sort.${s}`) }))}
            />
          )}
        </FilterPill>
        <Segmented<View>
          ariaLabel={t('search.view')}
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: <><GridIcon size={17} /><span className="sr-only">{t('search.view_grid')}</span></> },
            { value: 'list', label: <><ListIcon size={17} /><span className="sr-only">{t('search.view_list')}</span></> },
            { value: 'map', label: <><MapIcon size={17} /><span className="sr-only">{t('search.view_map')}</span></> },
          ]}
        />
      </div>
    </div>
  );
}

export function SearchView({ initialData, initialKey }: { initialData: Paginated<Card> | null; initialKey: string }) {
  const { t, number, href } = useI18n();
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
  const [activeId, setActiveId] = useState<string | null>(null);

  const [sheet, setSheet] = useState(false);
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
  const chips = Object.entries(stateToQuery(state)).filter(([k]) => !['dealType', 'sort', 'page', 'pageSize', 'q'].includes(k));

  const list = (
    <>
      {results.isLoading ? (
        <PropertyGridSkeleton n={view === 'map' ? 4 : 8} layout={view === 'list' ? 'list' : 'grid'} cols={view === 'map' ? 2 : 4} />
      ) : results.isError && !results.data ? (
        <ErrorState title={t('search.loadError')} text={errorMessage(results.error, t)} onRetry={() => void results.refetch()} retryLabel={t('common.retry')} />
      ) : results.data && results.data.items.length === 0 ? (
        <EmptyState icon={<SearchIcon />} title={t('search.noResults')} text={t('search.noResultsHint')} action={active > 0 ? <Button onClick={reset}>{t('search.resetFilters')}</Button> : undefined} />
      ) : results.data ? (
        <div className={cn('transition-opacity', results.isPlaceholderData && 'opacity-60')} aria-busy={results.isFetching}>
          {view === 'map' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {results.data.items.map((l, i) => (
                <div key={l.id} onMouseEnter={() => setActiveId(l.id)} onFocus={() => setActiveId(l.id)}>
                  <PropertyCard l={l} priority={i < 2} className={cn('h-full', activeId === l.id && 'ring-2 ring-ink')} />
                </div>
              ))}
            </div>
          ) : (
            <PropertyGrid items={results.data.items} layout={view} cols={view === 'list' ? 3 : 4} />
          )}
          <Pagination
            className="mt-8"
            page={page}
            total={results.data.total}
            pageSize={pageSize}
            labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }}
            onChange={(p) => {
              navigate({ ...state, page: p });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <div className="container-page py-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <PillTabs
          ariaLabel={t('search.dealType')}
          value={state.dealType ?? ''}
          tabs={[
            { value: '', label: t('common.all'), href: `${href('/search')}${state.cityId ? `?cityId=${state.cityId}` : ''}` },
            ...(['SALE', 'RENT_LONG', 'RENT_DAILY'] as const).map((d) => ({ value: d, label: t(`enums.dealType.${d}`), href: `${href('/search')}?${stateToSearch({ ...state, dealType: d, checkIn: undefined, checkOut: undefined, guests: undefined, page: 1 })}` })),
          ]}
        />
        <SearchField
          className="w-full lg:max-w-md"
          value={q}
          onChange={setQ}
          onSubmit={() => patch({ q: q.trim() || undefined })}
          placeholder={t('search.keywordPlaceholder')}
          label={t('search.keyword')}
          onFilter={() => setSheet(true)}
          filterLabel={t('search.filters')}
          filterCount={active}
        />
      </div>

      <DsCard pad="sm" className="mb-5 sm:p-3">
        <FilterBar state={state} patch={patch} onAll={() => setSheet(true)} active={active} view={view} setView={changeView} />
      </DsCard>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1">{title(state)}</h1>
          <p className="mt-1 flex items-baseline gap-2 text-label font-normal text-ink-secondary" aria-live="polite">
            {results.data ? (
              <>
                <BigNumber size="sm">{number(results.data.total)}</BigNumber> {t('search.listingsWord')}
              </>
            ) : results.isLoading ? (
              t('common.loading')
            ) : null}
          </p>
        </div>
        <SaveSearchButton state={state} />
      </div>

      {chips.length > 0 && (
        <ul className="mb-5 flex flex-wrap gap-2" aria-label={t('search.activeFilters')}>
          {chips.map(([k]) => (
            <li key={k}>
              <button type="button" onClick={() => patch({ [k]: undefined } as Partial<SearchState>)} className="press inline-flex h-9 items-center gap-1.5 rounded-pill bg-ink pl-3.5 pr-2.5 text-label font-medium text-on-ink hover:bg-ink-secondary" aria-label={`${t(`search.chip.${k}`)} — ${t('common.delete')}`}>
                {t(`search.chip.${k}`)}
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={reset} className="inline-flex h-9 items-center rounded-pill px-3 text-label font-medium text-ink-secondary hover:bg-pill">
              {t('search.resetFilters')}
            </button>
          </li>
        </ul>
      )}

      <BannerSlot placement="SEARCH_TOP" className="mb-5" aspect="aspect-[16/4] sm:aspect-[16/2.5]" />

      {view === 'map' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="order-2 min-w-0 lg:order-1">{list}</div>
          <div className="order-1 lg:order-2">
            <MapPanel state={state} activeId={activeId} onActive={setActiveId} className="h-[62dvh] min-h-[420px] lg:sticky lg:top-24 lg:h-[calc(100dvh-8rem)]" />
          </div>
        </div>
      ) : (
        <>
          {page === 1 && <VipBlock dealType={state.dealType as DealType | undefined} cityId={state.cityId} />}
          {list}
        </>
      )}

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={t('search.filters')}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDraft({ dealType: state.dealType })}>
              {t('search.resetFilters')}
            </Button>
            <Button
              className="flex-[2]"
              onClick={() => {
                navigate({ ...draft, page: 1 });
                setSheet(false);
              }}
            >
              {t('search.showResults')}
            </Button>
          </div>
        }
      >
        <FilterPanel state={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} showDealType />
      </Sheet>
    </div>
  );
}
