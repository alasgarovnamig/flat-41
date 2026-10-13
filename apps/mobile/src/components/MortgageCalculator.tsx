import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatPrice, mortgageLeadSchema, mortgageMonthly, phoneSchema, type Currency } from '@evtap/shared';
import { api } from '../api/client';
import { qk } from '../api/queryClient';
import { useI18n } from '../i18n';
import { spacing, useTheme } from '../theme';
import { Button, Card, Chip, Field, Text } from './ui';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { useAuth } from '../auth/AuthContext';
import { formatLocalPhone, toLocalDigits } from '../lib/phone';

const DOWN = [10, 20, 30, 40, 50];
const TERMS = [5, 10, 15, 20, 25];

export function MortgageCalculator({ price, currency, listingId }: { price: number; currency: Currency; listingId?: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { me } = useAuth();
  const banks = useQuery({ queryKey: qk.mortgageBanks, queryFn: api.mortgageBanks, staleTime: 60 * 60_000 });
  const [bank, setBank] = useState<string | null>(null);
  const [downPct, setDownPct] = useState(20);
  const [years, setYears] = useState(15);
  const selectedBank = banks.data?.find((b) => b.code === bank) ?? banks.data?.[0];
  const rate = selectedBank?.annualRate ?? 12;
  const down = Math.round((price * downPct) / 100);
  const monthly = useMemo(() => mortgageMonthly(price - down, rate, years), [price, down, rate, years]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me?.name ?? '');
  const [phone, setPhone] = useState(toLocalDigits(me?.phone));
  const lead = useMutation({
    mutationFn: () => {
      const body = mortgageLeadSchema.parse({
        name,
        phone: phoneSchema.parse(`+994${phone}`),
        listingId: listingId ?? null,
        price,
        downPayment: down,
        termYears: years,
        bankCode: selectedBank?.code ?? null,
      });
      return api.mortgageLead(body);
    },
    onSuccess: () => {
      setOpen(false);
      toast.success(t('mortgage.sent'));
    },
    onError: toast.error,
  });

  return (
    <Card style={{ gap: spacing.md }}>
      <Text variant="h3">{t('mortgage.title')}</Text>
      {!!banks.data?.length && (
        <>
          <Text variant="label">{t('mortgage.bank')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {banks.data.map((b) => (
              <Chip key={b.code} label={`${b.name} · ${b.annualRate}%`} selected={selectedBank?.code === b.code} onPress={() => setBank(b.code)} />
            ))}
          </ScrollView>
        </>
      )}
      <Text variant="label">
        {t('mortgage.downPayment')}: {formatPrice(down, currency)}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {DOWN.filter((p) => !selectedBank || p >= selectedBank.minDownPaymentPercent).map((p) => (
          <Chip key={p} label={`${p}%`} selected={downPct === p} onPress={() => setDownPct(p)} />
        ))}
      </View>
      <Text variant="label">{t('mortgage.term')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {TERMS.filter((y) => !selectedBank || y <= selectedBank.maxTermYears).map((y) => (
          <Chip key={y} label={`${y} ${t('common.yearsShort')}`} selected={years === y} onPress={() => setYears(y)} />
        ))}
      </View>
      <View style={{ backgroundColor: c.primarySoft, borderRadius: 12, padding: spacing.md }}>
        <Text variant="small" muted>
          {t('mortgage.monthly')} · {t('mortgage.rate')} {rate}%
        </Text>
        <Text variant="h2" color={c.primary}>
          {formatPrice(monthly, currency)}
        </Text>
      </View>
      <Button title={t('mortgage.apply')} kind="secondary" onPress={() => setOpen(true)} />

      <Sheet visible={open} onClose={() => setOpen(false)} title={t('mortgage.applyTitle')}>
        <Field label={t('mortgage.name')} value={name} onChangeText={setName} autoComplete="name" />
        <Field
          label={t('mortgage.phone')}
          value={formatLocalPhone(phone)}
          onChangeText={(s) => setPhone(s.replace(/\D/g, '').replace(/^0/, '').slice(0, 9))}
          keyboardType="phone-pad"
          left={<Text style={{ fontWeight: '600' }}>+994</Text>}
        />
        <Text muted variant="small">
          {formatPrice(price, currency)} · {t('mortgage.downPayment')} {formatPrice(down, currency)} · {years} {t('common.yearsShort')}
        </Text>
        <Button title={t('common.send')} loading={lead.isPending} disabled={name.trim().length < 2 || phone.length < 9} onPress={() => lead.mutate()} />
      </Sheet>
    </Card>
  );
}
