'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { CITIES, getCity, localized, type Agency, type AgencyType, type Paginated } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { cn, initials } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input, Segmented, Select } from '@/components/ui/form';
import { BuildingIcon, PinIcon, SearchIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { Pagination } from '@/components/ui/Pagination';

export function AgencyLogo({ a, size = 56 }: { a: Pick<Agency, 'name' | 'logoUrl'>; size?: number }) {
  const src = assetUrl(a.logoUrl);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="shrink-0 rounded-xl border border-line bg-white object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white" style={{ width: size, height: size }}>
      {initials(a.name)}
    </span>
  );
}

function AgencyCard({ a }: { a: Agency }) {
  const { t, href, locale } = useI18n();
  return (
    <Link href={href(`/agencies/${a.slug}`)} className="card flex gap-4 p-4 transition hover:shadow-card-hover">
      <AgencyLogo a={a} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{a.name}</span>
          {a.verified && <ShieldCheckIcon size={16} className="shrink-0 text-brand" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone={a.type === 'DEVELOPER' ? 'blue' : 'brand'}>{t(`enums.agencyType.${a.type}`)}</Badge>
          {a.cityId && (
            <span className="flex items-center gap-0.5">
              <PinIcon size={12} /> {localized(getCity(a.cityId)?.name, locale)}
            </span>
          )}
        </div>
        <div className="mt-2 text-sm font-medium text-brand">{t('agencies.listingsN', { n: a.activeListings })}</div>
      </div>
    </Link>
  );
}

export function AgenciesView({ initial }: { initial: Paginated<Agency> | null }) {
  const { t, href, locale } = useI18n();
  const [type, setType] = useState<'ALL' | AgencyType>('ALL');
  const [cityId, setCity] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 400);
  const params = { type: type === 'ALL' ? undefined : type, cityId: cityId || undefined, q: dq.trim() || undefined, page, pageSize: 18 };
  const isDefault = !params.type && !params.cityId && !params.q && page === 1;
  const query = useQuery({ queryKey: qk.agencies(params), queryFn: () => api.agencies.list(params), initialData: isDefault && initial ? initial : undefined, placeholderData: keepPreviousData });
  return (
    <div className="container-page py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{t('agencies.title')}</h1>
          <p className="text-muted">{t('agencies.subtitle')}</p>
        </div>
        <LinkButton href={href('/business')} variant="secondary">{t('agencies.join')}</LinkButton>
      </div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented value={type} onChange={(v) => { setType(v); setPage(1); }} options={[{ value: 'ALL', label: t('common.all') }, { value: 'AGENCY', label: t('agencies.agencies') }, { value: 'DEVELOPER', label: t('agencies.developers') }]} />
        <Select aria-label={t('search.city')} wrapperClass="lg:w-56" value={cityId} onChange={(e) => { setCity(e.target.value); setPage(1); }}>
          <option value="">{t('search.allCities')}</option>
          {CITIES.map((c) => <option key={c.id} value={c.id}>{localized(c.name, locale)}</option>)}
        </Select>
        <div className="relative flex-1">
          <Input aria-label={t('common.search')} placeholder={t('agencies.searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-10" />
          <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        </div>
      </div>
      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : query.isError && !query.data ? (
        <ErrorState title={t('agencies.loadError')} text={errorMessage(query.error, t)} onRetry={() => void query.refetch()} retryLabel={t('common.retry')} />
      ) : !query.data?.items.length ? (
        <EmptyState icon={<BuildingIcon />} title={t('agencies.empty')} />
      ) : (
        <div className={cn(query.isPlaceholderData && 'opacity-60')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{query.data.items.map((a) => <AgencyCard key={a.id} a={a} />)}</div>
          <Pagination className="mt-8" page={page} total={query.data.total} pageSize={18} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
