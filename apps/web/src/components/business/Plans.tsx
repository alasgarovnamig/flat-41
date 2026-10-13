'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLANS, formatMoney, planPrice, type BillingPeriod, type PaymentMethod, type PlanDef } from '@evtap/shared';
import { api } from '@/lib/api';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { useAuth, useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/feedback';
import { Segmented, Toggle } from '@/components/ui/form';
import { CheckIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';

export function usePlans() {
  const catalog = useQuery({ queryKey: qk.catalog, queryFn: api.ref.catalog, staleTime: 5 * 60_000, retry: false });
  return { plans: (catalog.data?.plans ?? PLANS).filter((p) => p.active), fallback: catalog.isError };
}

function SubscribeModal({ plan, period, onClose }: { plan: PlanDef; period: BillingPeriod; onClose: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [autoRenew, setAutoRenew] = useState(true);
  const amount = planPrice(plan, period);
  const m = useMutation({
    mutationFn: () => api.payments.checkout({ purpose: 'SUBSCRIPTION', planCode: plan.code, period, method, autoRenew, returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (c) => followCheckout(c, locale, router.push),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('business.subscribeTo', { plan: plan.name[locale] })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>{t('business.pay', { amount: formatMoney(amount) })}</Button>
        </>
      }
    >
      <div className="mb-4 flex items-baseline justify-between rounded-xl bg-surface p-4">
        <span className="font-semibold">{plan.name[locale]} · {period === 'YEAR' ? t('business.yearly') : t('business.monthly')}</span>
        <span className="text-xl font-bold">{formatMoney(amount)}</span>
      </div>
      <PayMethodPicker value={method} onChange={setMethod} amount={amount} />
      <div className="mt-4">
        <Toggle checked={autoRenew} onChange={setAutoRenew} label={t('business.autoRenew')} />
      </div>
      <p className="mt-3 text-xs text-muted">{method === 'CARD' ? t('business.cardNote') : t('business.walletNote')}</p>
    </Modal>
  );
}

export function PlansGrid({ currentPlan }: { currentPlan?: PlanDef['code'] | null }) {
  const { t, locale } = useI18n();
  const { plans, fallback } = usePlans();
  const { user } = useAuth();
  const gate = useAuthGate();
  const [period, setPeriod] = useState<BillingPeriod>('MONTH');
  const [chosen, setChosen] = useState<PlanDef | null>(null);
  const current = currentPlan ?? (user?.subscription && ['ACTIVE', 'CANCELLED', 'PAST_DUE'].includes(user.subscription.status) ? user.subscription.planCode : null);

  return (
    <div>
      <div className="mb-6 flex justify-center">
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'MONTH', label: t('business.monthly') },
            { value: 'YEAR', label: <span>{t('business.yearly')} <span className="ml-1 rounded-full bg-vip px-1.5 text-[10px] font-bold text-ink">{t('business.twoMonthsFree')}</span></span> },
          ]}
        />
      </div>
      {fallback && <Alert tone="warning" className="mb-4">{t('promote.catalogFallback')}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const featured = p.code === 'PRO';
          const price = planPrice(p, period);
          const perMonth = period === 'YEAR' ? Math.round(price / 12) : price;
          const isCurrent = current === p.code;
          return (
            <div key={p.code} className={cn('relative flex flex-col rounded-2xl border bg-white p-6 shadow-card', featured ? 'border-brand ring-2 ring-brand' : 'border-line')}>
              {featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">{t('business.popular')}</span>}
              <h3 className="text-lg font-bold">{p.name[locale]}</h3>
              <div className="mt-3">
                <span className="text-4xl font-extrabold tracking-tight">{formatMoney(perMonth)}</span>
                <span className="text-muted"> / {t('common.perMonth')}</span>
              </div>
              <div className="mt-1 h-5 text-xs text-muted">{period === 'YEAR' ? t('business.billedYearly', { amount: formatMoney(price) }) : ''}</div>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                <li className="flex gap-2"><CheckIcon size={18} className="shrink-0 text-brand" /> {p.listingQuota === -1 ? t('business.unlimitedListings') : t('business.listingsN', { n: p.listingQuota })}</li>
                <li className="flex gap-2"><CheckIcon size={18} className="shrink-0 text-brand" /> {t('business.bumpsN', { n: p.monthlyBumps })}</li>
                {p.monthlyVipCredits > 0 && <li className="flex gap-2"><CheckIcon size={18} className="shrink-0 text-brand" /> {t('business.vipN', { n: p.monthlyVipCredits })}</li>}
                {p.monthlyPremiumCredits > 0 && <li className="flex gap-2"><CheckIcon size={18} className="shrink-0 text-brand" /> {t('business.premiumN', { n: p.monthlyPremiumCredits })}</li>}
                <li className="flex gap-2"><CheckIcon size={18} className="shrink-0 text-brand" /> {t('business.agentsN', { n: p.maxAgents })}</li>
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><CheckIcon size={18} className="shrink-0 text-brand" /> {t(`business.features.${f}`)}</li>
                ))}
              </ul>
              <Button className="mt-6 w-full" size="lg" variant={featured ? 'primary' : 'outline'} disabled={isCurrent} onClick={() => gate(() => setChosen(p))}>
                {isCurrent ? t('business.current') : current ? t('business.switch') : t('business.subscribe')}
              </Button>
            </div>
          );
        })}
      </div>
      {chosen && <SubscribeModal plan={chosen} period={period} onClose={() => setChosen(null)} />}
    </div>
  );
}
