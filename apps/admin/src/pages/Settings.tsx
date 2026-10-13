import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { calcBooking, settingsUpdateSchema, topupBonus, type PlatformSettings } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { FormField, Input, MoneyInput, Toggle } from '../components/FormField';
import { useConfirm } from '../components/Modal';
import { Button, Card, ErrorState, PageHeader, SkeletonBlock } from '../components/ui';
import { useT } from '../i18n';
import { inputToMinor, minorToInput, money } from '../lib/format';

type Form = {
  freeListingsPerMonth: string;
  listingFee: string;
  listingLifetimeDays: string;
  dailyRentGuestFeePercent: string;
  dailyRentHostFeePercent: string;
  payoutDelayHours: string;
  freeCancellationHours: string;
  minTopup: string;
  maxTopup: string;
  moderationEnabled: boolean;
  topupBonuses: { minAmount: string; bonusPercent: string }[];
};

const toForm = (s: PlatformSettings): Form => ({
  freeListingsPerMonth: String(s.freeListingsPerMonth),
  listingFee: minorToInput(s.listingFee),
  listingLifetimeDays: String(s.listingLifetimeDays),
  dailyRentGuestFeePercent: String(s.dailyRentGuestFeePercent),
  dailyRentHostFeePercent: String(s.dailyRentHostFeePercent),
  payoutDelayHours: String(s.payoutDelayHours),
  freeCancellationHours: String(s.freeCancellationHours),
  minTopup: minorToInput(s.minTopup),
  maxTopup: minorToInput(s.maxTopup),
  moderationEnabled: s.moderationEnabled,
  topupBonuses: [...s.topupBonuses].sort((a, b) => a.minAmount - b.minAmount).map((b) => ({ minAmount: minorToInput(b.minAmount), bonusPercent: String(b.bonusPercent) })),
});

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

const fromForm = (f: Form): PlatformSettings => ({
  freeListingsPerMonth: num(f.freeListingsPerMonth),
  listingFee: inputToMinor(f.listingFee) ?? NaN,
  listingLifetimeDays: num(f.listingLifetimeDays),
  dailyRentGuestFeePercent: num(f.dailyRentGuestFeePercent),
  dailyRentHostFeePercent: num(f.dailyRentHostFeePercent),
  payoutDelayHours: num(f.payoutDelayHours),
  freeCancellationHours: num(f.freeCancellationHours),
  minTopup: inputToMinor(f.minTopup) ?? NaN,
  maxTopup: inputToMinor(f.maxTopup) ?? NaN,
  moderationEnabled: f.moderationEnabled,
  topupBonuses: f.topupBonuses.map((b) => ({ minAmount: inputToMinor(b.minAmount) ?? NaN, bonusPercent: num(b.bonusPercent) })),
});

export default function SettingsPage() {
  const { t } = useT();
  const { confirm } = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: api.getSettings });
  const initial = useMemo(() => (q.data ? toForm(q.data) : null), [q.data]);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setForm(initial), [initial]);

  const save = useAction(api.updateSettings, { success: t('Settings saved'), invalidate: [['admin', 'settings'], ['catalog'], ['admin', 'catalog']] });

  if (q.isLoading || (!form && !q.error))
    return (
      <Card>
        <SkeletonBlock rows={10} />
      </Card>
    );
  if (q.error || !form || !q.data)
    return (
      <>
        <PageHeader title={t('Platform settings')} />
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      </>
    );

  const values = fromForm(form);
  const original = q.data;
  const changes = Object.fromEntries(Object.entries(values).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(original[k as keyof PlatformSettings])));
  const dirty = Object.keys(changes).length > 0;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  const submit = async () => {
    const parsed = settingsUpdateSchema.safeParse(changes);
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] = t('Invalid value');
    if (values.minTopup > values.maxTopup) errs.maxTopup = t('Must be ≥ minimum top-up');
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;
    if (changes.moderationEnabled === false) {
      const ok = await confirm({ title: t('Turn off moderation?'), message: t('New and edited listings will go live immediately without review.'), confirmLabel: t('Turn off'), tone: 'danger' });
      if (!ok) return;
    }
    save.mutate(parsed.data);
  };

  // live examples
  const ex = Number.isFinite(values.dailyRentGuestFeePercent) && Number.isFinite(values.dailyRentHostFeePercent) ? calcBooking(100, 3, values) : null;
  const bonusOk = values.topupBonuses.every((b) => Number.isFinite(b.minAmount) && Number.isFinite(b.bonusPercent));

  return (
    <div className="pb-20">
      <PageHeader title={t('Platform settings')} subtitle={t('Business rules applied across web, mobile and API.')} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title={t('Listings')}>
          <Grid>
            <F label={t('Free listings per 30 days')} hint={t('Individuals, sale & long-term rent')} error={errors.freeListingsPerMonth}>
              <Input inputMode="numeric" value={form.freeListingsPerMonth} onChange={(e) => set('freeListingsPerMonth', e.target.value)} />
            </F>
            <F label={t('Listing fee after quota')} error={errors.listingFee}>
              <MoneyInput value={form.listingFee} onChange={(e) => set('listingFee', e.target.value)} />
            </F>
            <F label={t('Listing lifetime, days')} error={errors.listingLifetimeDays}>
              <Input inputMode="numeric" value={form.listingLifetimeDays} onChange={(e) => set('listingLifetimeDays', e.target.value)} />
            </F>
            <div className="flex items-end pb-2">
              <Toggle checked={form.moderationEnabled} onChange={(v) => set('moderationEnabled', v)} label={t('Pre-moderation enabled')} />
            </div>
          </Grid>
        </Card>

        <Card title={t('Daily rent (bookings)')}>
          <Grid>
            <F label={t('Guest service fee, %')} error={errors.dailyRentGuestFeePercent}>
              <Input inputMode="decimal" value={form.dailyRentGuestFeePercent} onChange={(e) => set('dailyRentGuestFeePercent', e.target.value)} />
            </F>
            <F label={t('Host commission, %')} error={errors.dailyRentHostFeePercent}>
              <Input inputMode="decimal" value={form.dailyRentHostFeePercent} onChange={(e) => set('dailyRentHostFeePercent', e.target.value)} />
            </F>
            <F label={t('Payout delay after check-in, h')} error={errors.payoutDelayHours}>
              <Input inputMode="numeric" value={form.payoutDelayHours} onChange={(e) => set('payoutDelayHours', e.target.value)} />
            </F>
            <F label={t('Free cancellation, h before check-in')} error={errors.freeCancellationHours}>
              <Input inputMode="numeric" value={form.freeCancellationHours} onChange={(e) => set('freeCancellationHours', e.target.value)} />
            </F>
          </Grid>
          {ex && (
            <p className="mt-3 rounded-lg bg-hover px-3 py-2 text-xs text-muted">
              {t('Example: 100 ₼ × 3 nights → guest pays {total}, host receives {payout}, platform keeps {take}.', {
                total: money(ex.total),
                payout: money(ex.hostPayout),
                take: money(ex.guestFee + ex.hostFee),
              })}
            </p>
          )}
        </Card>

        <Card
          title={t('Wallet top-up')}
          actions={
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set('topupBonuses', [...form.topupBonuses, { minAmount: '', bonusPercent: '' }])}>
              {t('Add tier')}
            </Button>
          }
        >
          <Grid>
            <F label={t('Minimum top-up')} error={errors.minTopup}>
              <MoneyInput value={form.minTopup} onChange={(e) => set('minTopup', e.target.value)} />
            </F>
            <F label={t('Maximum top-up')} error={errors.maxTopup}>
              <MoneyInput value={form.maxTopup} onChange={(e) => set('maxTopup', e.target.value)} />
            </F>
          </Grid>
          <p className="mt-4 mb-2 text-xs font-medium text-muted">{t('Bonus tiers')}</p>
          {errors.topupBonuses && <p className="mb-2 text-xs text-danger">{errors.topupBonuses}</p>}
          <div className="space-y-2">
            {form.topupBonuses.length === 0 && <p className="text-sm text-muted">{t('No bonus tiers — top-ups get no bonus.')}</p>}
            {form.topupBonuses.map((b, i) => (
              <div key={i} className="flex items-end gap-2">
                <FormField label={i === 0 ? t('From amount') : undefined} className="flex-1">
                  <MoneyInput value={b.minAmount} onChange={(e) => set('topupBonuses', form.topupBonuses.map((x, n) => (n === i ? { ...x, minAmount: e.target.value } : x)))} />
                </FormField>
                <FormField label={i === 0 ? t('Bonus, %') : undefined} className="w-28">
                  <Input inputMode="decimal" value={b.bonusPercent} onChange={(e) => set('topupBonuses', form.topupBonuses.map((x, n) => (n === i ? { ...x, bonusPercent: e.target.value } : x)))} />
                </FormField>
                <Button size="icon" variant="ghost" aria-label={t('Remove tier')} onClick={() => set('topupBonuses', form.topupBonuses.filter((_, n) => n !== i))}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            ))}
          </div>
          {bonusOk && values.topupBonuses.length > 0 && (
            <p className="mt-3 rounded-lg bg-hover px-3 py-2 text-xs text-muted">
              {[5000, 10000, 30000].map((a) => `${money(a)} → +${money(topupBonus(a, values))}`).join(' · ')}
            </p>
          )}
        </Card>
      </div>

      <div className="fixed right-4 bottom-4 left-4 z-10 md:left-auto">
        {dirty && (
          <div className="animate-pop flex items-center gap-2 rounded-xl border border-line bg-elevated p-2.5 pl-4 shadow-lg">
            <span className="mr-2 text-sm">{t('{n} unsaved changes', { n: Object.keys(changes).length })}</span>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => { setForm(initial); setErrors({}); }}>
              {t('Reset')}
            </Button>
            <Button size="sm" variant="primary" icon={<Save className="size-3.5" />} loading={save.isPending} onClick={submit}>
              {t('Save settings')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
const F = (p: { label: string; hint?: string; error?: string; children: ReactNode }) => <FormField label={p.label} hint={p.hint} error={p.error}>{p.children}</FormField>;
