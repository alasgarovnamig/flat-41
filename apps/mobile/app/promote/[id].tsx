import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type PaymentMethod, type PromotionType, type ServiceDef } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useI18n } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Badge, Button, Card, Loading, Text } from '@/components/ui';
import { PaymentMethodPicker } from '@/components/PaymentMethod';
import { useToast } from '@/components/Toast';
import { useCatalog } from '@/hooks/common';
import { useAuth } from '@/auth/AuthContext';
import { completeCheckout, paymentReturnUrl } from '@/payments/pay';

const GROUP_ORDER: PromotionType[] = ['PREMIUM', 'VIP', 'BUMP', 'AUTO_BUMP', 'HIGHLIGHT', 'URGENT'];
const GROUP_COLOR: Record<PromotionType, string> = {
  PREMIUM: brand.premium, VIP: brand.vip, BUMP: brand.primary, AUTO_BUMP: brand.primary, HIGHLIGHT: '#D97706', URGENT: brand.urgent,
};
const GROUP_ICON: Record<PromotionType, keyof typeof Ionicons.glyphMap> = {
  PREMIUM: 'diamond', VIP: 'star', BUMP: 'arrow-up-circle', AUTO_BUMP: 'repeat', HIGHLIGHT: 'color-palette', URGENT: 'flash',
};

export default function Promote() {
  const { id, upsell } = useLocalSearchParams<{ id: string; upsell?: string }>();
  const { c } = useTheme();
  const { t, locale, fmtDate, te } = useI18n();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { catalog, isLoading } = useCatalog();
  const listing = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listing(id) });

  // One service per promotion type, or a bundle.
  const [picked, setPicked] = useState<Partial<Record<PromotionType, string>>>({});
  const [bundle, setBundle] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('WALLET');

  const services = catalog.services.filter((s) => s.active);
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((type) => ({ type, items: services.filter((s) => s.promotionType === type).sort((a, b) => a.sortOrder - b.sortOrder) })).filter((g) => g.items.length),
    [services],
  );
  const verification = services.find((s) => s.code === 'VERIFICATION');
  const byCode = (code: string) => services.find((s) => s.code === code);

  const selectedCodes = Object.values(picked).filter(Boolean) as string[];
  const selectedBundle = catalog.bundles.find((b) => b.code === bundle);
  const total = selectedBundle ? selectedBundle.price : selectedCodes.reduce((sum, code) => sum + (byCode(code)?.price ?? 0), 0);

  const pay = useMutation({
    mutationFn: (opts: { verification?: boolean }) =>
      opts.verification
        ? api.checkout({ purpose: 'VERIFICATION', listingId: id, method, returnUrl: paymentReturnUrl() })
        : api.checkout({
            purpose: 'PROMOTION',
            listingId: id,
            ...(selectedBundle ? { bundleCode: selectedBundle.code } : { serviceCodes: selectedCodes }),
            method,
            returnUrl: paymentReturnUrl(),
          }),
    onSuccess: (res) => completeCheckout(res, { listingId: id }),
    onError: toast.error,
  });

  const credit = useMutation({
    mutationFn: (cr: 'BUMP' | 'VIP_7' | 'PREMIUM_7') => api.applyCredit(id, cr),
    onSuccess: () => {
      toast.success(t('promote.creditApplied'));
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.listing(id) });
      qc.invalidateQueries({ queryKey: ['myListings'] });
    },
    onError: toast.error,
  });

  if (isLoading && !catalog) return <Loading />;
  const usage = me?.subscription?.status === 'ACTIVE' || me?.subscription?.status === 'CANCELLED' ? me.subscription.usage : null;
  const credits = usage
    ? ([
        ['BUMP', usage.bumpsLeft],
        ['VIP_7', usage.vipCreditsLeft],
        ['PREMIUM_7', usage.premiumCreditsLeft],
      ] as const).filter(([, n]) => n > 0)
    : [];
  const name = (s: ServiceDef) => s.name[locale] ?? s.name.az;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 140 + insets.bottom }}>
        {upsell && (
          <Card highlight style={{ gap: 4 }}>
            <Text variant="h3">{t('post.upsellTitle')}</Text>
            <Text muted>{t('post.upsellText')}</Text>
          </Card>
        )}
        {listing.data && (
          <View style={{ gap: 4 }}>
            <Text variant="h3" numberOfLines={1}>
              {listing.data.title}
            </Text>
            {listing.data.promotions.map((p) => (
              <Text key={p.id} variant="small" color={c.primary}>
                ✓ {byCode(p.serviceCode) ? name(byCode(p.serviceCode)!) : p.type}
                {p.endsAt ? ` · ${t('promote.active', { date: fmtDate(p.endsAt) })}` : ''}
              </Text>
            ))}
          </View>
        )}

        {credits.length > 0 && (
          <Card style={{ gap: spacing.sm }}>
            <Text variant="h3">{t('promote.credits')}</Text>
            {credits.map(([code, n]) => (
              <View key={code} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600' }}>{te('credit', code)}</Text>
                  <Text variant="small" muted>
                    {t('promote.creditsLeft', { n })}
                  </Text>
                </View>
                <Button title={t('promote.useCredit')} small full={false} kind="secondary" loading={credit.isPending && credit.variables === code} onPress={() => credit.mutate(code)} />
              </View>
            ))}
          </Card>
        )}

        {/* Bundles */}
        {catalog.bundles.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="h3">{t('promote.bundles')}</Text>
            {catalog.bundles.map((b) => {
              const sum = b.serviceCodes.reduce((s, code) => s + (byCode(code)?.price ?? 0), 0);
              const selected = bundle === b.code;
              return (
                <Pressable
                  key={b.code}
                  onPress={() => {
                    setBundle(selected ? null : b.code);
                    setPicked({});
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={[styles.option, { borderColor: selected ? c.premium : c.border, backgroundColor: selected ? c.premium + '14' : c.card }]}
                >
                  <Ionicons name="gift" size={24} color={c.premium} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: '700' }}>{b.name[locale] ?? b.name.az}</Text>
                    <Text variant="small" muted>
                      {b.serviceCodes.map((code) => (byCode(code) ? name(byCode(code)!) : code)).join(' + ')}
                    </Text>
                    {sum > b.price && <Badge label={t('promote.economy', { amount: formatMoney(sum - b.price) })} color={c.success} style={{ alignSelf: 'flex-start' }} />}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontWeight: '700' }}>{formatMoney(b.price)}</Text>
                    {sum > b.price && (
                      <Text variant="small" muted style={{ textDecorationLine: 'line-through' }}>
                        {formatMoney(sum)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Services */}
        <Text variant="h3">{t('promote.services')}</Text>
        {groups.map((g) => (
          <View key={g.type} style={{ gap: spacing.sm }}>
            {g.items.map((s) => {
              const selected = picked[g.type] === s.code;
              return (
                <Pressable
                  key={s.code}
                  onPress={() => {
                    setBundle(null);
                    setPicked((p) => ({ ...p, [g.type]: selected ? undefined : s.code }));
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[styles.option, { borderColor: selected ? GROUP_COLOR[g.type] : c.border, backgroundColor: selected ? GROUP_COLOR[g.type] + '14' : c.card }]}
                >
                  <Ionicons name={GROUP_ICON[g.type]} size={22} color={GROUP_COLOR[g.type]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600' }}>{name(s)}</Text>
                    <Text variant="small" muted>
                      {s.description[locale] ?? s.description.az}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: '700' }}>{formatMoney(s.price)}</Text>
                  <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? GROUP_COLOR[g.type] : c.muted} />
                </Pressable>
              );
            })}
          </View>
        ))}

        <PaymentMethodPicker value={method} onChange={setMethod} amount={total} />

        {/* Verification (separate purchase) */}
        {verification && listing.data && !listing.data.isVerified && (
          <Card style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="shield-checkmark" size={22} color={c.primary} />
              <Text variant="h3" style={{ flex: 1 }}>
                {t('promote.verificationTitle')}
              </Text>
              <Text style={{ fontWeight: '700' }}>{formatMoney(verification.price)}</Text>
            </View>
            <Text variant="small" muted>
              {verification.description[locale] ?? verification.description.az}
            </Text>
            <Button title={`${t('promote.pay')} ${formatMoney(verification.price)}`} kind="secondary" loading={pay.isPending && !!pay.variables?.verification} onPress={() => pay.mutate({ verification: true })} />
          </Card>
        )}
      </ScrollView>

      <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" muted>
            {t('promote.total')}
          </Text>
          <Text variant="h2">{formatMoney(total)}</Text>
        </View>
        <Button
          title={total ? t('promote.pay') : t('promote.select')}
          full={false}
          kind="vip"
          icon="rocket-outline"
          disabled={!total}
          loading={pay.isPending && !pay.variables?.verification}
          onPress={() => pay.mutate({})}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, minHeight: 60 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
