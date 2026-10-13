'use client';

import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { LOCALES, changePasswordSchema, formatPhone, updateMeSchema, type Locale } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { LOCALE_NAMES, switchLocalePath } from '@/lib/i18n';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Avatar, Badge, Button, Card, CardHeader, Input, Modal, Notice, PageHeader, PageSpinner, Select } from '@/components/ds';
import { UploadIcon } from '@/components/ds/icons';
import { ThemeOptions } from '@/components/layout/LanguageSwitcher';

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card as="section">
      <CardHeader title={title} sub={sub} />
      {children}
    </Card>
  );
}

function Profile() {
  const { t, locale, date } = useI18n();
  const { user, refresh, signOut } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [lang, setLang] = useState<Locale>(user?.locale ?? locale);
  const [avatar, setAvatar] = useState<string | null>(user?.avatarUrl ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!user) return;
    setName(user.name ?? '');
    setEmail(user.email ?? '');
    setAvatar(user.avatarUrl);
    setLang(user.locale);
  }, [user]);

  const save = useMutation({
    mutationFn: api.users.updateMe,
    onSuccess: (u) => {
      toast.success(t('profile.saved'));
      refresh();
      if (u.locale && u.locale !== locale) router.push(switchLocalePath(pathname, u.locale));
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim() || undefined, email: email.trim() || undefined, avatarUrl: avatar ? assetUrl(avatar) : null, locale: lang };
    const r = updateMeSchema.safeParse(body);
    if (!r.success) return setErrors(zodFieldErrors(r.error.issues, t));
    setErrors({});
    save.mutate(r.data as Parameters<typeof api.users.updateMe>[0]);
  };
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const u = await api.upload(f);
      setAvatar(u.thumbUrl || u.url);
    } catch (e) {
      toast.error(errorMessage(e, t));
    } finally {
      setUploading(false);
    }
  };

  // password
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const changePw = useMutation({
    mutationFn: api.users.changePassword,
    onSuccess: () => {
      toast.success(t('profile.passwordChanged'));
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    },
  });
  const submitPw = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return setPwErrors({ confirm: t('validation.passwordsMismatch') });
    const r = changePasswordSchema.safeParse({ currentPassword: pw.currentPassword || undefined, newPassword: pw.newPassword });
    if (!r.success) return setPwErrors(zodFieldErrors(r.error.issues, t));
    setPwErrors({});
    changePw.mutate(r.data);
  };

  // delete
  const [del, setDel] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const word = t('profile.deleteWord');
  const remove = useMutation({
    mutationFn: api.users.deleteMe,
    onSuccess: async () => {
      await signOut();
      router.replace(`/${locale}`);
    },
  });

  if (!user) return <PageSpinner />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader className="mb-1" title={t('account.nav.profile')} sub={t('profile.memberSince', { date: date(user.createdAt) })} />
      {sp.get('welcome') && <Notice tone="success">{t('profile.welcome')}</Notice>}

      <Section title={t('profile.personal')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div className="flex items-center gap-4">
            <Avatar name={user.name} url={avatar} size={80} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" loading={uploading} icon={<UploadIcon size={16} />} onClick={() => file.current?.click()}>
                {t('profile.uploadAvatar')}
              </Button>
              {avatar && <Button variant="ghost" size="sm" onClick={() => setAvatar(null)}>{t('common.delete')}</Button>}
            </div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={t('profile.uploadAvatar')} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('form.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" />
            <Input label={t('form.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="email" hint={user.email ? (user.isEmailVerified ? t('profile.verified') : t('profile.notVerified')) : undefined} />
            <Input label={t('form.phone')} value={user.phone ? formatPhone(user.phone) : '—'} disabled hint={user.isPhoneVerified ? t('profile.verified') : undefined} />
            <Select label={t('profile.language')} value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
            <Badge tone={user.accountType === 'BUSINESS' ? 'business' : 'neutral'} size="md">{t(`enums.accountType.${user.accountType}`)}</Badge>
          </div>
        </form>
      </Section>

      <Section title={t('profile.password')}>
        <form onSubmit={submitPw} className="grid gap-4 sm:grid-cols-3" noValidate>
          <Input label={t('profile.currentPassword')} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw((o) => ({ ...o, currentPassword: e.target.value }))} error={pwErrors.currentPassword} hint={t('profile.currentPasswordHint')} />
          <Input label={t('profile.newPassword')} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw((o) => ({ ...o, newPassword: e.target.value }))} error={pwErrors.newPassword} />
          <Input label={t('profile.confirmPassword')} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((o) => ({ ...o, confirm: e.target.value }))} error={pwErrors.confirm} />
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" loading={changePw.isPending}>{t('profile.changePassword')}</Button>
          </div>
        </form>
      </Section>

      <Section title={t('theme.title')} sub={t('theme.sub')}>
        <div className="max-w-md">
          <ThemeOptions />
        </div>
      </Section>

      <Section title={t('profile.danger')}>
        <p className="mb-4 text-label font-normal text-ink-secondary">{t('profile.deleteText')}</p>
        <Button variant="destructive" onClick={() => setDel(true)}>{t('profile.deleteAccount')}</Button>
      </Section>

      <Modal
        open={del}
        onClose={() => setDel(false)}
        size="sm"
        title={t('profile.deleteAccount')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDel(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={confirmText.trim().toLowerCase() !== word.toLowerCase()} loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('profile.deleteForever')}
            </Button>
          </>
        }
      >
        <Notice tone="error" className="mb-4">{t('profile.deleteWarning')}</Notice>
        <Input label={t('profile.typeToConfirm', { word })} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      </Modal>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Profile />
    </Suspense>
  );
}
