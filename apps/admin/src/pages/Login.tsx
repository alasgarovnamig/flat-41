import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { AlertCircle, Languages, LogIn, Moon, Sun } from 'lucide-react';
import { loginSchema } from '@evtap/shared';
import { errorMessage, ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { FormField, Input } from '../components/FormField';
import { Button } from '../components/ui';
import { MOCK } from '../env';
import { useT } from '../i18n';
import { useTheme } from '../lib/hooks';

export function LoginPage() {
  const { status, login, notice } = useAuth();
  const { t, lang, setLang } = useT();
  const { dark, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ login: MOCK ? 'admin@evtap.az' : '', password: MOCK ? 'Admin12345!' : '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to={(loc.state as { from?: string } | null)?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setError(t('Enter your email and password.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(parsed.data.login, parsed.data.password);
      nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setError(t('Invalid email or password.'));
      else if (err instanceof ApiRequestError && err.status === 429) setError(t('Too many attempts. Try again in a minute.'));
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-4 right-4 flex gap-1">
        <button onClick={() => setLang(lang === 'en' ? 'az' : 'en')} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-hover">
          <Languages className="size-4" />
          {lang.toUpperCase()}
        </button>
        <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-hover" aria-label={t('Toggle theme')}>
          {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-3 size-12" />
          <h1 className="text-xl font-semibold tracking-tight">EvTap Admin</h1>
          <p className="mt-1 text-sm text-muted">{t('Back-office for administrators and moderators')}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-card p-6 shadow-sm" noValidate>
          {(error || notice) && (
            <div role="alert" className="flex gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error ?? notice}</span>
            </div>
          )}
          <FormField label={t('Email or phone')} htmlFor="login">
            <Input id="login" autoComplete="username" autoFocus value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="admin@evtap.az" />
          </FormField>
          <FormField label={t('Password')} htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </FormField>
          <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<LogIn className="size-4" />}>
            {t('Sign in')}
          </Button>
          {MOCK && <p className="text-center text-xs text-muted">{t('Mock mode: use admin@evtap.az or moderator@evtap.az with any password.')}</p>}
        </form>
      </div>
    </div>
  );
}
