import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { PageSpinner } from '@/components/ui/feedback';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('auth.title'), robots: { index: false } };
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-start justify-center bg-gradient-to-b from-brand-50 to-surface px-4 py-10 sm:items-center">
      <Suspense fallback={<PageSpinner />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
