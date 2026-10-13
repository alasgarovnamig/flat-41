import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { formatMoney, type PaymentMethod } from '@evtap/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Button, Card, Text } from '@/components/ui';
import { PaymentMethodPicker } from '@/components/PaymentMethod';
import { useToast } from '@/components/Toast';
import { useCatalog } from '@/hooks/common';
import { completeCheckout, paymentReturnUrl } from '@/payments/pay';

/** Listing created as DRAFT (free quota exhausted) → pay LISTING_FEE via POST /checkout. */
export default function ListingFee() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { me } = useAuth();
  const { catalog } = useCatalog();
  const fee = me?.quota.listingFee ?? catalog.settings.listingFee;
  const [method, setMethod] = useState<PaymentMethod>('CARD');

  const pay = useMutation({
    mutationFn: () => api.checkout({ purpose: 'LISTING_FEE', listingId: id, method, returnUrl: paymentReturnUrl() }),
    onSuccess: (res) => completeCheckout(res, { listingId: id }),
    onError: toast.error,
  });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} style={{ backgroundColor: c.bg }}>
      <Card highlight style={{ gap: spacing.sm, alignItems: 'center' }}>
        <Ionicons name="receipt-outline" size={40} color={c.vip} />
        <Text variant="h2">{formatMoney(fee)}</Text>
        <Text muted style={{ textAlign: 'center' }}>
          {t('post.feeText')}
        </Text>
      </Card>
      <PaymentMethodPicker value={method} onChange={setMethod} amount={fee} />
      <View style={{ gap: spacing.sm }}>
        <Button title={t('post.payFee', { fee: formatMoney(fee) })} loading={pay.isPending} onPress={() => pay.mutate()} />
        <Button title={t('post.later')} kind="ghost" onPress={() => router.replace('/me/listings')} />
      </View>
    </ScrollView>
  );
}
