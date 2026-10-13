import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { formatPhone } from '@evtap/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Button, Field, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { IS_DEV } from '@/config';

const LEN = 6;

export default function VerifyCode() {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ phone: string; retryAfter?: string; devCode?: string }>();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [left, setLeft] = useState(Number(params.retryAfter ?? 60));
  const [devCode, setDevCode] = useState(params.devCode ?? '');
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const verify = useMutation({
    mutationFn: (c6: string) => api.verifyOtp({ phone: params.phone, code: c6, name: name.trim().length >= 2 ? name.trim() : undefined }),
    onSuccess: async (res) => {
      await signIn(res);
      toast.success(t('auth.welcome', { name: res.user.name }));
      // Pop verify + login, back to where the user came from.
      if (router.canDismiss()) router.dismiss(2);
      else router.replace('/');
    },
    onError: (e) => {
      setCode('');
      toast.error(e);
      input.current?.focus();
    },
  });

  const resend = useMutation({
    mutationFn: () => api.requestOtp(params.phone),
    onSuccess: (r) => {
      setLeft(r.retryAfter ?? 60);
      setDevCode(r.devCode ?? '');
    },
    onError: toast.error,
  });

  const onChange = (s: string) => {
    const d = s.replace(/\D/g, '').slice(0, LEN);
    setCode(d);
    if (d.length === LEN && !verify.isPending) verify.mutate(d); // auto-submit
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="h1">{t('auth.codeTitle')}</Text>
        <Text muted>{t('auth.codeSentTo', { phone: formatPhone(params.phone) })}</Text>

        <Pressable onPress={() => input.current?.focus()} style={styles.boxes} accessibilityLabel={t('auth.codeTitle')}>
          {Array.from({ length: LEN }).map((_, i) => {
            const active = i === code.length && !verify.isPending;
            return (
              <View key={i} style={[styles.box, { borderColor: active ? c.primary : c.border, backgroundColor: c.inputBg }]}>
                <Text variant="h2">{code[i] ?? ''}</Text>
              </View>
            );
          })}
          <TextInput
            ref={input}
            value={code}
            onChangeText={onChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={LEN}
            autoFocus
            caretHidden
            style={styles.hidden}
            accessibilityLabel={t('auth.codeTitle')}
          />
        </Pressable>

        {(IS_DEV || !!devCode) && !!devCode && (
          <Pressable onPress={() => onChange(devCode)} style={[styles.dev, { backgroundColor: c.highlightBg, borderColor: c.vip }]} accessibilityRole="button">
            <Text>{t('auth.devCode', { code: devCode })}</Text>
          </Pressable>
        )}

        <Field label={`${t('auth.name')} (${t('common.optional')})`} hint={t('auth.nameHint')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={80} />

        <Button title={t('common.continue')} disabled={code.length < 4} loading={verify.isPending} onPress={() => verify.mutate(code)} />

        {left > 0 ? (
          <Text muted style={{ textAlign: 'center' }}>
            {t('auth.resendIn', { s: left })}
          </Text>
        ) : (
          <Button title={t('auth.resend')} kind="ghost" loading={resend.isPending} onPress={() => resend.mutate()} />
        )}
        <Button title={t('auth.changeNumber')} kind="ghost" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: { flex: 1, aspectRatio: 0.85, maxWidth: 56, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  dev: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
});
