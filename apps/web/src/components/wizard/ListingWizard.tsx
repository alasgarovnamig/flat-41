'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AMENITIES, CITIES, COUNTRIES, CURRENCIES, PROPERTY_TYPES, REPAIR_TYPES, createListingSchema, districtsOf, formatMoney,
  formatPrice, getCity, getDistrict, getMetro, localized, metrosOf, type DealType, type MyListing, type PropertyType,
} from '@evtap/shared';
import { api } from '@/lib/api';
import { zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { LocationPicker } from '@/components/map';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Chips, Input, Select, Textarea, Toggle } from '@/components/ui/form';
import { ArrowUpIcon, BuildingIcon, CalendarIcon, CheckIcon, HomeIcon, PinIcon } from '@/components/ui/icons';
import { ListingFeePayment } from './ListingFeePayment';
import { PhotoUploader } from './PhotoUploader';
import { STEPS, STEP_FIELDS, emptyForm, toInput, type Step, type WizardForm } from './wizard-model';

const DRAFT_KEY = 'evtap.listingDraft';

function StepHeader({ step, current, onJump, done }: { step: Step; current: number; onJump: (i: number) => void; done: Set<number> }) {
  const { t } = useI18n();
  return (
    <div className="mb-6">
      <p className="mb-2 text-sm font-semibold text-brand sm:hidden">
        {t('wizard.stepOf', { n: current + 1, total: STEPS.length })}: {t(`wizard.steps.${step}`)}
      </p>
      <ol className="flex gap-1.5" aria-label={t('wizard.progress')}>
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={i > current && !done.has(i - 1)}
              aria-current={s === step ? 'step' : undefined}
              aria-label={`${i + 1}. ${t(`wizard.steps.${s}`)}`}
              className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-not-allowed"
            >
              <span className={cn('h-1.5 w-full rounded-full transition-colors', i < current || done.has(i) ? 'bg-brand' : i === current ? 'bg-brand/60' : 'bg-ink/10')} />
              <span className={cn('hidden truncate text-xs font-semibold sm:block', i === current ? 'text-brand' : 'text-muted')}>
                {i + 1}. {t(`wizard.steps.${s}`)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChoiceCard({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('flex items-start gap-3 rounded-xl border p-4 text-left transition-colors', active ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line bg-white hover:border-ink/30')}>
      <span className={cn('mt-0.5', active ? 'text-brand' : 'text-muted')}>{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        {sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}
      </span>
    </button>
  );
}

export function ListingWizard({ mode, initial, listingId }: { mode: 'create' | 'edit'; initial?: WizardForm; listingId?: string }) {
  const { t, href, locale } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<WizardForm>(() => initial ?? emptyForm());
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<MyListing | null>(null);
  const restored = useRef(false);
  const step = STEPS[stepIdx]!;

  // restore / persist a local draft (create mode only)
  useEffect(() => {
    if (mode !== 'create' || restored.current) return;
    restored.current = true;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as WizardForm;
        setForm({ ...emptyForm(), ...d, photos: (d.photos ?? []).filter((p) => p.id) });
      }
    } catch {
      /* ignore */
    }
  }, [mode]);
  useEffect(() => {
    if (mode !== 'create' || created) return;
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, photos: form.photos.filter((p) => p.id) }));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearTimeout(id);
  }, [form, mode, created]);

  // contact defaults from the profile
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, contactName: f.contactName || user.name || '', contactPhone: f.contactPhone || user.phone || '' }));
  }, [user]);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const daily = form.dealType === 'RENT_DAILY';
  const pt = form.propertyType;
  const hasRooms = ['APARTMENT', 'HOUSE', 'ROOM', 'OFFICE'].includes(pt);
  const hasFloor = ['APARTMENT', 'OFFICE', 'COMMERCIAL', 'ROOM'].includes(pt);
  const hasLand = ['HOUSE', 'LAND', 'COMMERCIAL'].includes(pt);
  const city = getCity(form.cityId);
  const uploading = form.photos.some((p) => p.progress !== undefined);

  const validate = (fields?: string[]) => {
    const input = toInput(form);
    const r = createListingSchema.safeParse(input);
    // zod skips the schema's superRefine while base fields are invalid, so mirror those rules here
    const extra: Record<string, string> = {};
    if (input.dealType === 'RENT_DAILY' && !input.maxGuests) extra.maxGuests = t('validation.required');
    if (['APARTMENT', 'HOUSE', 'ROOM'].includes(input.propertyType) && input.rooms == null) extra.rooms = t('validation.required');
    if (input.floor != null && input.totalFloors != null && input.floor > input.totalFloors) extra.floor = t('validation.floorExceeds');
    if (r.success && !Object.keys(extra).length) {
      setErrors({});
      return true;
    }
    const all = { ...extra, ...(r.success ? {} : zodFieldErrors(r.error.issues, t)) };
    const relevant = fields ? Object.fromEntries(Object.entries(all).filter(([k]) => fields.includes(k.split('.')[0]!))) : all;
    setErrors(relevant);
    if (!fields) {
      const firstStep = STEPS.findIndex((s) => s !== 'review' && STEP_FIELDS[s].some((f) => Object.keys(all).some((k) => k.split('.')[0] === f)));
      if (firstStep >= 0) setStepIdx(firstStep);
    }
    return Object.keys(relevant).length === 0;
  };

  const next = () => {
    if (step !== 'review' && !validate(STEP_FIELDS[step])) return;
    if (step === 'photos' && uploading) return toast.info(t('wizard.photos.wait'));
    setDone((d) => new Set(d).add(stepIdx));
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  const submit = useMutation({
    mutationFn: () => (mode === 'create' ? api.listings.create(toInput(form)) : api.listings.update(listingId!, toInput(form))),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['listings'] });
      if (mode === 'create') {
        try {
          window.localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
        setCreated(res);
        window.scrollTo({ top: 0 });
      } else {
        toast.success(t('wizard.saved'));
        router.push(href(`/listings/${res.id}`));
      }
    },
  });

  const suggestTitle = () => {
    const parts: string[] = [];
    if (form.rooms && hasRooms) parts.push(t('wizard.titleRooms', { n: form.rooms }));
    parts.push(t(`enums.propertyType.${pt}`).toLowerCase());
    if (form.area) parts.push(`${form.area} ${t('common.sqm')}`);
    const loc = form.metroId ? `m. ${localized(getMetro(form.metroId)?.name, locale)}` : form.districtId ? localized(getDistrict(form.districtId)?.name, locale) : localized(city?.name, locale);
    if (loc) parts.push(loc);
    const s = parts.join(', ');
    set('title', s.charAt(0).toUpperCase() + s.slice(1));
  };

  const quota = user?.quota;
  const quotaNote = useMemo(() => {
    if (mode !== 'create' || !quota || daily) return null;
    if (quota.remaining === -1) return null;
    if (quota.remaining > 0) return { tone: 'info' as const, text: t('wizard.quotaLeft', { n: quota.remaining, total: quota.freeLimit }) };
    return { tone: 'warning' as const, text: t('wizard.quotaOver', { fee: formatMoney(quota.listingFee) }) };
  }, [mode, quota, daily, t]);

  // ───────── after create ─────────
  if (created) {
    if (created.requiresPayment || created.status === 'DRAFT') return <ListingFeePayment listing={created} />;
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-white p-8 text-center shadow-card">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand">
          <CheckIcon size={32} strokeWidth={2.5} />
        </div>
        <h1 className="mt-4 text-2xl font-bold">{t('wizard.successTitle')}</h1>
        <p className="mt-2 text-muted">{created.status === 'PENDING' ? t('wizard.successPending') : t('wizard.successActive')}</p>
        <div className="mt-6 rounded-xl border border-premium/30 bg-premium-50 p-5 text-left">
          <div className="flex items-center gap-2 font-semibold text-premium">
            <ArrowUpIcon size={18} /> {t('wizard.upsellTitle')}
          </div>
          <p className="mt-1 text-sm text-ink/80">{t('wizard.upsellText')}</p>
          <LinkButton href={href(`/listings/${created.id}/promote`)} variant="premium" className="mt-4 w-full">
            {t('owner.promote')}
          </LinkButton>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <LinkButton href={href(`/listings/${created.id}`)} variant="outline">
            {t('wizard.viewListing')}
          </LinkButton>
          <LinkButton href={href('/account/listings')} variant="ghost">
            {t('account.nav.listings')}
          </LinkButton>
        </div>
      </div>
    );
  }

  const input = toInput(form);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">{mode === 'create' ? t('wizard.title') : t('wizard.editTitle')}</h1>
      <p className="mb-6 text-muted">{t('wizard.subtitle')}</p>
      {quotaNote && <Alert tone={quotaNote.tone} className="mb-6">{quotaNote.text}</Alert>}
      <StepHeader step={step} current={stepIdx} done={done} onJump={(i) => (i <= stepIdx || done.has(i - 1) ? setStepIdx(i) : undefined)} />

      <div className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-8">
        <h2 className="mb-5 text-xl font-bold">{t(`wizard.steps.${step}`)}</h2>

        {step === 'type' && (
          <div className="flex flex-col gap-6">
            <div>
              <div className="mb-2 text-sm font-medium">{t('wizard.dealType')}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['SALE', 'RENT_LONG', 'RENT_DAILY'] as DealType[]).map((d) => (
                  <ChoiceCard key={d} active={form.dealType === d} onClick={() => set('dealType', d)} icon={d === 'RENT_DAILY' ? <CalendarIcon /> : <HomeIcon />} title={t(`enums.dealType.${d}`)} sub={t(`wizard.dealHint.${d}`)} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">{t('wizard.propertyType')}</div>
              <Chips value={pt} onChange={(v) => v && set('propertyType', v as PropertyType)} options={PROPERTY_TYPES.map((p) => ({ value: p as string, label: t(`enums.propertyType.${p}`) }))} />
            </div>
            {pt === 'APARTMENT' && (
              <div>
                <div className="mb-2 text-sm font-medium">{t('wizard.buildingType')}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['NEW', 'SECONDARY'] as const).map((b) => (
                    <ChoiceCard key={b} active={form.buildingType === b} onClick={() => set('buildingType', b)} icon={<BuildingIcon />} title={t(`enums.buildingType.${b}`)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'location' && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t('search.city')} required value={form.cityId} error={errors.cityId} onChange={(e) => setForm((f) => ({ ...f, cityId: e.target.value, districtId: null, metroId: null, lat: null, lng: null }))}>
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
              <Select label={t('search.district')} value={form.districtId ?? ''} onChange={(e) => set('districtId', e.target.value || null)} disabled={!districtsOf(form.cityId).length}>
                <option value="">{t('common.notSelected')}</option>
                {districtsOf(form.cityId).map((d) => (
                  <option key={d.id} value={d.id}>
                    {localized(d.name, locale)}
                  </option>
                ))}
              </Select>
              {metrosOf(form.cityId).length > 0 && (
                <Select label={t('search.metro')} value={form.metroId ?? ''} onChange={(e) => set('metroId', e.target.value || null)}>
                  <option value="">{t('common.notSelected')}</option>
                  {metrosOf(form.cityId).map((m) => (
                    <option key={m.id} value={m.id}>
                      {localized(m.name, locale)}
                    </option>
                  ))}
                </Select>
              )}
              <Input label={t('wizard.address')} value={form.address} maxLength={200} error={errors.address} onChange={(e) => set('address', e.target.value)} placeholder={t('wizard.addressPlaceholder')} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1 font-medium"><PinIcon size={16} /> {t('wizard.mapPin')}</span>
                {form.lat != null && (
                  <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setForm((f) => ({ ...f, lat: null, lng: null }))}>
                    {t('common.clear')}
                  </button>
                )}
              </div>
              <div className="h-80 overflow-hidden rounded-xl border border-line">
                <LocationPicker lat={form.lat} lng={form.lng} center={[city?.lat ?? 40.4093, city?.lng ?? 49.8671]} onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />
              </div>
              <p className="mt-1 text-xs text-muted">{form.lat != null ? `${form.lat.toFixed(5)}, ${form.lng?.toFixed(5)}` : t('wizard.mapHint')}</p>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label={t('listing.facts.area')} required inputMode="decimal" suffix={t('common.sqm')} value={form.area} error={errors.area} onChange={(e) => set('area', e.target.value.replace(/[^\d.,]/g, ''))} />
              {hasLand && <Input label={t('listing.facts.landArea')} inputMode="decimal" suffix={t('common.sot')} value={form.landArea} error={errors.landArea} onChange={(e) => set('landArea', e.target.value.replace(/[^\d.,]/g, ''))} />}
              {hasRooms && <Input label={t('listing.facts.rooms')} required={['APARTMENT', 'HOUSE', 'ROOM'].includes(pt)} inputMode="numeric" value={form.rooms} error={errors.rooms} onChange={(e) => set('rooms', e.target.value.replace(/\D/g, ''))} />}
              {hasRooms && <Input label={t('listing.facts.bathrooms')} inputMode="numeric" value={form.bathrooms} error={errors.bathrooms} onChange={(e) => set('bathrooms', e.target.value.replace(/\D/g, ''))} />}
              {hasFloor && <Input label={t('listing.facts.floor')} inputMode="numeric" value={form.floor} error={errors.floor} onChange={(e) => set('floor', e.target.value.replace(/[^\d-]/g, ''))} />}
              {(hasFloor || pt === 'HOUSE') && <Input label={t('wizard.totalFloors')} inputMode="numeric" value={form.totalFloors} error={errors.totalFloors} onChange={(e) => set('totalFloors', e.target.value.replace(/\D/g, ''))} />}
              {pt !== 'LAND' && <Input label={t('listing.facts.yearBuilt')} inputMode="numeric" value={form.yearBuilt} error={errors.yearBuilt} onChange={(e) => set('yearBuilt', e.target.value.replace(/\D/g, ''))} />}
              {pt !== 'LAND' && <Input label={t('listing.facts.ceiling')} inputMode="decimal" suffix="m" value={form.ceilingHeight} error={errors.ceilingHeight} onChange={(e) => set('ceilingHeight', e.target.value.replace(/[^\d.,]/g, ''))} />}
            </div>
            {pt !== 'LAND' && (
              <div>
                <div className="mb-2 text-sm font-medium">{t('listing.facts.repair')}</div>
                <Chips value={form.repair} onChange={(v) => set('repair', (v as WizardForm['repair']) ?? null)} options={REPAIR_TYPES.map((r) => ({ value: r as string, label: t(`enums.repair.${r}`) }))} />
              </div>
            )}
            <div className="flex flex-col gap-3">
              <Toggle checked={form.hasDocument} onChange={(v) => set('hasDocument', v)} label={t('wizard.hasDocument')} />
              {form.dealType === 'SALE' && <Toggle checked={form.mortgageAvailable} onChange={(v) => set('mortgageAvailable', v)} label={t('wizard.mortgage')} />}
            </div>
            {daily && (
              <div className="rounded-xl border border-brand/20 bg-brand-50/50 p-4">
                <div className="mb-3 font-semibold">{t('wizard.dailyTitle')}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t('listing.facts.maxGuests')} required inputMode="numeric" value={form.maxGuests} error={errors.maxGuests} onChange={(e) => set('maxGuests', e.target.value.replace(/\D/g, ''))} />
                  <Input label={t('listing.facts.minNights')} inputMode="numeric" value={form.minNights} error={errors.minNights} onChange={(e) => set('minNights', e.target.value.replace(/\D/g, ''))} />
                  <Input label={t('booking.checkInFrom')} type="time" value={form.checkInTime} error={errors.checkInTime} onChange={(e) => set('checkInTime', e.target.value)} />
                  <Input label={t('booking.checkOutUntil')} type="time" value={form.checkOutTime} error={errors.checkOutTime} onChange={(e) => set('checkOutTime', e.target.value)} />
                </div>
                <div className="mt-4">
                  <Textarea label={t('listing.houseRules')} rows={3} maxLength={2000} value={form.houseRules} error={errors.houseRules} onChange={(e) => set('houseRules', e.target.value)} />
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 text-sm font-medium">{t('listing.amenities')}</div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {AMENITIES.map((a) => (
                  <Checkbox key={a} label={t(`enums.amenity.${a}`)} checked={form.amenities.includes(a)} onChange={(on) => set('amenities', on ? [...form.amenities, a] : form.amenities.filter((x) => x !== a))} />
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'photos' && <PhotoUploader photos={form.photos} onChange={(fn) => setForm((f) => ({ ...f, photos: fn(f.photos) }))} error={errors.imageIds} />}

        {step === 'price' && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Input
                label={form.dealType === 'SALE' ? t('wizard.price') : form.dealType === 'RENT_DAILY' ? t('wizard.pricePerNight') : t('wizard.pricePerMonth')}
                required
                inputMode="numeric"
                value={form.price}
                error={errors.price}
                onChange={(e) => set('price', e.target.value.replace(/\D/g, ''))}
              />
              <Select label={t('search.currency')} value={form.currency} onChange={(e) => set('currency', e.target.value as WizardForm['currency'])}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Input label={t('wizard.listingTitle')} required maxLength={120} value={form.title} error={errors.title} onChange={(e) => set('title', e.target.value)} hint={`${form.title.length}/120`} />
              <button type="button" onClick={suggestTitle} className="mt-1 text-sm font-semibold text-brand hover:underline">
                ✨ {t('wizard.suggestTitle')}
              </button>
            </div>
            <Textarea label={t('listing.description')} required rows={7} maxLength={5000} value={form.description} error={errors.description} onChange={(e) => set('description', e.target.value)} hint={t('wizard.descriptionHint', { n: form.description.trim().length })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={t('wizard.contactName')} required autoComplete="name" value={form.contactName} error={errors.contactName} onChange={(e) => set('contactName', e.target.value)} />
              <Input label={t('wizard.contactPhone')} required type="tel" autoComplete="tel" placeholder="050 123 45 67" value={form.contactPhone} error={errors.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-5">
            <div className="flex gap-4">
              <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl bg-surface">
                {form.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.photos[0].thumbUrl || form.photos[0].url} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold">{input.price ? formatPrice(input.price, form.currency) : '—'}</div>
                <div className="line-clamp-2 font-medium">{form.title || '—'}</div>
                <div className="text-sm text-muted">
                  {[localized(city?.name, locale), form.districtId && localized(getDistrict(form.districtId)?.name, locale), form.address].filter(Boolean).join(', ')}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {(
                [
                  [t('listing.facts.dealType'), t(`enums.dealType.${form.dealType}`)],
                  [t('listing.facts.propertyType'), t(`enums.propertyType.${pt}`)],
                  [t('listing.facts.area'), form.area ? `${form.area} ${t('common.sqm')}` : '—'],
                  hasRooms ? [t('listing.facts.rooms'), form.rooms || '—'] : null,
                  hasFloor ? [t('listing.facts.floor'), form.floor ? `${form.floor}${form.totalFloors ? ` / ${form.totalFloors}` : ''}` : '—'] : null,
                  [t('wizard.photosCount'), String(form.photos.filter((p) => p.id).length)],
                  [t('wizard.contactPhone'), form.contactPhone || '—'],
                  [t('listing.amenities'), String(form.amenities.length)],
                ].filter(Boolean) as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {Object.values(errors).some(Boolean) && <Alert tone="error">{t('wizard.fixErrors')}</Alert>}
            <p className="text-xs text-muted">{t('wizard.moderationNote')}</p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
          <Button variant="ghost" onClick={back} disabled={stepIdx === 0}>
            ← {t('common.back')}
          </Button>
          {step === 'review' ? (
            <Button size="lg" loading={submit.isPending} disabled={uploading} onClick={() => validate() && submit.mutate()}>
              {mode === 'create' ? t('wizard.publish') : t('wizard.saveChanges')}
            </Button>
          ) : (
            <Button size="lg" onClick={next}>
              {t('common.next')} →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
