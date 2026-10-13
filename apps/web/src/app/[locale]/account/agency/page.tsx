'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CITIES, agencySchema, localized, type Agency, type AgencyInput } from '@evtap/shared';
import { api, isApiError } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { PageHeader } from '@/components/account/PageHeader';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert, Badge, ErrorState, PageSpinner } from '@/components/ui/feedback';
import { Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { BuildingIcon, ShieldCheckIcon, UploadIcon } from '@/components/ui/icons';

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
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5" noValidate>
      {agency && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {agency.verified ? <Badge tone="brand" icon={<ShieldCheckIcon size={12} />}>{t('agency.verified')}</Badge> : <Badge tone="gray">{t('agency.notVerified')}</Badge>}
          <LinkButton size="sm" variant="ghost" href={href(`/agencies/${agency.slug}`)}>{t('agency.viewPublic')}</LinkButton>
        </div>
      )}
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface text-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <BuildingIcon size={32} />}
        </div>
        <Button variant="outline" size="sm" loading={uploading} icon={<UploadIcon size={16} />} onClick={() => file.current?.click()}>
          {t('agency.uploadLogo')}
        </Button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={t('agency.uploadLogo')} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </div>
      <Segmented value={f.type} onChange={(v) => setF((o) => ({ ...o, type: v }))} options={[{ value: 'AGENCY', label: t('enums.agencyType.AGENCY') }, { value: 'DEVELOPER', label: t('enums.agencyType.DEVELOPER') }]} />
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
    </form>
  );
}

export default function AgencyPage() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.agencyMe, queryFn: () => api.agencies.me().catch((e) => (isApiError(e) && e.status === 404 ? null : Promise.reject(e))), retry: false });
  return (
    <div>
      <PageHeader title={t('account.nav.agency')} sub={t('agency.sub')} />
      {q.isLoading ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState title={t('agency.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <>
          {!q.data && <Alert tone="info" className="mb-4">{t('agency.createIntro')}</Alert>}
          <AgencyForm agency={q.data ?? null} />
        </>
      )}
    </div>
  );
}
