import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCity, localized, type ListingCard, type Paginated } from '@evtap/shared';
import { SearchView } from '@/components/search/SearchView';
import { PropertyGridSkeleton } from '@/components/ds';
import { api } from '@/lib/api';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';
import { parseSearchState, stateToApi, stateToSearch } from '@/lib/search-state';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = getT(locale);
  const s = parseSearchState(await searchParams);
  const deal = s.dealType ? t(`enums.dealType.${s.dealType}`) : t('search.allListings');
  const city = s.cityId ? localized(getCity(s.cityId)?.name, locale) : '';
  const title = [deal, city].filter(Boolean).join(' — ');
  const qs = stateToSearch({ dealType: s.dealType, cityId: s.cityId, propertyType: s.propertyType });
  return {
    title,
    description: t('meta.searchDescription', { title }),
    alternates: { canonical: `/${locale}/search${qs ? `?${qs}` : ''}` },
    robots: s.page && s.page > 3 ? { index: false } : undefined,
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const state = parseSearchState(await searchParams);
  let initial: Paginated<ListingCard> | null = null;
  try {
    initial = await api.listings.search(stateToApi(state));
  } catch {
    initial = null; // the client retries and shows an error state
  }
  return (
    <Suspense fallback={<div className="container-page py-8"><PropertyGridSkeleton n={9} cols={3} /></div>}>
      <SearchView initialData={initial} initialKey={stateToSearch(state)} />
    </Suspense>
  );
}
