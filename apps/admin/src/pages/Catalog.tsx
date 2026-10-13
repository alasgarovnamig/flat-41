import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Save } from 'lucide-react';
import { localized, planUpdateSchema, serviceUpdateSchema, type BundleDef, type PlanDef, type ServiceDef } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { FormField, Input, MoneyInput, Toggle } from '../components/FormField';
import { Badge } from '../components/StatusBadge';
import { Button, Card, ErrorState, PageHeader, SkeletonBlock, cx } from '../components/ui';
import { getLang, useT } from '../i18n';
import { enumLabel, inputToMinor, minorToInput, money } from '../lib/format';

export default function CatalogPage() {
  const { t } = useT();
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'catalog'], queryFn: api.getAdminCatalog });

  return (
    <div>
      <PageHeader
        title={t('Catalog & pricing')}
        subtitle={t('Prices are stored in qəpik (minor units) and entered here in ₼. Changes apply to new purchases immediately.')}
        actions={!isAdmin && <span className="inline-flex items-center gap-1 text-xs text-muted"><Lock className="size-3.5" /> {t('Read-only for moderators')}</span>}
      />
      {q.isLoading ? (
        <Card>
          <SkeletonBlock rows={10} />
        </Card>
      ) : q.error || !q.data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card title={t('Promotion services')} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-hover/60 text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('Service')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('Type')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('Duration')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('Price')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('Active')}</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {[...q.data.services]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((s) => (
                      <ServiceRow key={s.code} service={s} editable={isAdmin} />
                    ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div>
            <h2 className="mb-3 text-[15px] font-semibold">{t('Business plans')}</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {q.data.plans.map((p) => (
                <PlanCard key={p.code} plan={p} editable={isAdmin} />
              ))}
            </div>
          </div>

          <Card title={t('Bundles')} actions={<Badge>{t('Read-only')}</Badge>}>
            <div className="grid gap-3 md:grid-cols-2">
              {q.data.bundles.map((b) => (
                <BundleCard key={b.code} bundle={b} services={q.data.services} />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function ServiceRow({ service: s, editable }: { service: ServiceDef; editable: boolean }) {
  const { t } = useT();
  const [price, setPrice] = useState(minorToInput(s.price));
  const [duration, setDuration] = useState(String(s.durationDays));
  const [active, setActive] = useState(s.active);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPrice(minorToInput(s.price));
    setDuration(String(s.durationDays));
    setActive(s.active);
  }, [s]);
  const save = useAction((body: api.ServiceUpdate) => api.updateService(s.code, body), { success: t('{code} updated', { code: s.code }), invalidate: [['admin', 'catalog'], ['catalog']] });

  const body: api.ServiceUpdate = {};
  const p = inputToMinor(price);
  if (p !== s.price) body.price = p ?? -1;
  if (Number(duration) !== s.durationDays) body.durationDays = Number(duration);
  if (active !== s.active) body.active = active;
  const dirty = Object.keys(body).length > 0;
  const submit = () => {
    const parsed = serviceUpdateSchema.safeParse(body);
    if (!parsed.success) return setError(t('Check price and duration (non-negative numbers).'));
    setError(null);
    save.mutate(parsed.data);
  };
  const isBump = s.promotionType === 'BUMP';
  return (
    <tr className={cx('border-b border-line last:border-0', !active && 'opacity-60')}>
      <td className="px-4 py-2.5">
        <p className="font-medium">{localized(s.name, getLang())}</p>
        <code className="text-xs text-muted">{s.code}</code>
      </td>
      <td className="px-4 py-2.5">{s.promotionType ? <Badge tone="brand">{enumLabel(s.promotionType)}</Badge> : <Badge>{t('Verification')}</Badge>}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="w-20"><Input className="tabular-nums" inputMode="numeric" value={duration} disabled={!editable} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} aria-label={t('Duration')} /></div>
          <span className="text-xs whitespace-nowrap text-muted">{isBump ? t('bumps') : t('days')}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <MoneyInput className="w-28" value={price} disabled={!editable} onChange={(e) => setPrice(e.target.value)} invalid={!!error} aria-label={t('Price')} />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </td>
      <td className="px-4 py-2.5">
        <Toggle checked={active} disabled={!editable} onChange={setActive} />
      </td>
      <td className="px-4 py-2.5 text-right">
        {editable && (
          <Button size="sm" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} loading={save.isPending} onClick={submit} icon={<Save className="size-3.5" />}>
            {t('Save')}
          </Button>
        )}
      </td>
    </tr>
  );
}

const PLAN_NUM_FIELDS = [
  ['listingQuota', 'Active listings quota', '-1 = unlimited'],
  ['monthlyBumps', 'Monthly bumps', ''],
  ['monthlyVipCredits', 'VIP-7 credits / month', ''],
  ['monthlyPremiumCredits', 'Premium-7 credits / month', ''],
  ['maxAgents', 'Max agents', ''],
] as const;

function PlanCard({ plan, editable }: { plan: PlanDef; editable: boolean }) {
  const { t } = useT();
  const init = () => ({
    priceMonthly: minorToInput(plan.priceMonthly),
    priceYearly: minorToInput(plan.priceYearly),
    ...Object.fromEntries(PLAN_NUM_FIELDS.map(([k]) => [k, String(plan[k])])),
  });
  const [form, setForm] = useState<Record<string, string>>(init);
  const [active, setActive] = useState(plan.active);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setForm(init());
    setActive(plan.active);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction((body: api.PlanUpdate) => api.updatePlan(plan.code, body), { success: t('Plan {code} updated', { code: plan.code }), invalidate: [['admin', 'catalog'], ['catalog']] });

  const body: Record<string, number | boolean> = {};
  const pm = inputToMinor(form.priceMonthly);
  const py = inputToMinor(form.priceYearly);
  if (pm !== plan.priceMonthly) body.priceMonthly = pm ?? -1;
  if (py !== plan.priceYearly) body.priceYearly = py ?? -1;
  for (const [k] of PLAN_NUM_FIELDS) if (Number(form[k]) !== plan[k]) body[k] = form[k] === '' ? NaN : Number(form[k]);
  if (active !== plan.active) body.active = active;
  const dirty = Object.keys(body).length > 0;
  const yearlyDiscount = pm && py ? Math.round((1 - py / (pm * 12)) * 100) : null;

  const submit = () => {
    const parsed = planUpdateSchema.safeParse(body);
    if (!parsed.success) return setError(t('Invalid value: {f}', { f: String(parsed.error.issues[0]?.path[0] ?? '') }));
    setError(null);
    save.mutate(parsed.data);
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {localized(plan.name, getLang())} <code className="text-xs font-normal text-muted">{plan.code}</code>
        </span>
      }
      actions={<Toggle size="sm" checked={active} disabled={!editable} onChange={setActive} label={<span className="text-xs">{t('Active')}</span>} />}
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('Monthly price')}>
          <MoneyInput value={form.priceMonthly} disabled={!editable} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} />
        </FormField>
        <FormField label={t('Yearly price')} hint={yearlyDiscount != null ? t('{n}% off vs monthly', { n: yearlyDiscount }) : undefined}>
          <MoneyInput value={form.priceYearly} disabled={!editable} onChange={(e) => setForm({ ...form, priceYearly: e.target.value })} />
        </FormField>
        {PLAN_NUM_FIELDS.map(([k, label, hint]) => (
          <FormField key={k} label={t(label)} hint={hint ? t(hint) : undefined}>
            <Input inputMode="numeric" className="tabular-nums" value={form[k]} disabled={!editable} onChange={(e) => setForm({ ...form, [k]: e.target.value.replace(/[^\d-]/g, '') })} />
          </FormField>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {plan.features.map((f) => (
          <Badge key={f}>{f.replace(/_/g, ' ')}</Badge>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {editable && (
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={submit} icon={<Save className="size-3.5" />}>
            {t('Save plan')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function BundleCard({ bundle, services }: { bundle: BundleDef; services: ServiceDef[] }) {
  const { t } = useT();
  const sum = bundle.serviceCodes.reduce((a, c) => a + (services.find((s) => s.code === c)?.price ?? 0), 0);
  const saving = sum > 0 ? Math.round((1 - bundle.price / sum) * 100) : 0;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{localized(bundle.name, getLang())}</p>
          <code className="text-xs text-muted">{bundle.code}</code>
        </div>
        <div className="text-right">
          <p className="font-semibold">{money(bundle.price)}</p>
          <p className="text-xs text-muted">
            <s>{money(sum)}</s> · −{saving}%
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {bundle.serviceCodes.map((c) => (
          <Badge key={c} tone="brand">
            {c}
          </Badge>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t('Bundles are defined in code (packages/shared/pricing.ts).')}</p>
    </div>
  );
}
