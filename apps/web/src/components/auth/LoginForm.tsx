'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatPhone, loginSchema, otpRequestSchema, otpVerifySchema, registerSchema, type AuthResponse } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { Button, Input, Notice, Segmented } from '@/components/ds';
import { ArrowUpRightIcon, PhoneIcon } from '@/components/ds/icons';
import { LogoMark } from '@/components/layout/Logo';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

type Tab = 'phone' | 'email' | 'register';

const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null);

function useAfterLogin() {
  const { signIn } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const { href } = useI18n();
  return (res: AuthResponse) => {
    signIn(res);
    router.replace(safeNext(sp.get('next')) ?? (res.isNew ? href('/account/profile?welcome=1') : href('/account')));
  };
}

function PhoneOtp() {
  const { t } = useI18n();
  const done = useAfterLogin();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [normalized, setNormalized] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string>();
  const [cooldown, setCooldown] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const request = useMutation({
    mutationFn: api.auth.requestOtp,
    meta: { silent: true },
    onSuccess: (r) => {
      setStep('code');
      setDevCode(r.devCode);
      setCooldown(r.retryAfter || 60);
      setFormError(undefined);
    },
    onError: (e) => setFormError(errorMessage(e, t)),
  });
  const verify = useMutation({ mutationFn: api.auth.verifyOtp, meta: { silent: true }, onSuccess: done, onError: (e) => setFormError(errorMessage(e, t)) });

  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    const r = otpRequestSchema.safeParse({ phone });
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    setNormalized(r.data.phone);
    request.mutate({ phone: r.data.phone });
  };
  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const r = otpVerifySchema.safeParse({ phone: normalized, code: code.trim(), name: name.trim() || undefined });
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    verify.mutate(r.data);
  };

  if (step === 'phone')
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
        <Input label={t('auth.phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="050 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} hint={t('auth.phoneHint')} leading={<PhoneIcon size={18} />} autoFocus />
        {formError && <Notice tone="error">{formError}</Notice>}
        <Button type="submit" size="lg" loading={request.isPending} trailing={<ArrowUpRightIcon size={18} />}>
          {t('auth.getCode')}
        </Button>
      </form>
    );
  return (
    <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
      <p className="text-label font-normal text-ink-secondary">
        {t('auth.codeSent', { phone: formatPhone(normalized) })}{' '}
        <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => { setStep('phone'); setCode(''); }}>
          {t('auth.changePhone')}
        </button>
      </p>
      {devCode && (
        <Notice tone="neutral">
          {t('auth.devCode')}: <b className="font-mono tracking-widest">{devCode}</b>
        </Notice>
      )}
      <Input
        label={t('auth.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="••••••"
        className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        error={errors.code}
        autoFocus
      />
      <Input label={t('auth.nameOptional')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} hint={t('auth.nameHint')} />
      {formError && <Notice tone="error">{formError}</Notice>}
      <Button type="submit" size="lg" loading={verify.isPending}>
        {t('auth.signIn')}
      </Button>
      <Button variant="ghost" disabled={cooldown > 0 || request.isPending} onClick={() => sendCode()}>
        {cooldown > 0 ? t('auth.resendIn', { s: cooldown }) : t('auth.resend')}
      </Button>
    </form>
  );
}

function EmailLogin() {
  const { t } = useI18n();
  const done = useAfterLogin();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const m = useMutation({ mutationFn: api.auth.login, meta: { silent: true }, onSuccess: done, onError: (e) => setFormError(errorMessage(e, t)) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = loginSchema.safeParse({ login, password });
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    m.mutate(r.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input label={t('auth.login')} autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} error={errors.login} placeholder="name@mail.az" />
      <Input label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
      {formError && <Notice tone="error">{formError}</Notice>}
      <Button type="submit" size="lg" loading={m.isPending}>
        {t('auth.signIn')}
      </Button>
    </form>
  );
}

function Register() {
  const { t } = useI18n();
  const done = useAfterLogin();
  const [v, setV] = useState({ name: '', email: '', password: '', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const m = useMutation({ mutationFn: api.auth.register, meta: { silent: true }, onSuccess: done, onError: (e) => setFormError(errorMessage(e, t)) });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = registerSchema.safeParse({ ...v, phone: v.phone.trim() || undefined });
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    m.mutate(r.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input label={t('form.name')} autoComplete="name" value={v.name} onChange={set('name')} error={errors.name} required />
      <Input label={t('form.email')} type="email" autoComplete="email" value={v.email} onChange={set('email')} error={errors.email} required />
      <Input label={t('auth.password')} type="password" autoComplete="new-password" value={v.password} onChange={set('password')} error={errors.password} hint={t('auth.passwordHint')} required />
      <Input label={t('auth.phoneOptional')} type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} error={errors.phone} placeholder="050 123 45 67" />
      {formError && <Notice tone="error">{formError}</Notice>}
      <Button type="submit" size="lg" loading={m.isPending}>
        {t('auth.createAccount')}
      </Button>
    </form>
  );
}

export function LoginForm() {
  const { t, href } = useI18n();
  const { status } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'phone');
  useEffect(() => {
    if (status === 'authenticated') router.replace(safeNext(sp.get('next')) ?? href('/account'));
  }, [status, router, sp, href]);

  return (
    <div className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-raised sm:p-8">
      <div className="mb-6 flex flex-col items-start">
        <LogoMark size={48} />
        <h1 className="mt-5 text-h1">{tab === 'register' ? t('auth.registerTitle') : t('auth.title')}</h1>
        <p className="mt-1 text-label font-normal text-ink-secondary">{t('auth.subtitle')}</p>
      </div>
      <Segmented
        block
        className="mb-6"
        ariaLabel={t('auth.title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'phone', label: t('auth.tabPhone') },
          { value: 'email', label: t('auth.tabEmail') },
          { value: 'register', label: t('auth.tabRegister') },
        ]}
      />
      {tab === 'phone' && <PhoneOtp />}
      {tab === 'email' && <EmailLogin />}
      {tab === 'register' && <Register />}
      <p className="mt-6 text-caption text-muted">{t('auth.terms')}</p>
    </div>
  );
}
