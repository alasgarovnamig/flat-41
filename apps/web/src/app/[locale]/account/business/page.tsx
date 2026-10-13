'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLANS, type Subscription } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { PageHeader } from '@/components/account/PageHeader';
import { PlansGrid, usePlans } from '@/components/business/Plans';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert, Badge, ErrorState, Skeleton } from '@/components/ui/feedback';

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const { t } = useI18n();
  const unlimited = total === -1;
  const pct = unlimited ? 8 : total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums">{unlimited ? `${used} / ∞` : `${used} / ${total}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/10" role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={unlimited ? undefined : total} aria-label={label}>
        <div className={`h-full rounded-full ${pct > 90 && !unlimited ? 'bg-urgent' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
      {unlimited && <span className="sr-only">{t('business.unlimitedListings')}</span>}
    </div>
  );
}

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
  const tone = s.status === 'ACTIVE' ? 'green' : s.status === 'PAST_DUE' ? 'urgent' : 'gray';
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted">{t('business.yourPlan')}</div>
          <div className="text-2xl font-bold">
            {plan?.name[locale] ?? s.planCode} <span className="text-base font-normal text-muted">· {s.period === 'YEAR' ? t('business.yearly') : t('business.monthly')}</span>
          </div>
          <div className="mt-1 text-sm text-muted">
            {s.autoRenew && s.status === 'ACTIVE' ? t('business.renewsOn', { date: date(s.currentPeriodEnd) }) : t('business.validUntil', { date: date(s.currentPeriodEnd) })}
            {s.cardMask && ` · ${s.cardMask}`}
          </div>
        </div>
        <Badge tone={tone}>{t(`enums.subscriptionStatus.${s.status}`)}</Badge>
      </div>
      {s.status === 'PAST_DUE' && <Alert tone="error" className="mt-3">{t('business.pastDue')}</Alert>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Meter label={t('business.usageListings')} used={s.usage.activeListings} total={s.usage.listingQuota} />
        <Meter label={t('business.usageBumps')} used={Math.max(0, (plan?.monthlyBumps ?? 0) - s.usage.bumpsLeft)} total={plan?.monthlyBumps ?? s.usage.bumpsLeft} />
        {(plan?.monthlyVipCredits ?? 0) > 0 && <Meter label={t('business.usageVip')} used={Math.max(0, plan!.monthlyVipCredits - s.usage.vipCreditsLeft)} total={plan!.monthlyVipCredits} />}
        {(plan?.monthlyPremiumCredits ?? 0) > 0 && <Meter label={t('business.usagePremium')} used={Math.max(0, plan!.monthlyPremiumCredits - s.usage.premiumCreditsLeft)} total={plan!.monthlyPremiumCredits} />}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {s.status === 'ACTIVE' && s.autoRenew && (
          <Button variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('business.cancel')}
          </Button>
        )}
        {(s.status === 'CANCELLED' || (s.status === 'ACTIVE' && !s.autoRenew)) && (
          <Button loading={resume.isPending} onClick={() => resume.mutate()}>
            {t('business.resume')}
          </Button>
        )}
        <LinkButton variant="ghost" href={href('/account/agency')}>{t('account.nav.agency')}</LinkButton>
        <LinkButton variant="ghost" href={href('/account/agency/stats')}>{t('account.nav.agencyStats')}</LinkButton>
      </div>
    </div>
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
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState title={t('business.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : live ? (
        <CurrentSubscription s={live} />
      ) : (
        <Alert tone="info">{t('business.noSubscription')}</Alert>
      )}
      <h2 className="mb-4 mt-10 text-xl font-bold">{live ? t('business.changePlan') : t('business.choosePlan')}</h2>
      <PlansGrid currentPlan={live?.planCode ?? null} />
    </div>
  );
}
