import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { HouseIllustration, PageSpinner } from '@/components/ds';
import { CalendarIcon, ShieldCheckIcon, VerifiedIcon } from '@/components/ds/icons';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('auth.title'), robots: { index: false } };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const t = getT(toLocale((await params).locale));
  const points = [
    { icon: <VerifiedIcon size={18} />, text: t('home.trust1') },
    { icon: <CalendarIcon size={18} />, text: t('home.trust2') },
    { icon: <ShieldCheckIcon size={18} />, text: t('home.heroPoint3') },
  ];
  return (
    <div className="container-page grid items-center gap-8 py-8 sm:py-12 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:gap-12">
      <div className="flex justify-center lg:justify-start">
        <Suspense fallback={<PageSpinner />}>
          <LoginForm />
        </Suspense>
      </div>
      <div className="relative hidden overflow-hidden rounded-xl bg-surface p-10 shadow-card lg:block">
        <p className="max-w-md font-display text-[40px] font-light leading-[1.05] tracking-[-1.2px]">{t('home.heroTitle')}</p>
        <HouseIllustration className="fade-radial mt-6 w-full" />
        <ul className="mt-2 flex flex-wrap gap-2">
          {points.map((p) => (
            <li key={p.text} className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-raised px-4 text-label shadow-pill">
              {p.icon}
              {p.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
