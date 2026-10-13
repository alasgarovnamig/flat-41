import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, topupBonus, type WalletTransaction } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { brand, radius, spacing, useTheme } from '@/theme';
import { Badge, Button, Card, Chip, Divider, EmptyState, Field, Skeleton, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useCatalog } from '@/hooks/common';
import { completeCheckout, paymentReturnUrl } from '@/payments/pay';

const QUICK = [1000, 2000, 5000, 10000, 30000];

export default function WalletScreen() {
  return (
    <RequireAuth>
      <Wallet />
    </RequireAuth>
  );
}

function Wallet() {
  const { c } = useTheme();
  const { t, te, fmtDateTime } = useI18n();
  const toast = useToast();
  const { catalog } = useCatalog();
  const s = catalog.settings;
  const wallet = useQuery({ queryKey: qk.wallet, queryFn: api.wallet });
  const tx = useInfiniteQuery({
    queryKey: qk.walletTx,
    queryFn: ({ pageParam }) => api.walletTransactions({ page: pageParam, pageSize: 30 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = useMemo(() => tx.data?.pages.flatMap((p) => p.items) ?? [], [tx.data]);

  const [amountText, setAmountText] = useState('50');
  const amount = Math.round(Number(amountText.replace(',', '.') || 0) * 100);
  const bonus = topupBonus(amount, { ...s, payoutDelayHours: 0, moderationEnabled: true });
  const valid = amount >= s.minTopup && amount <= s.maxTopup;

  const topup = useMutation({
    mutationFn: () => api.checkout({ purpose: 'WALLET_TOPUP', amount, method: 'CARD', returnUrl: paymentReturnUrl() }),
    onSuccess: (res) => completeCheckout(res),
    onError: toast.error,
  });

  const header = (
    <View style={{ gap: spacing.lg, marginBottom: spacing.md }}>
      <View style={[styles.balance, { backgroundColor: brand.primary }]}>
        <Text color="#D1FAE5" variant="small">
          {t('wallet.balance')}
        </Text>
        {wallet.isLoading ? (
          <Skeleton height={34} width="50%" />
        ) : (
          <Text color="#fff" variant="h1" style={{ fontSize: 34 }}>
            {formatMoney(wallet.data?.balance ?? 0, wallet.data?.currency)}
          </Text>
        )}
        <Text color="#FDE68A">
          {t('wallet.bonus')}: {formatMoney(wallet.data?.bonusBalance ?? 0, wallet.data?.currency)}
        </Text>
      </View>

      <Card style={{ gap: spacing.md }}>
        <Text variant="h3">{t('wallet.topup')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {QUICK.map((q) => (
            <Chip key={q} label={formatMoney(q)} selected={amount === q} onPress={() => setAmountText(String(q / 100))} />
          ))}
        </View>
        <Field
          label={t('wallet.amount')}
          value={amountText}
          onChangeText={(v) => setAmountText(v.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          hint={t('wallet.limits', { min: formatMoney(s.minTopup), max: formatMoney(s.maxTopup) })}
        />
        {bonus > 0 && (
          <Badge label={t('wallet.bonusInfo', { bonus: formatMoney(bonus) })} color={brand.vip} textColor="#1F1300" icon="gift" style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8 }} />
        )}
        <View style={{ gap: 4 }}>
          <Text variant="label">{t('wallet.tiersTitle')}</Text>
          {s.topupBonuses.map((tier) => (
            <Text key={tier.minAmount} variant="small" muted color={amount >= tier.minAmount ? c.primary : undefined}>
              • {t('wallet.tier', { min: formatMoney(tier.minAmount), pct: tier.bonusPercent })}
            </Text>
          ))}
          <Text variant="caption" muted>
            {t('wallet.bonusFirst')}
          </Text>
        </View>
        <Button title={`${t('wallet.topup')} · ${formatMoney(amount)}`} icon="card-outline" disabled={!valid} loading={topup.isPending} onPress={() => topup.mutate()} />
      </Card>
      <Text variant="h3">{t('wallet.transactions')}</Text>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={items}
      keyExtractor={(x) => x.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ padding: spacing.lg }}
      renderItem={({ item }) => <TxRow tx={item} label={te('walletTx', item.type)} date={fmtDateTime(item.createdAt)} />}
      ItemSeparatorComponent={Divider}
      refreshControl={
        <RefreshControl
          refreshing={tx.isRefetching}
          onRefresh={() => {
            wallet.refetch();
            tx.refetch();
          }}
          tintColor={c.primary}
        />
      }
      onEndReached={() => tx.hasNextPage && !tx.isFetchingNextPage && tx.fetchNextPage()}
      ListEmptyComponent={tx.isLoading ? <Skeleton height={60} /> : <EmptyState icon="swap-vertical-outline" title={t('wallet.empty')} />}
      ListFooterComponent={tx.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null}
    />
  );
}

function TxRow({ tx, label, date }: { tx: WalletTransaction; label: string; date: string }) {
  const { c } = useTheme();
  const positive = tx.amount > 0;
  return (
    <View style={styles.tx}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600' }}>{label}</Text>
        <Text variant="small" muted numberOfLines={1}>
          {tx.description}
        </Text>
        <Text variant="caption" muted>
          {date}
        </Text>
      </View>
      <Text style={{ fontWeight: '700' }} color={positive ? c.success : c.text}>
        {positive ? '+' : ''}
        {formatMoney(tx.amount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { borderRadius: radius.lg, padding: spacing.xl, gap: 4 },
  tx: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
});
