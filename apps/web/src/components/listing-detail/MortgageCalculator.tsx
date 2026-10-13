'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { currencySymbol, mortgageLeadSchema, mortgageMonthly, type Currency, type MortgageBank } from '@evtap/shared';
import { api } from '@/lib/api';
import { zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { Button, Card, CardHeader, Input, Money, Notice, PillBarChart, Select, groupNumber } from '@/components/ds';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

const DEFAULT_BANK: MortgageBank = { code: '', name: '', logoUrl: null, annualRate: 8, maxTermYears: 25, minDownPaymentPercent: 15 };

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));

function Slider({ label, value, display, min, max, step, onChange }: { label: string; value: number; display: React.ReactNode; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-3 text-label">
        <span className="font-normal text-ink-secondary">{label}</span>
        <span className="tabular font-medium">{display}</span>
      </span>
      <input type="range" className="h-11 w-full cursor-pointer accent-ink" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Mortgage calculator: sliders + monthly payment as a big number + a PillBarChart cost breakdown, then a lead form. */
export function MortgageCalculator({ listingId, price, currency }: { listingId?: string; price: number; currency: Currency }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const banks = useQuery({ queryKey: qk.banks, queryFn: api.ref.mortgageBanks, staleTime: 10 * 60_000, retry: false });
  const [bankCode, setBankCode] = useState('');
  const bank = banks.data?.find((b) => b.code === bankCode) ?? (banks.data?.[0] && !bankCode ? banks.data[0] : undefined) ?? DEFAULT_BANK;
  const [rate, setRate] = useState(bank.annualRate);
  const [downPct, setDownPct] = useState(Math.max(20, bank.minDownPaymentPercent));
  const [years, setYears] = useState(Math.min(20, bank.maxTermYears));
  useEffect(() => {
    setRate(bank.annualRate);
    setDownPct((d) => Math.max(d, bank.minDownPaymentPercent));
    setYears((y) => Math.min(y, bank.maxTermYears));
  }, [bank.code, bank.annualRate, bank.minDownPaymentPercent, bank.maxTermYears]);

  const downPayment = Math.round((price * downPct) / 100);
  const principal = Math.max(0, price - downPayment);
  const monthly = useMemo(() => mortgageMonthly(principal, rate, years), [principal, rate, years]);
  const totalPaid = monthly * years * 12;
  const interest = Math.max(0, totalPaid - principal);
  const pct = (n: number) => `${Math.round((n / price) * 100)}%`;
  const sym = currencySymbol(currency);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const lead = useMutation({ mutationFn: api.ref.mortgageLead, onSuccess: () => setSent(true) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name, phone, listingId: listingId ?? null, price: Math.round(price), downPayment, termYears: years, bankCode: bank.code || null };
    const r = mortgageLeadSchema.safeParse(body);
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    lead.mutate(r.data);
  };

  return (
    <Card aria-labelledby="mortgage-h">
      <CardHeader id="mortgage-h" title={t('mortgage.title')} sub={t('mortgage.subtitle')} />
      <div className="flex flex-col gap-3">
        {banks.data && banks.data.length > 0 && (
          <Select label={t('mortgage.bank')} value={bank.code} onChange={(e) => setBankCode(e.target.value)}>
            {banks.data.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} — {b.annualRate}%
              </option>
            ))}
          </Select>
        )}
        <Slider label={t('mortgage.downPayment')} value={downPct} min={bank.minDownPaymentPercent} max={90} step={5} onChange={setDownPct} display={<>{downPct}% · <Money value={downPayment} currency={currency} /></>} />
        <Slider label={t('mortgage.term')} value={years} min={1} max={bank.maxTermYears} onChange={setYears} display={t('mortgage.years', { n: years })} />
        <Input label={t('mortgage.rate')} type="number" step="0.1" min={0} max={40} suffix="%" value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} />
      </div>

      <div className="mt-5 rounded-lg bg-surface-raised p-4 shadow-pill">
        <div className="text-label font-normal text-ink-secondary">{t('mortgage.monthly')}</div>
        <Money value={monthly} currency={currency} suffix={`/ ${t('common.perMonth')}`} className="mt-1 block font-display text-[34px] leading-none tracking-[-0.8px]" />
        <PillBarChart
          className="mt-5"
          ariaLabel={t('mortgage.breakdown')}
          max={Math.max(totalPaid, price)}
          ticks={4}
          axisFormat={compact}
          rows={[
            ['down', t('mortgage.downPayment'), downPayment],
            ['loan', t('mortgage.loanAmount'), principal],
            ['interest', t('mortgage.interest'), interest],
            ['total', t('mortgage.totalPaid'), totalPaid],
          ].map(([key, name, v]) => ({
            key: key as string,
            label: '',
            value: v as number,
            tag: pct(v as number),
            title: `${name}: ${sym} ${groupNumber(v as number)}`,
            heading: (
              <>
                <span>{name}</span>
                <span className="tabular font-medium text-ink">
                  <span className="text-muted">{sym}</span> {groupNumber(v as number)}
                </span>
              </>
            ),
          }))}
        />
      </div>

      {sent ? (
        <Notice tone="success" className="mt-5">
          {t('mortgage.leadSent')}
        </Notice>
      ) : (
        <form onSubmit={submit} className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5" noValidate>
          <div className="text-[15px] font-medium">{t('mortgage.applyTitle')}</div>
          <Input label={t('form.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" />
          <Input label={t('form.phone')} type="tel" placeholder="050 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} autoComplete="tel" />
          <Button type="submit" loading={lead.isPending}>
            {t('mortgage.apply')}
          </Button>
        </form>
      )}
    </Card>
  );
}
