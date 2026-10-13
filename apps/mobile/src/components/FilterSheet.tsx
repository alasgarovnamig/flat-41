import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  AMENITIES, CITIES, CURRENCIES, DEAL_TYPES, PROPERTY_TYPES, REPAIR_TYPES, districtsOf, metrosOf,
  type Amenity, type Currency, type DealType, type ListingSearchQuery, type ListingSort, type PropertyType, type RepairType,
} from '@evtap/shared';
import { Sheet } from './Sheet';
import { Select } from './Select';
import { Button, Chip, Field, Segmented, Stepper, SwitchRow, Text } from './ui';
import { Calendar, type DayState } from './Calendar';
import { useI18n } from '../i18n';
import { spacing, useTheme } from '../theme';
import { isoDay } from '../hooks/common';

/** UI-side, strongly typed mirror of `listingSearchSchema` (minus page/pageSize/bbox). */
export type Filters = {
  q?: string;
  dealType?: DealType;
  propertyType?: PropertyType[];
  buildingType?: 'NEW' | 'SECONDARY';
  country?: 'AZ' | 'GE';
  cityId?: string;
  districtId?: string[];
  metroId?: string[];
  priceMin?: number;
  priceMax?: number;
  currency?: Currency;
  areaMin?: number;
  areaMax?: number;
  rooms?: number[];
  floorMin?: number;
  floorMax?: number;
  notFirstFloor?: boolean;
  notLastFloor?: boolean;
  repair?: RepairType[];
  hasDocument?: boolean;
  mortgageAvailable?: boolean;
  amenities?: Amenity[];
  ownerType?: 'OWNER' | 'BUSINESS';
  hasPhotos?: boolean;
  verified?: boolean;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  sort?: ListingSort;
};
// Compile-time check that Filters stays assignable to the shared contract.
const _assignable = (f: Filters): ListingSearchQuery => f;
void _assignable;

const METRO_COLORS = { red: '#E5484D', green: '#16A34A', purple: '#7C3AED' } as const;

/** Number of active filters (shown as a badge on the filter button). */
export const countFilters = (f: Filters) =>
  Object.entries(f).filter(([k, v]) => k !== 'sort' && k !== 'q' && k !== 'dealType' && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && v !== false).length;

/** Drop empty values so the query string stays short (arrays are CSV-encoded by the client). */
export const cleanFilters = (f: Filters): Filters => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  // Swap inverted ranges instead of sending a query the API would reject.
  for (const [a, b] of [['priceMin', 'priceMax'], ['areaMin', 'areaMax'], ['floorMin', 'floorMax']] as const) {
    if (typeof out[a] === 'number' && typeof out[b] === 'number' && (out[a] as number) > (out[b] as number)) [out[a], out[b]] = [out[b], out[a]];
  }
  return out as Filters;
};

const num = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
};

export function FilterSheet({ visible, onClose, value, onApply }: { visible: boolean; onClose: () => void; value: Filters; onApply: (f: Filters) => void }) {
  const { c } = useTheme();
  const { t, te, ln } = useI18n();
  const [f, setF] = useState<Filters>(value);
  const [datesOpen, setDatesOpen] = useState(false);

  useEffect(() => {
    if (visible) setF(value);
  }, [visible, value]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleIn = <K extends 'propertyType' | 'rooms' | 'repair' | 'amenities'>(k: K, v: string | number) =>
    setF((p) => {
      const arr = ((p[k] as (string | number)[] | undefined) ?? []).slice();
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(v);
      return { ...p, [k]: arr };
    });
  const has = (k: 'propertyType' | 'rooms' | 'repair' | 'amenities', v: string | number) => ((f[k] as (string | number)[] | undefined) ?? []).includes(v as never);

  const cityOptions = CITIES.map((x) => ({ value: x.id, label: ln(x.name), hint: x.country === 'GE' ? '🇬🇪' : undefined }));
  const districts = f.cityId ? districtsOf(f.cityId) : [];
  const metros = f.cityId ? metrosOf(f.cityId) : [];
  const daily = f.dealType === 'RENT_DAILY';

  const dayState = (iso: string): DayState => {
    if (iso < isoDay(new Date())) return 'past';
    if (f.checkIn && iso === f.checkIn) return f.checkOut ? 'start' : 'single';
    if (f.checkOut && iso === f.checkOut) return 'end';
    if (f.checkIn && f.checkOut && iso > f.checkIn && iso < f.checkOut) return 'inRange';
    return 'normal';
  };
  const onDay = (iso: string) => {
    if (!f.checkIn || f.checkOut || iso <= f.checkIn) setF((p) => ({ ...p, checkIn: iso, checkOut: undefined }));
    else {
      setF((p) => ({ ...p, checkOut: iso }));
      setDatesOpen(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('common.filters')}
      maxHeight="94%"
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('common.reset')} kind="outline" style={{ flex: 1 }} onPress={() => setF({ sort: f.sort, dealType: f.dealType })} />
          <Button
            title={t('search.showResults')}
            style={{ flex: 2 }}
            onPress={() => {
              onApply(cleanFilters(f));
              onClose();
            }}
          />
        </View>
      }
    >
      <Text variant="label">{t('search.dealType')}</Text>
      <Segmented
        options={[{ value: '', label: t('common.all') }, ...DEAL_TYPES.map((d) => ({ value: d, label: te('dealTypeShort', d) }))]}
        value={(f.dealType as string) ?? ''}
        onChange={(v) => set('dealType', (v || undefined) as Filters['dealType'])}
      />

      <Text variant="label">{t('search.propertyType')}</Text>
      <View style={styles.wrap}>
        {PROPERTY_TYPES.map((p) => (
          <Chip key={p} label={te('propertyType', p)} selected={has('propertyType', p)} onPress={() => toggleIn('propertyType', p)} />
        ))}
      </View>

      {(has('propertyType', 'APARTMENT') || !f.propertyType?.length) && (
        <>
          <Text variant="label">{t('search.buildingType')}</Text>
          <Segmented
            options={[{ value: '', label: t('common.any') }, { value: 'NEW', label: te('buildingType', 'NEW') }, { value: 'SECONDARY', label: te('buildingType', 'SECONDARY') }]}
            value={(f.buildingType as string) ?? ''}
            onChange={(v) => set('buildingType', (v || undefined) as Filters['buildingType'])}
          />
        </>
      )}

      <Select
        label={t('search.city')}
        options={cityOptions}
        value={f.cityId}
        clearable
        placeholder={t('search.anyCity')}
        onChange={(v) => setF((p) => ({ ...p, cityId: v ?? undefined, districtId: [], metroId: [] }))}
      />
      <Select
        multiple
        label={t('search.district')}
        options={districts.map((d) => ({ value: d.id, label: ln(d.name) }))}
        value={(f.districtId as string[]) ?? []}
        onChange={(v) => set('districtId', v)}
        disabled={!districts.length}
        placeholder={f.cityId ? t('common.any') : t('search.chooseCity')}
      />
      {metros.length > 0 && (
        <Select
          multiple
          label={t('search.metro')}
          options={metros.map((m) => ({ value: m.id, label: ln(m.name), color: METRO_COLORS[m.line] }))}
          value={(f.metroId as string[]) ?? []}
          onChange={(v) => set('metroId', v)}
          placeholder={t('common.any')}
        />
      )}

      <Text variant="label">{t('search.price')}</Text>
      <View style={styles.row}>
        <Field containerStyle={{ flex: 1 }} placeholder={t('common.from')} keyboardType="number-pad" value={f.priceMin?.toString() ?? ''} onChangeText={(s) => set('priceMin', num(s))} />
        <Field containerStyle={{ flex: 1 }} placeholder={t('common.to')} keyboardType="number-pad" value={f.priceMax?.toString() ?? ''} onChangeText={(s) => set('priceMax', num(s))} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {CURRENCIES.map((cur) => (
          <Chip key={cur} label={cur} selected={(f.currency ?? 'AZN') === cur} onPress={() => set('currency', cur)} />
        ))}
      </ScrollView>

      <Text variant="label">{t('search.area')}</Text>
      <View style={styles.row}>
        <Field containerStyle={{ flex: 1 }} placeholder={t('common.from')} keyboardType="decimal-pad" value={f.areaMin?.toString() ?? ''} onChangeText={(s) => set('areaMin', num(s))} />
        <Field containerStyle={{ flex: 1 }} placeholder={t('common.to')} keyboardType="decimal-pad" value={f.areaMax?.toString() ?? ''} onChangeText={(s) => set('areaMax', num(s))} />
      </View>

      <Text variant="label">{t('search.rooms')}</Text>
      <View style={styles.wrap}>
        {[1, 2, 3, 4, 5].map((r) => (
          <Chip key={r} label={r === 5 ? '5+' : String(r)} selected={has('rooms', r)} onPress={() => toggleIn('rooms', r)} style={{ minWidth: 48, justifyContent: 'center' }} />
        ))}
      </View>

      <Text variant="label">{t('search.floor')}</Text>
      <View style={styles.row}>
        <Field containerStyle={{ flex: 1 }} placeholder={t('common.from')} keyboardType="number-pad" value={f.floorMin?.toString() ?? ''} onChangeText={(s) => set('floorMin', num(s))} />
        <Field containerStyle={{ flex: 1 }} placeholder={t('common.to')} keyboardType="number-pad" value={f.floorMax?.toString() ?? ''} onChangeText={(s) => set('floorMax', num(s))} />
      </View>
      <View style={styles.wrap}>
        <Chip label={t('search.notFirstFloor')} selected={!!f.notFirstFloor} onPress={() => set('notFirstFloor', !f.notFirstFloor || undefined)} />
        <Chip label={t('search.notLastFloor')} selected={!!f.notLastFloor} onPress={() => set('notLastFloor', !f.notLastFloor || undefined)} />
      </View>

      <Text variant="label">{t('search.repair')}</Text>
      <View style={styles.wrap}>
        {REPAIR_TYPES.map((r) => (
          <Chip key={r} label={te('repair', r)} selected={has('repair', r)} onPress={() => toggleIn('repair', r)} />
        ))}
      </View>

      <Text variant="label">{t('search.ownerType')}</Text>
      <Segmented
        options={[{ value: '', label: t('common.all') }, { value: 'OWNER', label: te('ownerType', 'OWNER') }, { value: 'BUSINESS', label: te('ownerType', 'BUSINESS') }]}
        value={(f.ownerType as string) ?? ''}
        onChange={(v) => set('ownerType', (v || undefined) as Filters['ownerType'])}
      />

      <View>
        <SwitchRow label={t('search.hasDocument')} value={!!f.hasDocument} onChange={(v) => set('hasDocument', v || undefined)} />
        <SwitchRow label={t('search.mortgage')} value={!!f.mortgageAvailable} onChange={(v) => set('mortgageAvailable', v || undefined)} />
        <SwitchRow label={t('search.withPhotos')} value={!!f.hasPhotos} onChange={(v) => set('hasPhotos', v || undefined)} />
        <SwitchRow label={t('search.verifiedOnly')} value={!!f.verified} onChange={(v) => set('verified', v || undefined)} />
      </View>

      {daily && (
        <>
          <Text variant="label">{t('search.dates')}</Text>
          <Pressable onPress={() => setDatesOpen((o) => !o)} style={[styles.dates, { borderColor: c.border, backgroundColor: c.inputBg }]} accessibilityRole="button">
            <Text>{f.checkIn ? `${f.checkIn} → ${f.checkOut ?? '…'}` : t('booking.selectDates')}</Text>
          </Pressable>
          {datesOpen && <Calendar months={4} dayState={dayState} onDayPress={onDay} />}
          <Stepper label={t('search.guests')} value={Number(f.guests ?? 1)} min={1} max={30} onChange={(v) => set('guests', v)} />
        </>
      )}

      <Text variant="label">{t('search.amenities')}</Text>
      <View style={styles.wrap}>
        {AMENITIES.map((a) => (
          <Chip key={a} label={te('amenity', a)} selected={has('amenities', a)} onPress={() => toggleIn('amenities', a)} />
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  dates: { minHeight: 48, borderWidth: 1, borderRadius: 12, justifyContent: 'center', paddingHorizontal: spacing.md },
});
