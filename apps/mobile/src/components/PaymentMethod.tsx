import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type PaymentMethod } from '@evtap/shared';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { radius, spacing, useTheme } from '../theme';
import { Text } from './ui';

/** Wallet vs card selector. Wallet shows the balance and is disabled when it can't cover `amount`. */
export function PaymentMethodPicker({ value, onChange, amount, allowWallet = true }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; amount: number; allowWallet?: boolean }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  const balance = (me?.wallet.balance ?? 0) + (me?.wallet.bonusBalance ?? 0);
  const enough = balance >= amount;

  const Option = ({ m, icon, title, subtitle, disabled }: { m: PaymentMethod; icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; disabled?: boolean }) => {
    const selected = value === m;
    return (
      <Pressable
        disabled={disabled}
        onPress={() => onChange(m)}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, disabled }}
        style={[styles.opt, { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primarySoft : c.card, opacity: disabled ? 0.5 : 1 }]}
      >
        <Ionicons name={icon} size={22} color={selected ? c.primary : c.text} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '600' }}>{title}</Text>
          {subtitle && (
            <Text variant="small" muted={enough || m !== 'WALLET'} color={!enough && m === 'WALLET' ? c.danger : undefined}>
              {subtitle}
            </Text>
          )}
        </View>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? c.primary : c.muted} />
      </Pressable>
    );
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{t('payment.method')}</Text>
      {allowWallet && (
        <Option
          m="WALLET"
          icon="wallet-outline"
          title={t('payment.wallet')}
          subtitle={enough ? t('payment.walletBalance', { amount: formatMoney(balance) }) : `${t('payment.insufficient')} · ${formatMoney(balance)}`}
          disabled={!enough}
        />
      )}
      <Option m="CARD" icon="card-outline" title={t('payment.card')} subtitle="Visa · Mastercard" />
    </View>
  );
}

const styles = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, minHeight: 56 },
});
