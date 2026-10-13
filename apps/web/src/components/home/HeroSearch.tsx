'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CITIES, COUNTRIES, PROPERTY_TYPES, localized, type DealType } from '@evtap/shared';
import { stateToSearch, type SearchState } from '@/lib/search-state';
import { Button, Segmented, Select } from '@/components/ds';
import { SearchIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';

const pillInput = 'h-12 w-full min-w-0 rounded-pill border border-hairline bg-surface-raised px-4 text-[14px] text-ink outline-none transition-[border-color,box-shadow] hover:border-subtle focus:border-ink focus:ring-2 focus:ring-ink/20';

/** Glass search card on the hero: deal type segmented + city / type / rooms / price + black search pill. */
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
    <form onSubmit={submit} className="glass rounded-xl p-3 shadow-raised sm:p-4" role="search" aria-label={t('home.searchLabel')}>
      <Segmented
        block
        ariaLabel={t('search.dealType')}
        value={deal}
        onChange={setDeal}
        options={(['SALE', 'RENT_LONG', 'RENT_DAILY'] as const).map((d) => ({ value: d, label: t(`enums.dealType.${d}`) }))}
        className="mb-3 sm:inline-flex sm:w-auto"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select aria-label={t('search.city')} pill wrapperClass="col-span-2 sm:col-span-1" className="h-12 text-[14px]" value={cityId} onChange={(e) => setCity(e.target.value)}>
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
        </Select>
        <Select aria-label={t('search.propertyType')} pill className="h-12 text-[14px]" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('search.anyType')}</option>
          {PROPERTY_TYPES.map((p) => (
            <option key={p} value={p}>
              {t(`enums.propertyType.${p}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('search.rooms')} pill className="h-12 text-[14px]" value={rooms} onChange={(e) => setRooms(e.target.value)}>
          <option value="">{t('search.rooms')}</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 5 ? '5+' : n}
            </option>
          ))}
        </Select>
        <input aria-label={t('search.priceFrom')} inputMode="numeric" placeholder={`${t('search.priceFrom')}, ₼`} value={priceMin} onChange={(e) => setPriceMin(e.target.value.replace(/\D/g, ''))} className={pillInput} />
        <input aria-label={t('search.priceTo')} inputMode="numeric" placeholder={`${t('search.priceTo')}, ₼`} value={priceMax} onChange={(e) => setPriceMax(e.target.value.replace(/\D/g, ''))} className={pillInput} />
        <Button type="submit" size="lg" className="col-span-2 h-12 sm:col-span-1" icon={<SearchIcon size={18} />}>
          {t('common.search')}
        </Button>
      </div>
    </form>
  );
}
