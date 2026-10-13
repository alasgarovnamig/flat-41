'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLANS, type Subscription } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { subscriptionStatusTone } from '@/lib/status';
import { PlansGrid, usePlans } from '@/components/business/Plans';
import { Button, Card, ErrorState, LinkButton, Meter, Notice, PageHeader, SectionTitle, Skeleton, StatusPill } from '@/components/ds';
import { ArrowUpRightIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

function CurrentSubscription({ s }: { s: Subscription }) {
  const { t, date, locale, href } = useI18n();
  const { refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { plans } = usePlans();
  const plan = plans.find((p) => p.code === s.planCode) ?? PLANS.find((p) => p.code === s.planCode)!;
  const after = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: qk.subscription });
    refresh();
  };
  const cancel = useMutation({ mutationFn: api.subscriptions.cancel, onSuccess: () => after(t('business.cancelledOk')) });
  const resume = useMutation({ mutationFn: api.subscriptions.resume, onSuccess: () => after(t('business.resumedOk')) });
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-label font-normal text-ink-secondary">{t('business.yourPlan')}</div>
          <div className="mt-1 font-display text-[34px] font-normal leading-none tracking-[-0.8px]">
            {plan?.name[locale] ?? s.planCode} <span className="text-[17px] text-muted">· {s.period === 'YEAR' ? t('business.yearly') : t('business.monthly')}</span>
          </div>
          <div className="mt-2 text-label font-normal text-ink-secondary">
            {s.autoRenew && s.status === 'ACTIVE' ? t('business.renewsOn', { date: date(s.currentPeriodEnd) }) : t('business.validUntil', { date: date(s.currentPeriodEnd) })}
            {s.cardMask && ` · ${s.cardMask}`}
          </div>
        </div>
        <StatusPill tone={subscriptionStatusTone(s.status)}>{t(`enums.subscriptionStatus.${s.status}`)}</StatusPill>
      </div>
      {s.status === 'PAST_DUE' && <Notice tone="error" className="mt-4">{t('business.pastDue')}</Notice>}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <Meter label={t('business.usageListings')} used={s.usage.activeListings} total={s.usage.listingQuota} />
        <Meter label={t('business.usageBumps')} used={Math.max(0, (plan?.monthlyBumps ?? 0) - s.usage.bumpsLeft)} total={plan?.monthlyBumps ?? s.usage.bumpsLeft} />
        {(plan?.monthlyVipCredits ?? 0) > 0 && <Meter label={t('business.usageVip')} used={Math.max(0, plan!.monthlyVipCredits - s.usage.vipCreditsLeft)} total={plan!.monthlyVipCredits} />}
        {(plan?.monthlyPremiumCredits ?? 0) > 0 && <Meter label={t('business.usagePremium')} used={Math.max(0, plan!.monthlyPremiumCredits - s.usage.premiumCreditsLeft)} total={plan!.monthlyPremiumCredits} />}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {s.status === 'ACTIVE' && s.autoRenew && (
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('business.cancel')}
          </Button>
        )}
        {(s.status === 'CANCELLED' || (s.status === 'ACTIVE' && !s.autoRenew)) && (
          <Button loading={resume.isPending} onClick={() => resume.mutate()}>
            {t('business.resume')}
          </Button>
        )}
        <LinkButton variant="ghost" href={href('/account/agency')} trailing={<ArrowUpRightIcon size={16} />}>
          {t('account.nav.agency')}
        </LinkButton>
        <LinkButton variant="ghost" href={href('/account/agency/stats')} trailing={<ArrowUpRightIcon size={16} />}>
          {t('account.nav.agencyStats')}
        </LinkButton>
      </div>
    </Card>
  );
}

export default function MySubscriptionPage() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.subscription, queryFn: api.subscriptions.me });
  const s = q.data;
  const live = s && s.status !== 'EXPIRED' ? s : null;
  return (
    <div>
      <PageHeader title={t('account.nav.business')} sub={t('business.accountSub')} />
      {q.isLoading ? (
        <Skeleton className="h-56 rounded-xl" />
      ) : q.isError ? (
        <ErrorState title={t('business.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : live ? (
        <CurrentSubscription s={live} />
      ) : (
        <Notice tone="neutral">{t('business.noSubscription')}</Notice>
      )}
      <SectionTitle className="mt-10" title={live ? t('business.changePlan') : t('business.choosePlan')} />
      <PlansGrid currentPlan={live?.planCode ?? null} />
    </div>
  );
}
