'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLANS, formatMoney, planPrice, type BillingPeriod, type PaymentMethod, type PlanDef } from '@evtap/shared';
import { api } from '@/lib/api';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Badge, Button, Modal, Money, Notice, Segmented, Toggle } from '@/components/ds';
import { ArrowUpRightIcon, CheckIcon } from '@/components/ds/icons';
import { PayMethodPicker } from '@/components/payments/PayMethod';
import { useAuth, useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

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
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            {t('business.pay', { amount: formatMoney(amount) })}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-end justify-between gap-3 rounded-lg bg-surface-sunken p-4">
        <span className="font-medium">
          {plan.name[locale]} · {period === 'YEAR' ? t('business.yearly') : t('business.monthly')}
        </span>
        <Money value={amount} minor className="font-display text-[28px] leading-none tracking-[-0.6px]" />
      </div>
      <PayMethodPicker value={method} onChange={setMethod} amount={amount} />
      <div className="mt-4">
        <Toggle checked={autoRenew} onChange={setAutoRenew} label={t('business.autoRenew')} />
      </div>
      <p className="mt-2 text-caption text-muted">{method === 'CARD' ? t('business.cardNote') : t('business.walletNote')}</p>
    </Modal>
  );
}

/** Pricing cards: big thin price with grey ₼, check list, black pill CTA; the featured plan is an ink (inverted) card. */
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
          ariaLabel={t('business.period')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'MONTH', label: t('business.monthly') },
            { value: 'YEAR', label: <span className="flex items-center gap-2">{t('business.yearly')} <Badge tone="accent" size="xs">{t('business.twoMonthsFree')}</Badge></span> },
          ]}
        />
      </div>
      {fallback && <Notice tone="warning" className="mb-4">{t('promote.catalogFallback')}</Notice>}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const featured = p.code === 'PRO';
          const price = planPrice(p, period);
          const perMonth = period === 'YEAR' ? Math.round(price / 12) : price;
          const isCurrent = current === p.code;
          const features = [
            p.listingQuota === -1 ? t('business.unlimitedListings') : t('business.listingsN', { n: p.listingQuota }),
            t('business.bumpsN', { n: p.monthlyBumps }),
            ...(p.monthlyVipCredits > 0 ? [t('business.vipN', { n: p.monthlyVipCredits })] : []),
            ...(p.monthlyPremiumCredits > 0 ? [t('business.premiumN', { n: p.monthlyPremiumCredits })] : []),
            t('business.agentsN', { n: p.maxAgents }),
            ...p.features.map((f) => t(`business.features.${f}`)),
          ];
          return (
            <section key={p.code} aria-labelledby={`plan-${p.code}`} className={cn('relative flex flex-col rounded-xl p-6 sm:p-7', featured ? 'bg-ink text-on-ink shadow-raised' : 'bg-surface shadow-card')}>
              <div className="flex items-center justify-between gap-2">
                <h3 id={`plan-${p.code}`} className="text-h3">
                  {p.name[locale]}
                </h3>
                {featured ? <Badge tone="accent">{t('business.popular')}</Badge> : isCurrent ? <Badge tone="success">{t('business.current')}</Badge> : null}
              </div>
              <div className="mt-6">
                <Money value={perMonth} minor className="font-display text-[48px] font-light leading-none tracking-[-1.6px]" symbolClassName={featured ? 'text-subtle' : undefined} />
                <span className={cn('ml-1 text-label', featured ? 'opacity-70' : 'text-muted')}>/ {t('common.perMonth')}</span>
              </div>
              <div className={cn('mt-2 h-5 text-caption', featured ? 'opacity-70' : 'text-muted')}>{period === 'YEAR' ? t('business.billedYearly', { amount: formatMoney(price) }) : ''}</div>
              <ul className="mt-6 flex-1 space-y-3 text-[14px]">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', featured ? 'bg-on-ink text-ink' : 'bg-ink text-on-ink')}>
                      <CheckIcon size={13} strokeWidth={2.4} />
                    </span>
                    <span className="pt-0.5">{f}</span>
                  </li>
                ))}
              </ul>
              <Button className="mt-7 w-full" size="lg" variant={featured ? 'accent' : 'primary'} disabled={isCurrent} onClick={() => gate(() => setChosen(p))} trailing={!isCurrent ? <ArrowUpRightIcon size={18} /> : undefined}>
                {isCurrent ? t('business.current') : current ? t('business.switch') : t('business.subscribe')}
              </Button>
            </section>
          );
        })}
      </div>
      {chosen && <SubscribeModal plan={chosen} period={period} onClose={() => setChosen(null)} />}
    </div>
  );
}
