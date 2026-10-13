'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CITIES, agencySchema, localized, type Agency, type AgencyInput } from '@evtap/shared';
import { api, isApiError } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, ErrorState, Input, LinkButton, Notice, PageHeader, PageSpinner, Segmented, Select, Textarea } from '@/components/ds';
import { ArrowUpRightIcon, BuildingIcon, UploadIcon } from '@/components/ds/icons';

type FormState = { name: string; type: 'AGENCY' | 'DEVELOPER'; description: string; phone: string; email: string; website: string; address: string; cityId: string; logoUrl: string };

const toForm = (a?: Agency | null): FormState => ({
  name: a?.name ?? '', type: a?.type ?? 'AGENCY', description: a?.description ?? '', phone: a?.phone ?? '', email: a?.email ?? '',
  website: a?.website ?? '', address: a?.address ?? '', cityId: a?.cityId ?? 'baku', logoUrl: a?.logoUrl ?? '',
});
const nul = (s: string) => (s.trim() === '' ? null : s.trim());

function AgencyForm({ agency }: { agency: Agency | null }) {
  const { t, locale, href } = useI18n();
  const { refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => toForm(agency));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setF(toForm(agency)), [agency]);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: (body: AgencyInput) => (agency ? api.agencies.updateMe(body) : api.agencies.create(body)),
    onSuccess: (a) => {
      qc.setQueryData(qk.agencyMe, a);
      refresh();
      toast.success(agency ? t('agency.saved') : t('agency.created'));
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: f.name, type: f.type, description: nul(f.description), phone: nul(f.phone), email: nul(f.email), website: nul(f.website), address: nul(f.address), cityId: nul(f.cityId), logoUrl: nul(f.logoUrl) };
    const r = agencySchema.safeParse(body);
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    save.mutate(r.data);
  };
  const upload = async (fl: File) => {
    setUploading(true);
    try {
      const u = await api.upload(fl);
      setF((o) => ({ ...o, logoUrl: assetUrl(u.url) ?? u.url }));
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setUploading(false);
    }
  };
  const logo = assetUrl(f.logoUrl);
  return (
    <Card as="form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {agency && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {agency.verified ? <Badge tone="verified" size="md">{t('agency.verified')}</Badge> : <Badge tone="neutral" size="md">{t('agency.notVerified')}</Badge>}
          <LinkButton size="sm" variant="secondary" href={href(`/agencies/${agency.slug}`)} trailing={<ArrowUpRightIcon size={15} />}>{t('agency.viewPublic')}</LinkButton>
        </div>
      )}
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-surface-raised text-muted shadow-pill">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <BuildingIcon size={32} />}
        </div>
        <Button variant="secondary" size="sm" loading={uploading} icon={<UploadIcon size={16} />} onClick={() => file.current?.click()}>
          {t('agency.uploadLogo')}
        </Button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={t('agency.uploadLogo')} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </div>
      <Segmented ariaLabel={t('agency.type')} value={f.type} onChange={(v) => setF((o) => ({ ...o, type: v }))} options={[{ value: 'AGENCY', label: t('enums.agencyType.AGENCY') }, { value: 'DEVELOPER', label: t('enums.agencyType.DEVELOPER') }]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('agency.name')} required value={f.name} onChange={set('name')} error={errors.name} />
        <Select label={t('search.city')} value={f.cityId} onChange={set('cityId')}>
          {CITIES.map((c) => <option key={c.id} value={c.id}>{localized(c.name, locale)}</option>)}
        </Select>
        <Input label={t('form.phone')} type="tel" value={f.phone} onChange={set('phone')} error={errors.phone} placeholder="012 123 45 67" />
        <Input label={t('form.email')} type="email" value={f.email} onChange={set('email')} error={errors.email} />
        <Input label={t('agency.website')} type="url" value={f.website} onChange={set('website')} error={errors.website} placeholder="https://" />
        <Input label={t('wizard.address')} value={f.address} onChange={set('address')} error={errors.address} />
      </div>
      <Textarea label={t('listing.description')} rows={5} maxLength={5000} value={f.description} onChange={set('description')} error={errors.description} />
      <div>
        <Button type="submit" size="lg" loading={save.isPending}>{agency ? t('common.save') : t('agency.create')}</Button>
      </div>
    </Card>
  );
}

export default function AgencyPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const hasAgency = !!user?.agencyId;
  // no agency yet → no request (avoids a 404); the form creates one
  const q = useQuery({ queryKey: qk.agencyMe, queryFn: () => api.agencies.me().catch((e) => (isApiError(e) && e.status === 404 ? null : Promise.reject(e))), retry: false, enabled: hasAgency });
  return (
    <div>
      <PageHeader title={t('account.nav.agency')} sub={t('agency.sub')} />
      {hasAgency && q.isLoading ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState title={t('agency.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <>
          {!q.data && <Notice tone="info" className="mb-4">{t('agency.createIntro')}</Notice>}
          <AgencyForm agency={q.data ?? null} />
        </>
      )}
    </div>
  );
}
