import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { loginSchema, registerSchema } from '@evtap/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Button, Field, Segmented, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';

/** Email / password login + registration (validated with the shared zod schemas). */
export default function EmailLogin() {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', login: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'login') {
        const p = loginSchema.safeParse({ login: form.login, password: form.password });
        if (!p.success) throw p.error;
        return api.login(p.data);
      }
      const p = registerSchema.safeParse({ name: form.name, email: form.email, password: form.password });
      if (!p.success) throw p.error;
      return api.register(p.data);
    },
    onSuccess: async (res) => {
      await signIn(res);
      toast.success(t('auth.welcome', { name: res.user.name }));
      if (router.canDismiss()) router.dismiss(2);
      else router.replace('/');
    },
    onError: (e) => {
      const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
      if (issues) {
        setErrors(Object.fromEntries(issues.map((i) => [String(i.path[0]), i.message])));
        return;
      }
      toast.error(e);
    },
    onMutate: () => setErrors({}),
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="h1">{mode === 'login' ? t('auth.signIn') : t('auth.signUp')}</Text>
        <Segmented
          options={[
            { value: 'login', label: t('auth.signIn') },
            { value: 'register', label: t('auth.signUp') },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'register' && <Field label={t('auth.name')} value={form.name} onChangeText={set('name')} error={errors.name} autoComplete="name" textContentType="name" />}
        {mode === 'login' ? (
          <Field label={t('auth.login')} value={form.login} onChangeText={set('login')} error={errors.login} autoCapitalize="none" autoComplete="username" keyboardType="email-address" />
        ) : (
          <Field label={t('auth.email')} value={form.email} onChangeText={set('email')} error={errors.email} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        )}
        <Field
          label={t('auth.password')}
          value={form.password}
          onChangeText={set('password')}
          error={errors.password}
          secureTextEntry
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          onSubmitEditing={() => submit.mutate()}
        />
        <Button title={mode === 'login' ? t('auth.signIn') : t('auth.signUp')} loading={submit.isPending} onPress={() => submit.mutate()} />
        <Button title={t('auth.phoneLogin')} kind="ghost" icon="phone-portrait-outline" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
