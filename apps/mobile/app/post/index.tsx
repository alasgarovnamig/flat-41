import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AMENITIES, CITIES, CURRENCIES, DEAL_TYPES, PROPERTY_TYPES, REPAIR_TYPES, districtsOf, formatMoney, formatPrice, getCity, metrosOf,
  type DealType, type PropertyType,
} from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { useAuth } from '@/auth/AuthContext';
import { useI18n, type TKey } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Button, Card, Chip, Field, IconButton, Loading, Segmented, SwitchRow, Text } from '@/components/ui';
import { Select } from '@/components/Select';
import { PinMap } from '@/components/map/Maps';
import { useToast } from '@/components/Toast';
import { formatLocalPhone, toLocalDigits } from '@/lib/phone';
import { PhotosStep } from '@/post/PhotosStep';
import { STEP_FIELDS, draftFromListing, emptyDraft, firstStepWithError, validate, type Draft, type Photo } from '@/post/draft';
import { Ionicons } from '@expo/vector-icons';

const STEPS = ['type', 'location', 'details', 'photos', 'price', 'review'] as const;
const DEAL_ICON: Record<DealType, keyof typeof Ionicons.glyphMap> = { SALE: 'pricetag-outline', RENT_LONG: 'key-outline', RENT_DAILY: 'sunny-outline' };
const PROP_ICON: Record<PropertyType, keyof typeof Ionicons.glyphMap> = {
  APARTMENT: 'business-outline', HOUSE: 'home-outline', OFFICE: 'briefcase-outline', COMMERCIAL: 'storefront-outline', LAND: 'leaf-outline', GARAGE: 'car-outline', ROOM: 'bed-outline',
};

export default function PostWizard() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { me } = useAuth();
  const existing = useQuery({ queryKey: qk.listing(editId ?? ''), queryFn: () => api.listing(editId!), enabled: !!editId });
  const [draft, setDraft] = useState<Draft | null>(editId ? null : emptyDraft(me?.name ?? '', me?.phone ?? null));

  useEffect(() => {
    if (editId && existing.data && !draft) setDraft(draftFromListing(existing.data, me?.phone ?? null));
  }, [editId, existing.data, draft, me?.phone]);

  // `me` may arrive after the wizard opened → prefill the contact fields once.
  useEffect(() => {
    if (!editId && me) setDraft((d) => (d && !d.contactName && !d.contactPhone ? { ...d, contactName: me.name, contactPhone: toLocalDigits(me.phone) } : d));
  }, [editId, me]);

  if (!draft) return <Loading />;
  return <Wizard draft={draft} setDraft={setDraft as (fn: (d: Draft) => Draft) => void} editId={editId} />;
}

function Wizard({ draft: d, setDraft, editId }: { draft: Draft; setDraft: (fn: (d: Draft) => Draft) => void; editId?: string }) {
  const { c } = useTheme();
  const { t, te, ln } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const [step, setStep] = useState(editId ? 5 : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [locating, setLocating] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));
  const setPhotos = (fn: (p: Photo[]) => Photo[]) => setDraft((p) => ({ ...p, photos: fn(p.photos) }));
  const daily = d.dealType === 'RENT_DAILY';
  const isApartmentLike = d.propertyType === 'APARTMENT' || d.propertyType === 'ROOM' || d.propertyType === 'OFFICE';
  const hasLand = d.propertyType === 'HOUSE' || d.propertyType === 'LAND';
  const city = getCity(d.cityId ?? 'baku');
  const uploading = d.photos.some((p) => p.progress < 1 && !p.error);

  const stepValid = (i: number) => {
    const { errors: e } = validate(d);
    const relevant = Object.fromEntries(Object.entries(e).filter(([k]) => STEP_FIELDS[i].includes(k)));
    setErrors(relevant);
    if (Object.keys(relevant).length) toast.show(t('post.fixErrors'), 'error');
    return !Object.keys(relevant).length;
  };

  const next = () => {
    if (step === 0 && (!d.dealType || !d.propertyType)) return toast.show(t('post.fixErrors'), 'error');
    if (step > 0 && step < 5 && !stepValid(step)) return;
    if (step === 3 && uploading) return;
    setErrors({});
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => (step === 0 ? confirmDiscard() : setStep((s) => s - 1));

  const confirmDiscard = () =>
    Alert.alert(t('post.discardTitle'), t('post.discardText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('post.discard'), style: 'destructive', onPress: () => router.back() },
    ]);

  const locate = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return toast.show(t('post.locationDenied'), 'error');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setDraft((p) => ({ ...p, lat: pos.coords.latitude, lng: pos.coords.longitude }));
      if (!d.address) {
        const [g] = await Location.reverseGeocodeAsync(pos.coords).catch(() => []);
        if (g) set('address', [g.street, g.streetNumber].filter(Boolean).join(' '));
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setLocating(false);
    }
  };

  const submit = useMutation({
    mutationFn: async () => {
      const { errors: e, data } = validate(d);
      if (!data) {
        setErrors(e);
        const s = firstStepWithError(e);
        if (s !== null) setStep(s);
        throw new Error('validation');
      }
      return editId ? api.updateListing(editId, data) : api.createListing(data);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['myListings'] });
      qc.invalidateQueries({ queryKey: qk.me });
      if (editId) {
        qc.invalidateQueries({ queryKey: qk.listing(editId) });
        toast.success(t('post.updated'));
        router.back();
        return;
      }
      if (res.requiresPayment) router.replace({ pathname: '/post/fee', params: { id: res.id } });
      else {
        toast.success(`${t('post.submitted')} ${t('post.pendingModeration')}`);
        router.replace({ pathname: '/promote/[id]', params: { id: res.id, upsell: '1' } });
      }
    },
    onError: (e) => {
      if ((e as Error).message !== 'validation') toast.error(e);
      else toast.show(t('post.fixErrors'), 'error');
    },
  });

  const progress = (step + 1) / STEPS.length;
  const quota = me?.quota;
  const quotaText = useMemo(() => {
    if (daily) return t('post.dailyFree');
    if (!quota) return null;
    if (quota.remaining === -1) return t('post.quotaUnlimited');
    if (quota.remaining > 0) return t('post.quotaFree', { n: quota.remaining });
    return t('post.quotaPaid', { fee: formatMoney(quota.listingFee) });
  }, [daily, quota, t]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen
        options={{
          title: editId ? t('post.editTitle') : t('post.title'),
          headerLeft: () => <IconButton name="close" label={t('common.close')} onPress={editId ? () => router.back() : confirmDiscard} />,
        }}
      />
      {/* Progress */}
      <View style={{ paddingHorizontal: spacing.lg, gap: 6, paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small" muted>
            {t('post.step', { n: step + 1, total: STEPS.length })}
          </Text>
          <Text variant="small" style={{ fontWeight: '600' }}>
            {t(`post.steps.${STEPS[step]}` as TKey)}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.surface }]}>
          <View style={[styles.bar, { width: `${progress * 100}%`, backgroundColor: c.primary }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {step === 0 && (
          <>
            <Text variant="h2">{t('post.chooseDeal')}</Text>
            <View style={{ gap: spacing.sm }}>
              {DEAL_TYPES.map((dt) => (
                <Card key={dt} onPress={() => set('dealType', dt)} style={[styles.choice, d.dealType === dt && { borderColor: c.primary, borderWidth: 2, backgroundColor: c.primarySoft }]}>
                  <Ionicons name={DEAL_ICON[dt]} size={24} color={c.primary} />
                  <Text variant="h3" style={{ flex: 1 }}>
                    {te('dealType', dt)}
                  </Text>
                  <Ionicons name={d.dealType === dt ? 'radio-button-on' : 'radio-button-off'} size={22} color={d.dealType === dt ? c.primary : c.muted} />
                </Card>
              ))}
            </View>
            <Text variant="h2">{t('post.chooseProperty')}</Text>
            <View style={styles.grid}>
              {PROPERTY_TYPES.map((p) => (
                <Card key={p} onPress={() => set('propertyType', p)} style={[styles.prop, d.propertyType === p && { borderColor: c.primary, borderWidth: 2, backgroundColor: c.primarySoft }]}>
                  <Ionicons name={PROP_ICON[p]} size={26} color={d.propertyType === p ? c.primary : c.text} />
                  <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>
                    {te('propertyType', p)}
                  </Text>
                </Card>
              ))}
            </View>
            {d.propertyType === 'APARTMENT' && (
              <Segmented
                options={[
                  { value: 'NEW', label: te('buildingType', 'NEW') },
                  { value: 'SECONDARY', label: te('buildingType', 'SECONDARY') },
                ]}
                value={d.buildingType ?? 'SECONDARY'}
                onChange={(v) => set('buildingType', v)}
              />
            )}
          </>
        )}

        {step === 1 && (
          <>
            <Select
              label={t('search.city')}
              options={CITIES.map((x) => ({ value: x.id, label: ln(x.name) }))}
              value={d.cityId}
              error={errors.cityId}
              onChange={(v) => setDraft((p) => ({ ...p, cityId: v, districtId: null, metroId: null, lat: null, lng: null }))}
            />
            {d.cityId && districtsOf(d.cityId).length > 0 && (
              <Select
                label={t('search.district')}
                options={districtsOf(d.cityId).map((x) => ({ value: x.id, label: ln(x.name) }))}
                value={d.districtId}
                clearable
                placeholder={t('common.select')}
                onChange={(v) => set('districtId', v)}
              />
            )}
            {d.cityId && metrosOf(d.cityId).length > 0 && (
              <Select
                label={t('search.metro')}
                options={metrosOf(d.cityId).map((x) => ({ value: x.id, label: ln(x.name) }))}
                value={d.metroId}
                clearable
                placeholder={t('common.select')}
                onChange={(v) => set('metroId', v)}
              />
            )}
            <Field label={t('post.address')} value={d.address} onChangeText={(v) => set('address', v)} error={errors.address} maxLength={200} />
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="label">{t('post.pinOnMap')}</Text>
                <Button title={t('post.useMyLocation')} icon="locate" kind="ghost" small full={false} loading={locating} onPress={locate} />
              </View>
              <View style={{ height: 260, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
                <PinMap
                  style={{ flex: 1 }}
                  value={d.lat != null && d.lng != null ? { latitude: d.lat, longitude: d.lng } : null}
                  center={{ latitude: city?.lat ?? 40.4093, longitude: city?.lng ?? 49.8671 }}
                  onChange={(p) => setDraft((x) => ({ ...x, lat: p.latitude, lng: p.longitude }))}
                />
              </View>
              <Text variant="small" muted>
                {d.lat != null ? `${d.lat.toFixed(5)}, ${d.lng?.toFixed(5)}` : t('post.tapToPin')}
              </Text>
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <View style={styles.row}>
              <Field containerStyle={{ flex: 1 }} label={`${t('listing.area')}, ${t('common.m2')}`} keyboardType="decimal-pad" value={d.area} onChangeText={(v) => set('area', v)} error={errors.area} />
              {hasLand && (
                <Field containerStyle={{ flex: 1 }} label={`${t('listing.landArea')}, ${t('common.sot')}`} keyboardType="decimal-pad" value={d.landArea} onChangeText={(v) => set('landArea', v)} error={errors.landArea} />
              )}
            </View>
            {d.propertyType !== 'LAND' && d.propertyType !== 'GARAGE' && (
              <>
                <Text variant="label">{t('listing.rooms')}</Text>
                <View style={styles.chips}>
                  {['1', '2', '3', '4', '5', '6', '7', '8'].map((r) => (
                    <Chip key={r} label={r === '8' ? '8+' : r} selected={d.rooms === r} onPress={() => set('rooms', r)} style={{ minWidth: 44, justifyContent: 'center' }} />
                  ))}
                </View>
                {!!errors.rooms && <Text color={c.danger}>{errors.rooms}</Text>}
                <Field label={t('listing.bathrooms')} keyboardType="number-pad" value={d.bathrooms} onChangeText={(v) => set('bathrooms', v)} error={errors.bathrooms} />
              </>
            )}
            {(isApartmentLike || d.propertyType === 'COMMERCIAL') && (
              <View style={styles.row}>
                <Field containerStyle={{ flex: 1 }} label={t('listing.floor')} keyboardType="number-pad" value={d.floor} onChangeText={(v) => set('floor', v)} error={errors.floor} />
                <Field containerStyle={{ flex: 1 }} label={t('listing.totalFloors')} keyboardType="number-pad" value={d.totalFloors} onChangeText={(v) => set('totalFloors', v)} error={errors.totalFloors} />
              </View>
            )}
            {d.propertyType !== 'LAND' && (
              <View style={styles.row}>
                <Field containerStyle={{ flex: 1 }} label={t('listing.yearBuilt')} keyboardType="number-pad" value={d.yearBuilt} onChangeText={(v) => set('yearBuilt', v)} error={errors.yearBuilt} />
                <Field containerStyle={{ flex: 1 }} label={`${t('listing.ceilingHeight')}, m`} keyboardType="decimal-pad" value={d.ceilingHeight} onChangeText={(v) => set('ceilingHeight', v)} error={errors.ceilingHeight} />
              </View>
            )}
            {d.propertyType !== 'LAND' && (
              <>
                <Text variant="label">{t('listing.repair')}</Text>
                <View style={styles.chips}>
                  {REPAIR_TYPES.map((r) => (
                    <Chip key={r} label={te('repair', r)} selected={d.repair === r} onPress={() => set('repair', d.repair === r ? null : r)} />
                  ))}
                </View>
              </>
            )}
            {d.dealType === 'SALE' && (
              <View>
                <SwitchRow label={t('search.hasDocument')} value={d.hasDocument} onChange={(v) => set('hasDocument', v)} />
                <SwitchRow label={t('search.mortgage')} value={d.mortgageAvailable} onChange={(v) => set('mortgageAvailable', v)} />
              </View>
            )}
            {daily && (
              <Card style={{ gap: spacing.md }}>
                <Text variant="h3">{t('post.daily')}</Text>
                <View style={styles.row}>
                  <Field containerStyle={{ flex: 1 }} label={t('listing.maxGuests')} keyboardType="number-pad" value={d.maxGuests} onChangeText={(v) => set('maxGuests', v)} error={errors.maxGuests} />
                  <Field containerStyle={{ flex: 1 }} label={t('listing.minNights')} keyboardType="number-pad" value={d.minNights} onChangeText={(v) => set('minNights', v)} error={errors.minNights} />
                </View>
                <View style={styles.row}>
                  <Field containerStyle={{ flex: 1 }} label={t('listing.checkInTime')} placeholder="14:00" value={d.checkInTime} onChangeText={(v) => set('checkInTime', v)} error={errors.checkInTime} maxLength={5} />
                  <Field containerStyle={{ flex: 1 }} label={t('listing.checkOutTime')} placeholder="12:00" value={d.checkOutTime} onChangeText={(v) => set('checkOutTime', v)} error={errors.checkOutTime} maxLength={5} />
                </View>
                <Field label={t('listing.houseRules')} value={d.houseRules} onChangeText={(v) => set('houseRules', v)} multiline maxLength={2000} />
              </Card>
            )}
            <Text variant="label">{t('listing.amenities')}</Text>
            <View style={styles.chips}>
              {AMENITIES.map((a) => (
                <Chip
                  key={a}
                  label={te('amenity', a)}
                  selected={d.amenities.includes(a)}
                  onPress={() => set('amenities', d.amenities.includes(a) ? d.amenities.filter((x) => x !== a) : [...d.amenities, a])}
                />
              ))}
            </View>
          </>
        )}

        {step === 3 && <PhotosStep photos={d.photos} setPhotos={setPhotos} error={errors.imageIds} />}

        {step === 4 && (
          <>
            <View style={styles.row}>
              <Field
                containerStyle={{ flex: 2 }}
                label={`${t('post.price')}${daily ? ` ${t('common.perNight')}` : d.dealType === 'RENT_LONG' ? ` ${t('common.perMonth')}` : ''}`}
                keyboardType="number-pad"
                value={d.price}
                onChangeText={(v) => set('price', v.replace(/\D/g, ''))}
                error={errors.price}
              />
              <View style={{ flex: 1 }}>
                <Select label={t('search.currency')} options={CURRENCIES.map((x) => ({ value: x, label: x }))} value={d.currency} onChange={(v) => v && set('currency', v as Draft['currency'])} />
              </View>
            </View>
            <Field label={t('post.titleField')} placeholder={t('post.titleHint')} value={d.title} onChangeText={(v) => set('title', v)} error={errors.title} maxLength={120} hint={`${d.title.length}/120`} />
            <Field
              label={t('post.descriptionField')}
              placeholder={t('post.descriptionHint')}
              value={d.description}
              onChangeText={(v) => set('description', v)}
              error={errors.description}
              multiline
              maxLength={5000}
              hint={`${d.description.length}/5000`}
            />
            <Field label={t('post.contactName')} value={d.contactName} onChangeText={(v) => set('contactName', v)} error={errors.contactName} autoComplete="name" />
            <Field
              label={t('post.contactPhone')}
              value={formatLocalPhone(d.contactPhone)}
              onChangeText={(v) => set('contactPhone', v.replace(/\D/g, '').replace(/^0/, '').slice(0, 9))}
              keyboardType="phone-pad"
              left={<Text style={{ fontWeight: '600' }}>+994</Text>}
              error={errors.contactPhone}
            />
          </>
        )}

        {step === 5 && (
          <>
            <Text variant="h2">{t('post.review')}</Text>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {d.photos[0] && <Image source={{ uri: d.photos[0].localUri ?? absUrl(d.photos[0].url) }} style={{ width: '100%', height: 180 }} contentFit="cover" />}
              <View style={{ padding: spacing.lg, gap: 4 }}>
                <Text variant="h2">{d.price ? formatPrice(Number(d.price), d.currency) : '—'}</Text>
                <Text variant="h3">{d.title || '—'}</Text>
                <Text muted>
                  {[d.dealType && te('dealType', d.dealType), d.propertyType && te('propertyType', d.propertyType), d.rooms && t('common.roomsShort', { n: d.rooms }), d.area && `${d.area} ${t('common.m2')}`]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text muted>{[d.address, ln(getCity(d.cityId ?? '')?.name)].filter(Boolean).join(', ')}</Text>
                <Text variant="small" muted>
                  {t('common.photos', { n: d.photos.length })}
                </Text>
              </View>
            </Card>
            {Object.keys(errors).length > 0 && (
              <Card style={{ borderColor: c.danger, gap: 4 }}>
                {Object.entries(errors).map(([k, v]) => (
                  <Text key={k} color={c.danger} variant="small">
                    • {k}: {v}
                  </Text>
                ))}
              </Card>
            )}
            {!editId && quotaText && (
              <View style={[styles.quota, { backgroundColor: quota?.remaining === 0 && !daily ? c.highlightBg : c.primarySoft }]}>
                <Ionicons name={quota?.remaining === 0 && !daily ? 'card-outline' : 'gift-outline'} size={20} color={quota?.remaining === 0 && !daily ? brand.vip : c.primary} />
                <Text style={{ flex: 1 }}>{quotaText}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + spacing.sm }]}>
        {step > 0 && <Button title={t('common.back')} kind="outline" style={{ flex: 1 }} onPress={back} />}
        {step < 5 ? (
          <Button title={t('common.next')} style={{ flex: 2 }} onPress={next} disabled={step === 3 && uploading} loading={step === 3 && uploading} />
        ) : (
          <Button title={editId ? t('post.saveChanges') : t('post.submit')} style={{ flex: 2 }} loading={submit.isPending} onPress={() => submit.mutate()} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  prop: { width: '31%', alignItems: 'center', gap: 6, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, minHeight: 84, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quota: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
