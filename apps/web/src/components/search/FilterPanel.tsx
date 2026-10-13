'use client';

import { useEffect, useState } from 'react';
import {
  AMENITIES, CITIES, COUNTRIES, CURRENCIES, PROPERTY_TYPES, REPAIR_TYPES, districtsOf, localized, metrosOf,
  type Amenity, type Currency, type DealType, type RepairType,
} from '@evtap/shared';
import type { SearchState } from '@/lib/search-state';
import { todayIso } from '@/lib/utils';
import { Checkbox, ChoicePills, Input, MultiSelect, Segmented, Select } from '@/components/ds';
import { useI18n } from '@/components/providers/I18nProvider';

/** Metro line colours are information (line identity) → shown with the line name in the option label too. */
const METRO_DOT: Record<string, string> = { red: 'bg-danger', green: 'bg-success', purple: 'bg-info' };

/** Number input that commits its value after the user stops typing. */
export function NumInput({ value, onCommit, placeholder, suffix, label }: { value?: number; onCommit: (v?: number) => void; placeholder: string; suffix?: string; label?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => setText(value == null ? '' : String(value)), [value]);
  useEffect(() => {
    const id = setTimeout(() => {
      const n = text === '' ? undefined : Number(text);
      if (n !== value && (n === undefined || !Number.isNaN(n))) onCommit(n);
    }, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <Input aria-label={label ?? placeholder} inputMode="numeric" placeholder={placeholder} value={text} suffix={suffix} onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ''))} wrapperClass="flex-1 min-w-0" />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-hairline py-5 first:pt-0 last:border-0">
      <legend className="float-left mb-3 w-full text-label text-ink-secondary">{title}</legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

export function PriceFields({ state, onChange }: { state: SearchState; onChange: (patch: Partial<SearchState>) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <NumInput label={t('search.priceFrom')} placeholder={t('common.min')} value={state.priceMin} onCommit={(v) => onChange({ priceMin: v })} />
      <span className="text-muted" aria-hidden>–</span>
      <NumInput label={t('search.priceTo')} placeholder={t('common.max')} value={state.priceMax} onCommit={(v) => onChange({ priceMax: v })} />
      <Select aria-label={t('search.currency')} wrapperClass="w-24 shrink-0" value={state.currency ?? 'AZN'} onChange={(e) => onChange({ currency: e.target.value === 'AZN' ? undefined : (e.target.value as Currency) })}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function AreaFields({ state, onChange }: { state: SearchState; onChange: (patch: Partial<SearchState>) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <NumInput label={t('search.chip.areaMin')} placeholder={t('common.min')} suffix={t('common.sqm')} value={state.areaMin} onCommit={(v) => onChange({ areaMin: v })} />
      <span className="text-muted" aria-hidden>–</span>
      <NumInput label={t('search.chip.areaMax')} placeholder={t('common.max')} suffix={t('common.sqm')} value={state.areaMax} onCommit={(v) => onChange({ areaMax: v })} />
    </div>
  );
}

export function RoomsPills({ state, onChange }: { state: SearchState; onChange: (patch: Partial<SearchState>) => void }) {
  const { t } = useI18n();
  return (
    <ChoicePills
      multiple
      ariaLabel={t('search.rooms')}
      value={state.rooms ?? []}
      onChange={(v) => onChange({ rooms: (v as number[]).length ? [...(v as number[])].sort() : undefined })}
      options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: n === 5 ? '5+' : String(n) }))}
    />
  );
}

export function TypePills({ state, onChange, size = 'sm' }: { state: SearchState; onChange: (patch: Partial<SearchState>) => void; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  return (
    <ChoicePills
      size={size}
      multiple
      ariaLabel={t('search.propertyType')}
      value={state.propertyType ?? []}
      onChange={(v) => onChange({ propertyType: (v as string[]).length ? (v as string[]) : undefined } as Partial<SearchState>)}
      options={PROPERTY_TYPES.map((p) => ({ value: p as string, label: t(`enums.propertyType.${p}`) }))}
    />
  );
}

/** The complete filter set (used in the "All filters" sheet). */
export function FilterPanel({ state, onChange, showDealType }: { state: SearchState; onChange: (patch: Partial<SearchState>) => void; showDealType?: boolean }) {
  const { t, locale } = useI18n();
  const districts = state.cityId ? districtsOf(state.cityId) : [];
  const metros = state.cityId ? metrosOf(state.cityId) : [];
  const daily = state.dealType === 'RENT_DAILY';
  const types = state.propertyType ?? [];
  const showBuilding = types.length === 0 || types.includes('APARTMENT');

  return (
    <div className="text-[14px]">
      {showDealType && (
        <Section title={t('search.dealType')}>
          <Segmented block ariaLabel={t('search.dealType')} value={(state.dealType ?? 'SALE') as DealType} onChange={(v) => onChange({ dealType: v, checkIn: undefined, checkOut: undefined, guests: undefined })} options={(['SALE', 'RENT_LONG', 'RENT_DAILY'] as const).map((d) => ({ value: d, label: t(`enums.dealType.${d}`) }))} />
        </Section>
      )}

      <Section title={t('search.propertyType')}>
        <TypePills state={state} onChange={onChange} />
        {showBuilding && (
          <Segmented
            block
            size="sm"
            className="mt-3"
            ariaLabel={t('search.chip.buildingType')}
            value={state.buildingType ?? 'ANY'}
            onChange={(v) => onChange({ buildingType: v === 'ANY' ? undefined : (v as 'NEW' | 'SECONDARY') })}
            options={[
              { value: 'ANY', label: t('common.any') },
              { value: 'NEW', label: t('enums.buildingType.NEW') },
              { value: 'SECONDARY', label: t('enums.buildingType.SECONDARY') },
            ]}
          />
        )}
      </Section>

      <Section title={t('search.location')}>
        <div className="flex flex-col gap-3">
          <Select aria-label={t('search.city')} value={state.cityId ?? ''} onChange={(e) => onChange({ cityId: e.target.value || undefined, districtId: undefined, metroId: undefined })}>
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
          {districts.length > 0 && (
            <MultiSelect placeholder={t('search.district')} options={districts.map((d) => ({ value: d.id, label: localized(d.name, locale) }))} value={state.districtId ?? []} onChange={(v) => onChange({ districtId: v.length ? v : undefined })} />
          )}
          {metros.length > 0 && (
            <MultiSelect
              placeholder={t('search.metro')}
              options={metros.map((m) => ({ value: m.id, label: localized(m.name, locale), hint: <span className={`h-2 w-2 rounded-full ${METRO_DOT[m.line] ?? 'bg-subtle'}`} /> }))}
              value={state.metroId ?? []}
              onChange={(v) => onChange({ metroId: v.length ? v : undefined })}
            />
          )}
        </div>
      </Section>

      {daily && (
        <Section title={t('search.dates')}>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" label={t('booking.checkIn')} min={todayIso()} value={state.checkIn ?? ''} onChange={(e) => onChange({ checkIn: e.target.value || undefined })} />
            <Input type="date" label={t('booking.checkOut')} min={state.checkIn ?? todayIso()} value={state.checkOut ?? ''} onChange={(e) => onChange({ checkOut: e.target.value || undefined })} />
          </div>
          <div className="mt-2">
            <NumInput label={t('booking.guests')} placeholder={t('booking.guests')} value={state.guests} onCommit={(v) => onChange({ guests: v && v > 0 ? v : undefined })} />
          </div>
        </Section>
      )}

      <Section title={t('search.price')}>
        <PriceFields state={state} onChange={onChange} />
      </Section>

      <Section title={t('search.area')}>
        <AreaFields state={state} onChange={onChange} />
      </Section>

      <Section title={t('search.rooms')}>
        <RoomsPills state={state} onChange={onChange} />
      </Section>

      {!daily && (
        <Section title={t('search.floor')}>
          <div className="flex items-center gap-2">
            <NumInput label={t('search.chip.floorMin')} placeholder={t('common.min')} value={state.floorMin} onCommit={(v) => onChange({ floorMin: v })} />
            <span className="text-muted" aria-hidden>–</span>
            <NumInput label={t('search.chip.floorMax')} placeholder={t('common.max')} value={state.floorMax} onCommit={(v) => onChange({ floorMax: v })} />
          </div>
          <div className="mt-2 flex flex-col">
            <Checkbox label={t('search.notFirstFloor')} checked={!!state.notFirstFloor} onChange={(v) => onChange({ notFirstFloor: v || undefined })} />
            <Checkbox label={t('search.notLastFloor')} checked={!!state.notLastFloor} onChange={(v) => onChange({ notLastFloor: v || undefined })} />
          </div>
        </Section>
      )}

      <Section title={t('search.repair')}>
        <ChoicePills size="sm" multiple ariaLabel={t('search.repair')} value={state.repair ?? []} onChange={(v) => onChange({ repair: (v as string[]).length ? (v as RepairType[]) : undefined })} options={REPAIR_TYPES.map((r) => ({ value: r as string, label: t(`enums.repair.${r}`) }))} />
      </Section>

      <Section title={t('search.owner')}>
        <Segmented
          block
          size="sm"
          ariaLabel={t('search.owner')}
          value={state.ownerType ?? 'ANY'}
          onChange={(v) => onChange({ ownerType: v === 'ANY' ? undefined : (v as 'OWNER' | 'BUSINESS') })}
          options={[
            { value: 'ANY', label: t('common.any') },
            { value: 'OWNER', label: t('search.ownerOnly') },
            { value: 'BUSINESS', label: t('search.agencyOnly') },
          ]}
        />
      </Section>

      <Section title={t('search.amenities')}>
        <MultiSelect placeholder={t('search.chooseAmenities')} options={AMENITIES.map((a) => ({ value: a, label: t(`enums.amenity.${a}`) }))} value={state.amenities ?? []} onChange={(v) => onChange({ amenities: v.length ? (v as Amenity[]) : undefined })} />
      </Section>

      <Section title={t('search.more')}>
        <div className="flex flex-col">
          {!daily && <Checkbox label={t('search.hasDocument')} checked={!!state.hasDocument} onChange={(v) => onChange({ hasDocument: v || undefined })} />}
          {state.dealType === 'SALE' && <Checkbox label={t('search.mortgage')} checked={!!state.mortgageAvailable} onChange={(v) => onChange({ mortgageAvailable: v || undefined })} />}
          <Checkbox label={t('search.withPhotos')} checked={!!state.hasPhotos} onChange={(v) => onChange({ hasPhotos: v || undefined })} />
          <Checkbox label={t('search.verified')} checked={!!state.verified} onChange={(v) => onChange({ verified: v || undefined })} />
        </div>
      </Section>
    </div>
  );
}
