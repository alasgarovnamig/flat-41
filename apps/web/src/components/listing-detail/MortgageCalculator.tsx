'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { formatPrice, mortgageLeadSchema, mortgageMonthly, type Currency, type MortgageBank } from '@evtap/shared';
import { api } from '@/lib/api';
import { zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';

const DEFAULT_BANK: MortgageBank = { code: '', name: '', logoUrl: null, annualRate: 8, maxTermYears: 25, minDownPaymentPercent: 15 };

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
    <div className="card p-5">
      <h3 className="text-lg font-semibold">{t('mortgage.title')}</h3>
      <p className="text-sm text-muted">{t('mortgage.subtitle')}</p>
      <div className="mt-4 flex flex-col gap-4">
        {banks.data && banks.data.length > 0 && (
          <Select label={t('mortgage.bank')} value={bank.code} onChange={(e) => setBankCode(e.target.value)}>
            {banks.data.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} — {b.annualRate}%
              </option>
            ))}
          </Select>
        )}
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{t('mortgage.downPayment')}</span>
            <span className="font-semibold">
              {downPct}% · {formatPrice(downPayment, currency)}
            </span>
          </div>
          <input type="range" aria-label={t('mortgage.downPayment')} className="w-full accent-brand" min={bank.minDownPaymentPercent} max={90} step={5} value={downPct} onChange={(e) => setDownPct(Number(e.target.value))} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{t('mortgage.term')}</span>
            <span className="font-semibold">{t('mortgage.years', { n: years })}</span>
          </div>
          <input type="range" aria-label={t('mortgage.term')} className="w-full accent-brand" min={1} max={bank.maxTermYears} value={years} onChange={(e) => setYears(Number(e.target.value))} />
        </div>
        <Input label={t('mortgage.rate')} type="number" step="0.1" min={0} max={40} suffix="%" value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} />
        <div className="rounded-xl bg-brand-50 p-4">
          <div className="text-sm text-brand-dark">{t('mortgage.monthly')}</div>
          <div className="text-2xl font-bold text-brand-dark">{formatPrice(monthly, currency)}</div>
          <div className="mt-1 text-xs text-brand-dark/80">
            {t('mortgage.loanAmount')}: {formatPrice(principal, currency)} · {t('mortgage.totalPaid')}: {formatPrice(totalPaid, currency)}
          </div>
        </div>
      </div>

      {sent ? (
        <Alert tone="success" className="mt-4">
          {t('mortgage.leadSent')}
        </Alert>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-line pt-4" noValidate>
          <div className="text-sm font-semibold">{t('mortgage.applyTitle')}</div>
          <Input label={t('form.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" />
          <Input label={t('form.phone')} type="tel" placeholder="050 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} autoComplete="tel" />
          <Button type="submit" loading={lead.isPending}>
            {t('mortgage.apply')}
          </Button>
        </form>
      )}
    </div>
  );
}
