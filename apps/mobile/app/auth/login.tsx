import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { phoneSchema } from '@evtap/shared';
import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { brand, spacing, useTheme } from '@/theme';
import { Button, Field, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { formatLocalPhone } from '@/lib/phone';

export default function PhoneLogin() {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const [digits, setDigits] = useState('');

  const parsed = phoneSchema.safeParse(`+994${digits}`);
  const request = useMutation({
    mutationFn: (phone: string) => api.requestOtp(phone),
    onSuccess: (res, phone) =>
      router.push({ pathname: '/auth/verify', params: { phone, retryAfter: String(res.retryAfter ?? 60), devCode: res.devCode ?? '' } }),
    onError: toast.error,
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>E</Text>
        </View>
        <Text variant="h1">{t('auth.title')}</Text>
        <Text muted>{t('auth.subtitle')}</Text>
        <Field
          label={t('auth.phone')}
          value={formatLocalPhone(digits)}
          onChangeText={(s) => setDigits(s.replace(/\D/g, '').replace(/^0/, '').slice(0, 9))}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          placeholder="50 123 45 67"
          autoFocus
          left={<Text style={{ fontWeight: '600' }}>🇦🇿 +994</Text>}
          returnKeyType="done"
          onSubmitEditing={() => parsed.success && request.mutate(parsed.data)}
        />
        <Button title={t('auth.sendCode')} disabled={!parsed.success} loading={request.isPending} onPress={() => parsed.success && request.mutate(parsed.data)} />
        <Button title={t('auth.emailLogin')} kind="ghost" icon="mail-outline" onPress={() => router.push('/auth/email')} />
        <Text variant="small" muted style={{ textAlign: 'center' }}>
          {t('auth.agree')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
