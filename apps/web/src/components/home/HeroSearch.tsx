'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CITIES, COUNTRIES, PROPERTY_TYPES, localized, type DealType } from '@evtap/shared';
import { stateToSearch, type SearchState } from '@/lib/search-state';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { SearchIcon } from '@/components/ui/icons';

const selectCls = 'h-12 w-full appearance-none rounded-xl border border-line bg-white px-3.5 text-[15px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15';

export function HeroSearch() {
  const { t, href, locale } = useI18n();
  const router = useRouter();
  const [deal, setDeal] = useState<DealType>('SALE');
  const [cityId, setCity] = useState('baku');
  const [type, setType] = useState('');
  const [rooms, setRooms] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s: SearchState = {
      dealType: deal,
      cityId: cityId || undefined,
      propertyType: type ? [type as never] : undefined,
      rooms: rooms ? [Number(rooms)] : undefined,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
    };
    router.push(`${href('/search')}?${stateToSearch(s)}`);
  };

  return (
    <form onSubmit={submit} className="rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-black/5 sm:p-4" role="search" aria-label={t('home.searchLabel')}>
      <div className="mb-3 flex gap-1 overflow-x-auto scrollbar-none" role="tablist">
        {(['SALE', 'RENT_LONG', 'RENT_DAILY'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={deal === d}
            onClick={() => setDeal(d)}
            className={cn('shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors', deal === d ? 'bg-brand text-white' : 'text-ink/70 hover:bg-ink/5')}
          >
            {t(`enums.dealType.${d}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_0.8fr_1.4fr_auto]">
        <select aria-label={t('search.city')} className={selectCls} value={cityId} onChange={(e) => setCity(e.target.value)}>
          <option value="">{t('search.allCities')}</option>
          {COUNTRIES.map((c) => (
            <optgroup key={c.code} label={localized(c.name, locale)}>
              {CITIES.filter((x) => x.country === c.code).map((x) => (
                <option key={x.id} value={x.id}>
                  {localized(x.name, locale)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select aria-label={t('search.propertyType')} className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('search.anyType')}</option>
          {PROPERTY_TYPES.map((p) => (
            <option key={p} value={p}>
              {t(`enums.propertyType.${p}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('search.rooms')} className={selectCls} value={rooms} onChange={(e) => setRooms(e.target.value)}>
          <option value="">{t('search.rooms')}</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 5 ? '5+' : n}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input aria-label={t('search.priceFrom')} inputMode="numeric" placeholder={t('search.priceFrom')} value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/\D/g, ''))} className={cn(selectCls, 'min-w-0')} />
          <input aria-label={t('search.priceTo')} inputMode="numeric" placeholder={t('search.priceTo')} value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/\D/g, ''))} className={cn(selectCls, 'min-w-0')} />
        </div>
        <Button type="submit" size="lg" className="h-12 sm:col-span-2 lg:col-span-1" icon={<SearchIcon size={18} />}>
          {t('common.search')}
        </Button>
      </div>
    </form>
  );
}
