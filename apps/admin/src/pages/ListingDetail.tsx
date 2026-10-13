import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Gift, RotateCcw, Save, X } from 'lucide-react';
import {
  AMENITIES, CITIES, CURRENCIES, DEAL_TYPES, PROPERTY_TYPES, REPAIR_TYPES, districtsOf, localized, metrosOf, updateListingSchema,
} from '@evtap/shared';
import * as api from '../api/client';
import type { AdminListingDetail } from '../api/client';
import { useAction, useCatalogForPromote } from '../api/queries';
import { AdminOnly } from '../auth/guards';
import { FormField, Input, Select, Textarea, Toggle } from '../components/FormField';
import { useCrumb } from '../components/Layout';
import { Gallery, OwnerCard, PromoBadges, ReportsList, SiteLink, listingPrice } from '../components/listing';
import { Modal } from '../components/Modal';
import { BLOCK_PRESETS, REJECT_PRESETS, ReasonDialog } from '../components/ReasonDialog';
import { Badge, StatusBadge } from '../components/StatusBadge';
import { Button, Card, ErrorState, KeyValue, PageHeader, Skeleton, SkeletonBlock, cx } from '../components/ui';
import { getLang, useT } from '../i18n';
import { enumLabel, fmtDate, fmtDateTime, fmtNumber, money, shortId } from '../lib/format';

type FormState = Record<string, string | boolean | string[]>;

const TEXT = ['title', 'description', 'address', 'houseRules', 'contactName', 'contactPhone', 'checkInTime', 'checkOutTime'] as const;
const SELECT = ['dealType', 'propertyType', 'buildingType', 'currency', 'cityId', 'districtId', 'metroId', 'repair'] as const;
const INT = ['price', 'rooms', 'bathrooms', 'floor', 'totalFloors', 'yearBuilt', 'maxGuests', 'minNights'] as const;
const FLOAT = ['area', 'landArea', 'ceilingHeight', 'lat', 'lng'] as const;
const BOOL = ['hasDocument', 'mortgageAvailable'] as const;
const REQUIRED = new Set(['title', 'description', 'price', 'currency', 'cityId', 'area', 'dealType', 'propertyType', 'contactName']);

function toForm(d: AdminListingDetail): FormState {
  const f: FormState = {};
  const rec = d as unknown as Record<string, unknown>;
  for (const k of [...TEXT, ...SELECT, ...INT, ...FLOAT]) f[k] = rec[k] == null ? '' : String(rec[k]);
  for (const k of BOOL) f[k] = !!rec[k];
  f.amenities = [...d.amenities];
  f.contactPhone = ''; // only a masked phone is returned; empty = keep
  return f;
}

function fieldValue(k: string, v: string | boolean | string[]): unknown {
  if (typeof v === 'boolean' || Array.isArray(v)) return v;
  const s = v.trim();
  if ((INT as readonly string[]).includes(k) || (FLOAT as readonly string[]).includes(k)) {
    if (s === '') return REQUIRED.has(k) ? undefined : null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : s;
  }
  if (s === '') return REQUIRED.has(k) ? '' : null;
  return s;
}

/** Only changed fields are sent (PATCH semantics). */
function diff(initial: FormState, form: FormState) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(form)) {
    if (k === 'contactPhone') {
      if (String(form[k]).trim()) out[k] = String(form[k]).trim();
      continue;
    }
    const a = fieldValue(k, initial[k]);
    const b = fieldValue(k, form[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
  }
  return out;
}

export default function ListingDetailPage() {
  const { id = '' } = useParams();
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'listing', id], queryFn: () => api.getAdminListing(id) });
  useCrumb(q.data?.title ?? `#${shortId(id)}`);
  const [dialog, setDialog] = useState<'reject' | 'block' | 'promote' | null>(null);

  const invalidate = [['admin', 'listing', id], ['admin', 'listings'], ['admin', 'overview']];
  const approve = useAction(() => api.approveListing(id), { success: t('Listing approved'), invalidate });
  const reject = useAction((reason: string) => api.rejectListing(id, reason), { success: t('Listing rejected'), invalidate, onSuccess: () => setDialog(null) });
  const block = useAction((reason: string) => api.blockListing(id, reason), { success: t('Listing blocked'), invalidate, onSuccess: () => setDialog(null) });

  if (q.isLoading)
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <Skeleton className="aspect-[16/9] w-full" />
          <div className="mt-4">
            <SkeletonBlock rows={8} />
          </div>
        </Card>
        <Card>
          <SkeletonBlock rows={6} />
        </Card>
      </div>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState error={q.error ?? new Error('Not found')} onRetry={() => q.refetch()} />
      </Card>
    );

  const l = q.data;
  const images = l.images?.length ? [...l.images].sort((a, b) => a.order - b.order) : l.coverUrl ? [{ url: l.coverUrl, thumbUrl: l.coverUrl }] : [];
  const busy = approve.isPending || reject.isPending || block.isPending;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {l.title} <StatusBadge status={l.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {listingPrice(l)} · #{shortId(l.id)} · {t('created {d}', { d: fmtDateTime(l.createdAt) })}
            </span>
            <PromoBadges l={l} />
          </span>
        }
        actions={
          <>
            <SiteLink id={l.id} />
            {l.status !== 'ACTIVE' && (
              <Button variant="success" size="sm" icon={<Check className="size-4" />} loading={approve.isPending} disabled={busy} onClick={() => approve.mutate(undefined)}>
                {t('Approve')}
              </Button>
            )}
            {(l.status === 'PENDING' || l.status === 'ACTIVE') && (
              <Button variant="danger-soft" size="sm" icon={<X className="size-4" />} disabled={busy} onClick={() => setDialog('reject')}>
                {t('Reject')}
              </Button>
            )}
            {l.status !== 'BLOCKED' && (
              <Button size="sm" icon={<Ban className="size-4" />} disabled={busy} onClick={() => setDialog('block')}>
                {t('Block')}
              </Button>
            )}
            <AdminOnly>
              <Button size="sm" variant="primary" icon={<Gift className="size-4" />} onClick={() => setDialog('promote')}>
                {t('Free promotion')}
              </Button>
            </AdminOnly>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <Gallery images={images} />
          </Card>
          <EditForm listing={l} />
        </div>
        <div className="space-y-4">
          <Card title={t('Status')}>
            <KeyValue
              cols={2}
              items={[
                [t('Status'), <StatusBadge key="s" status={l.status} />],
                [t('Published'), fmtDate(l.publishedAt)],
                [t('Expires'), fmtDate(l.expiresAt)],
                [t('Updated'), fmtDateTime(l.updatedAt)],
                [t('Views'), fmtNumber(l.views)],
                [t('Favorites'), fmtNumber(l.favoritesCount)],
              ]}
            />
            {l.rejectionReason && (
              <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                <span className="font-medium">{t('Reason')}:</span> {l.rejectionReason}
              </div>
            )}
            {l.promotions?.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-muted">{t('Active promotions')}</p>
                <ul className="space-y-1 text-sm">
                  {l.promotions.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <Badge tone="brand">{p.serviceCode}</Badge>
                      <span className="text-xs text-muted">{p.endsAt ? t('until {d}', { d: fmtDate(p.endsAt) }) : p.bumpsLeft != null ? t('{n} bumps left', { n: p.bumpsLeft }) : '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <Card title={t('Owner')}>
            <OwnerCard l={l} />
          </Card>
          <Card title={`${t('Reports')} (${l.reports?.length ?? 0})`}>
            <ReportsList reports={l.reports ?? []} />
          </Card>
        </div>
      </div>

      <ReasonDialog open={dialog === 'reject'} title={t('Reject listing')} presets={REJECT_PRESETS} confirmLabel={t('Reject')} busy={reject.isPending} onCancel={() => setDialog(null)} onSubmit={(r) => reject.mutate(r)} />
      <ReasonDialog open={dialog === 'block'} title={t('Block listing')} presets={BLOCK_PRESETS} confirmLabel={t('Block')} busy={block.isPending} onCancel={() => setDialog(null)} onSubmit={(r) => block.mutate(r)} />
      <PromoteDialog open={dialog === 'promote'} listingId={l.id} onClose={() => setDialog(null)} />
    </div>
  );
}

function PromoteDialog({ open, listingId, onClose }: { open: boolean; listingId: string; onClose: () => void }) {
  const { t } = useT();
  const catalog = useCatalogForPromote();
  const [code, setCode] = useState('');
  const services = (catalog.data?.services ?? []).filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const promote = useAction((serviceCode: string) => api.promoteListing(listingId, serviceCode), {
    success: t('Promotion applied for free'),
    invalidate: [['admin', 'listing', listingId], ['admin', 'listings']],
    onSuccess: onClose,
  });
  useEffect(() => {
    if (open) setCode('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Give a free promotion')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" disabled={!code} loading={promote.isPending} onClick={() => promote.mutate(code)}>
            {t('Apply for free')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{t('Used for compensation or partner deals. No payment is created; the action is written to the audit log.')}</p>
      {catalog.isLoading ? (
        <SkeletonBlock rows={4} />
      ) : (
        <div role="radiogroup" className="grid gap-1.5 sm:grid-cols-2">
          {services.map((s) => (
            <button
              key={s.code}
              role="radio"
              aria-checked={code === s.code}
              onClick={() => setCode(s.code)}
              className={cx('rounded-lg border px-3 py-2 text-left text-sm', code === s.code ? 'border-brand bg-brand-soft' : 'border-line hover:bg-hover')}
            >
              <span className="block font-medium">{localized(s.name, getLang())}</span>
              <span className="text-xs text-muted">
                {s.code} · <s>{money(s.price)}</s>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function EditForm({ listing }: { listing: AdminListingDetail }) {
  const { t } = useT();
  const initial = useMemo(() => toForm(listing), [listing]);
  const [form, setForm] = useState<FormState>(initial);
  const [verified, setVerified] = useState(listing.isVerified);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setForm(initial);
    setVerified(listing.isVerified);
    setErrors({});
  }, [initial, listing.isVerified]);

  const changes = useMemo(() => diff(initial, form), [initial, form]);
  const dirty = Object.keys(changes).length > 0 || verified !== listing.isVerified;

  const save = useAction((body: api.AdminListingUpdate) => api.updateAdminListing(listing.id, body), {
    success: t('Listing saved'),
    invalidate: [['admin', 'listing', listing.id], ['admin', 'listings']],
  });

  const submit = () => {
    const parsed = updateListingSchema.safeParse(changes);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    const body: api.AdminListingUpdate = { ...(changes as api.AdminListingUpdate) };
    if (verified !== listing.isVerified) body.isVerified = verified;
    save.mutate(body);
  };

  const set = (k: string, v: string | boolean | string[]) => setForm((f) => ({ ...f, [k]: v }));
  const str = (k: string) => String(form[k] ?? '');
  const text = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <FormField label={label} error={errors[k]}>
      <Input value={str(k)} onChange={(e) => set(k, e.target.value)} invalid={!!errors[k]} {...props} />
    </FormField>
  );
  const num = (k: string, label: string) => text(k, label, { inputMode: 'decimal', className: 'tabular-nums' });
  const lang = getLang();
  const city = str('cityId');
  const opt = (values: readonly string[]) => values.map((v) => ({ value: v, label: enumLabel(v) }));

  return (
    <Card
      title={t('Edit listing')}
      actions={
        <>
          {dirty && <span className="text-xs text-warning">{t('Unsaved changes')}</span>}
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!dirty} onClick={() => { setForm(initial); setVerified(listing.isVerified); setErrors({}); }}>
            {t('Reset')}
          </Button>
          <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} disabled={!dirty} loading={save.isPending} onClick={submit}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Group title={t('Basics')}>
          <div className="sm:col-span-2 lg:col-span-3">{text('title', t('Title'), { maxLength: 120 })}</div>
          <FormField label={t('Deal type')} error={errors.dealType}>
            <Select value={str('dealType')} onChange={(e) => set('dealType', e.target.value)} options={opt(DEAL_TYPES)} />
          </FormField>
          <FormField label={t('Property type')} error={errors.propertyType}>
            <Select value={str('propertyType')} onChange={(e) => set('propertyType', e.target.value)} options={opt(PROPERTY_TYPES)} />
          </FormField>
          <FormField label={t('Building')} error={errors.buildingType}>
            <Select value={str('buildingType')} onChange={(e) => set('buildingType', e.target.value)} placeholder="—" options={opt(['NEW', 'SECONDARY'])} />
          </FormField>
          {num('price', t('Price (major units)'))}
          <FormField label={t('Currency')} error={errors.currency}>
            <Select value={str('currency')} onChange={(e) => set('currency', e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </FormField>
          <div className="sm:col-span-2 lg:col-span-3">
            <FormField label={t('Description')} error={errors.description}>
              <Textarea rows={6} value={str('description')} onChange={(e) => set('description', e.target.value)} invalid={!!errors.description} maxLength={5000} />
            </FormField>
          </div>
        </Group>

        <Group title={t('Location')}>
          <FormField label={t('City')} error={errors.cityId}>
            <Select
              value={city}
              onChange={(e) => setForm((f) => ({ ...f, cityId: e.target.value, districtId: '', metroId: '' }))}
              options={CITIES.map((c) => ({ value: c.id, label: localized(c.name, lang) }))}
            />
          </FormField>
          <FormField label={t('District')} error={errors.districtId}>
            <Select value={str('districtId')} onChange={(e) => set('districtId', e.target.value)} placeholder="—" options={districtsOf(city).map((d) => ({ value: d.id, label: localized(d.name, lang) }))} />
          </FormField>
          <FormField label={t('Metro')} error={errors.metroId}>
            <Select value={str('metroId')} onChange={(e) => set('metroId', e.target.value)} placeholder="—" options={metrosOf(city).map((m) => ({ value: m.id, label: localized(m.name, lang) }))} />
          </FormField>
          <div className="sm:col-span-2 lg:col-span-1">{text('address', t('Address'))}</div>
          {num('lat', t('Latitude'))}
          {num('lng', t('Longitude'))}
        </Group>

        <Group title={t('Property details')}>
          {num('area', t('Area, m²'))}
          {num('landArea', t('Land area, sot'))}
          {num('rooms', t('Rooms'))}
          {num('bathrooms', t('Bathrooms'))}
          {num('floor', t('Floor'))}
          {num('totalFloors', t('Total floors'))}
          {num('yearBuilt', t('Year built'))}
          {num('ceilingHeight', t('Ceiling height, m'))}
          <FormField label={t('Repair')} error={errors.repair}>
            <Select value={str('repair')} onChange={(e) => set('repair', e.target.value)} placeholder="—" options={opt(REPAIR_TYPES)} />
          </FormField>
          <div className="flex flex-wrap items-center gap-5 sm:col-span-2 lg:col-span-3">
            <Toggle checked={!!form.hasDocument} onChange={(v) => set('hasDocument', v)} label={t('Title deed (kupça)')} />
            <Toggle checked={!!form.mortgageAvailable} onChange={(v) => set('mortgageAvailable', v)} label={t('Mortgage available')} />
            <Toggle checked={verified} onChange={setVerified} label={t('Verified badge')} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="mb-1.5 text-xs font-medium text-muted">{t('Amenities')}</p>
            <div className="flex flex-wrap gap-1.5">
              {AMENITIES.map((a) => {
                const on = (form.amenities as string[]).includes(a);
                return (
                  <button
                    type="button"
                    key={a}
                    aria-pressed={on}
                    onClick={() => set('amenities', on ? (form.amenities as string[]).filter((x) => x !== a) : [...(form.amenities as string[]), a])}
                    className={cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-brand bg-brand-soft text-brand-fg' : 'border-line-strong text-muted hover:bg-hover')}
                  >
                    {enumLabel(a)}
                  </button>
                );
              })}
            </div>
          </div>
        </Group>

        {str('dealType') === 'RENT_DAILY' && (
          <Group title={t('Daily rent')}>
            {num('maxGuests', t('Max guests'))}
            {num('minNights', t('Min nights'))}
            {text('checkInTime', t('Check-in time'), { placeholder: '14:00' })}
            {text('checkOutTime', t('Check-out time'), { placeholder: '12:00' })}
            <div className="sm:col-span-2 lg:col-span-3">
              <FormField label={t('House rules')} error={errors.houseRules}>
                <Textarea value={str('houseRules')} onChange={(e) => set('houseRules', e.target.value)} />
              </FormField>
            </div>
          </Group>
        )}

        <Group title={t('Contact')}>
          {text('contactName', t('Contact name'))}
          {text('contactPhone', t('Contact phone'), { placeholder: listing.contactPhoneMasked + ' — ' + t('leave empty to keep') })}
        </Group>
        <button type="submit" hidden />
      </form>
    </Card>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-[13px] font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}
