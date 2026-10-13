'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { CITIES, getCity, localized, type Agency, type AgencyType, type Paginated } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Avatar, Badge, BigNumber, Card, EmptyState, ErrorState, FilterPill, LinkButton, OptionList, PageHeader, Pagination, SearchField, Segmented, Skeleton } from '@/components/ds';
import { ArrowUpRightIcon, BuildingIcon, PinIcon, VerifiedIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

export function AgencyLogo({ a, size = 56 }: { a: Pick<Agency, 'name' | 'logoUrl'>; size?: number }) {
  return <Avatar name={a.name} url={a.logoUrl} size={size} square className="bg-surface-raised shadow-pill" />;
}

function AgencyCard({ a }: { a: Agency }) {
  const { t, href, locale } = useI18n();
  return (
    <Link href={href(`/agencies/${a.slug}`)} className="press group flex flex-col gap-5 rounded-xl bg-surface p-5 shadow-card hover:shadow-raised">
      <div className="flex items-start gap-4">
        <AgencyLogo a={a} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[16px] font-medium">{a.name}</span>
            {a.verified && <VerifiedIcon size={17} className="shrink-0 text-success" aria-label={t('agency.verified')} />}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={a.type === 'DEVELOPER' ? 'info' : 'business'}>{t(`enums.agencyType.${a.type}`)}</Badge>
            {a.cityId && (
              <span className="flex items-center gap-1 text-caption text-muted">
                <PinIcon size={12} /> {localized(getCity(a.cityId)?.name, locale)}
              </span>
            )}
          </div>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-on-ink transition-transform motion-safe:group-hover:rotate-45" aria-hidden>
          <ArrowUpRightIcon size={16} />
        </span>
      </div>
      <div className="flex items-end justify-between border-t border-hairline pt-4">
        <span className="text-label font-normal text-ink-secondary">{t('agencies.activeListings')}</span>
        <BigNumber size="sm">{a.activeListings}</BigNumber>
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
      <PageHeader
        title={t('agencies.title')}
        sub={t('agencies.subtitle')}
        actions={
          <LinkButton href={href('/business')} variant="secondary" trailing={<ArrowUpRightIcon size={16} />}>
            {t('agencies.join')}
          </LinkButton>
        }
      />
      <Card pad="sm" className="mb-6 flex flex-col gap-2 sm:p-3 lg:flex-row lg:items-center">
        <Segmented ariaLabel={t('agencies.type')} value={type} onChange={(v) => { setType(v); setPage(1); }} options={[{ value: 'ALL', label: t('common.all') }, { value: 'AGENCY', label: t('agencies.agencies') }, { value: 'DEVELOPER', label: t('agencies.developers') }]} />
        <FilterPill icon={<PinIcon size={18} />} label={t('search.city')} value={cityId ? localized(getCity(cityId)?.name, locale) : undefined} active={!!cityId} width="w-72">
          {(close) => (
            <OptionList
              value={cityId}
              onSelect={(v) => {
                setCity(v);
                setPage(1);
                close();
              }}
              options={[{ value: '', label: t('search.allCities') }, ...CITIES.map((c) => ({ value: c.id, label: localized(c.name, locale) }))]}
            />
          )}
        </FilterPill>
        <SearchField className="flex-1" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('agencies.searchPlaceholder')} label={t('common.search')} />
      </Card>
      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : query.isError && !query.data ? (
        <ErrorState title={t('agencies.loadError')} text={errorMessage(query.error, t)} onRetry={() => void query.refetch()} retryLabel={t('common.retry')} />
      ) : !query.data?.items.length ? (
        <EmptyState icon={<BuildingIcon />} title={t('agencies.empty')} />
      ) : (
        <div className={cn(query.isPlaceholderData && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.items.map((a) => <AgencyCard key={a.id} a={a} />)}</div>
          <Pagination className="mt-8" page={page} total={query.data.total} pageSize={18} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />
        </div>
      )}
    </div>
  );
}
