import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, planPrice, type BillingPeriod, type PaymentMethod, type PlanDef } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n, type TKey } from '@/i18n';
import { brand, spacing, useTheme } from '@/theme';
import { Badge, Button, Card, Loading, Segmented, StatusPill, Text } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { PaymentMethodPicker } from '@/components/PaymentMethod';
import { useToast } from '@/components/Toast';
import { useCatalog } from '@/hooks/common';
import { completeCheckout, paymentReturnUrl } from '@/payments/pay';

export default function BusinessScreen() {
  return (
    <RequireAuth>
      <Business />
    </RequireAuth>
  );
}

function Business() {
  const { c } = useTheme();
  const { t, te, locale, fmtDate } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { catalog, isLoading } = useCatalog();
  const sub = useQuery({ queryKey: qk.subscription, queryFn: api.subscription });
  const [period, setPeriod] = useState<BillingPeriod>('MONTH');
  const [plan, setPlan] = useState<PlanDef | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('CARD');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.subscription });
    qc.invalidateQueries({ queryKey: qk.me });
  };
  const cancel = useMutation({ mutationFn: api.cancelSubscription, onSuccess: refresh, onError: toast.error });
  const resume = useMutation({ mutationFn: api.resumeSubscription, onSuccess: refresh, onError: toast.error });
  const subscribe = useMutation({
    mutationFn: () => api.checkout({ purpose: 'SUBSCRIPTION', planCode: plan!.code, period, method, autoRenew: true, returnUrl: paymentReturnUrl() }),
    onSuccess: (res) => {
      setPlan(null);
      completeCheckout(res);
    },
    onError: toast.error,
  });

  if (isLoading || sub.isLoading) return <Loading />;
  const s = sub.data;
  const active = s && s.status !== 'EXPIRED';

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} refreshControl={<RefreshControl refreshing={sub.isRefetching} onRefresh={() => sub.refetch()} tintColor={c.primary} />}>
      {active && s && (
        <Card style={{ gap: spacing.sm, borderColor: c.primary, borderWidth: 1.5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name="briefcase" size={22} color={c.primary} />
            <Text variant="h3" style={{ flex: 1 }}>
              {t('business.current')}: {catalog.plans.find((p) => p.code === s.planCode)?.name[locale] ?? s.planCode}
            </Text>
            <StatusPill label={te('subscriptionStatus', s.status)} tone={s.status === 'ACTIVE' ? 'success' : s.status === 'PAST_DUE' ? 'danger' : 'warning'} />
          </View>
          <Text muted>
            {s.period === 'YEAR' ? t('business.yearly') : t('business.monthly')} · {s.autoRenew ? t('business.renewsOn', { date: fmtDate(s.currentPeriodEnd) }) : t('business.endsOn', { date: fmtDate(s.currentPeriodEnd) })}
          </Text>
          {s.cardMask && <Text variant="small" muted>{t('business.card', { mask: s.cardMask })}</Text>}
          <Text variant="label" style={{ marginTop: spacing.sm }}>
            {t('business.usage')}
          </Text>
          <Text variant="small">
            {t('business.usageListings', { used: s.usage.activeListings, total: s.usage.listingQuota === -1 ? '∞' : s.usage.listingQuota })}
          </Text>
          <Text variant="small">{t('business.usageBumps', { n: s.usage.bumpsLeft })}</Text>
          <Text variant="small">{t('business.usageVip', { n: s.usage.vipCreditsLeft })}</Text>
          <Text variant="small">{t('business.usagePremium', { n: s.usage.premiumCreditsLeft })}</Text>
          {s.autoRenew ? (
            <Button
              title={t('business.cancelRenew')}
              kind="outline"
              loading={cancel.isPending}
              onPress={() =>
                Alert.alert(t('business.cancelRenew'), t('business.cancelConfirm'), [
                  { text: t('common.no'), style: 'cancel' },
                  { text: t('common.yes'), style: 'destructive', onPress: () => cancel.mutate() },
                ])
              }
            />
          ) : (
            <Button title={t('business.resume')} kind="secondary" loading={resume.isPending} onPress={() => resume.mutate()} />
          )}
        </Card>
      )}

      <View style={{ gap: 4 }}>
        <Text variant="h2">{t('business.title')}</Text>
        <Text muted>{t('business.subtitle')}</Text>
      </View>
      <Segmented
        options={[
          { value: 'MONTH', label: t('business.monthly') },
          { value: 'YEAR', label: `${t('business.yearly')} · ${t('business.save2')}` },
        ]}
        value={period}
        onChange={setPeriod}
      />

      {catalog.plans
        .filter((p) => p.active)
        .map((p) => {
          const current = active && s?.planCode === p.code;
          const highlight = p.code === 'PRO';
          return (
            <Card key={p.code} style={{ gap: spacing.sm, borderColor: highlight ? brand.premium : c.border, borderWidth: highlight ? 1.5 : undefined }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="h2" style={{ flex: 1 }}>
                  {p.name[locale] ?? p.name.az}
                </Text>
                {highlight && <Badge label="★" color={brand.premium} />}
              </View>
              <Text variant="h1" color={c.primary}>
                {formatMoney(planPrice(p, period))}
                <Text muted> {period === 'YEAR' ? t('business.perYear') : t('business.perMonth')}</Text>
              </Text>
              <Feature text={t('business.listings', { n: p.listingQuota === -1 ? t('business.unlimited') : p.listingQuota })} />
              <Feature text={t('business.bumps', { n: p.monthlyBumps })} />
              {p.monthlyVipCredits > 0 && <Feature text={t('business.vipCredits', { n: p.monthlyVipCredits })} />}
              {p.monthlyPremiumCredits > 0 && <Feature text={t('business.premiumCredits', { n: p.monthlyPremiumCredits })} />}
              <Feature text={t('business.agents', { n: p.maxAgents })} />
              {p.features.map((f) => (
                <Feature key={f} text={t(`business.features.${f}` as TKey)} />
              ))}
              <Button title={current ? t('business.current') : t('business.subscribe')} disabled={!!current} kind={highlight ? 'premium' : 'primary'} onPress={() => setPlan(p)} style={{ marginTop: spacing.sm }} />
            </Card>
          );
        })}

      <Sheet
        visible={!!plan}
        onClose={() => setPlan(null)}
        title={plan ? `${plan.name[locale] ?? plan.name.az} · ${formatMoney(planPrice(plan, period))}` : ''}
        footer={<Button title={t('business.subscribe')} loading={subscribe.isPending} onPress={() => subscribe.mutate()} />}
      >
        {plan && <PaymentMethodPicker value={method} onChange={setMethod} amount={planPrice(plan, period)} />}
      </Sheet>
    </ScrollView>
  );
}

function Feature({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Ionicons name="checkmark-circle" size={18} color={c.primary} />
      <Text style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}
