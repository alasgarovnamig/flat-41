'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ds';
import { useI18n } from '@/components/providers/I18nProvider';

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
    <div role="region" aria-label={t('cookie.title')} className="glass fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-2xl flex-col gap-3 rounded-xl p-4 shadow-raised animate-in sm:inset-x-6 sm:flex-row sm:items-center sm:gap-4 sm:pl-6">
      <p className="flex-1 text-label font-normal text-ink-secondary">
        {t('cookie.text')}{' '}
        <Link href={href('/pages/privacy')} className="font-medium text-ink underline underline-offset-2">
          {t('cookie.more')}
        </Link>
      </p>
      <Button onClick={accept} className="w-full sm:w-auto">
        {t('cookie.accept')}
      </Button>
    </div>
  );
}
