'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';

const KEY = 'evtap.cookies';

export function CookieNotice() {
  const { t, href } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(!window.localStorage.getItem(KEY));
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  const accept = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div role="region" aria-label={t('cookie.title')} className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-3xl rounded-2xl border border-line bg-white p-4 shadow-2xl animate-in sm:inset-x-6 sm:flex sm:items-center sm:gap-4">
      <p className="flex-1 text-sm text-ink/80">
        🍪 {t('cookie.text')}{' '}
        <Link href={href('/pages/privacy')} className="font-semibold text-brand underline-offset-2 hover:underline">
          {t('cookie.more')}
        </Link>
      </p>
      <Button onClick={accept} className="mt-3 w-full sm:mt-0 sm:w-auto">
        {t('cookie.accept')}
      </Button>
    </div>
  );
}
