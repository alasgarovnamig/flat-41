'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LOCALES, type Locale } from '@evtap/shared';
import { LOCALE_NAMES, LOCALE_SHORT, switchLocalePath } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { CheckIcon, GlobeIcon } from '@/components/ui/icons';

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);
  const go = (l: Locale) => {
    setOpen(false);
    document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
    const qs = window.location.search.replace(/^\?/, '');
    router.push(switchLocalePath(pathname, l) + (qs ? `?${qs}` : ''));
  };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('header.language')}
        className="flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold text-ink hover:bg-ink/5"
      >
        <GlobeIcon size={18} />
        {!compact && LOCALE_SHORT[locale]}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-xl animate-in">
          {LOCALES.map((l) => (
            <button
              key={l}
              role="menuitemradio"
              aria-checked={l === locale}
              type="button"
              onClick={() => go(l)}
              className={cn('flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-surface', l === locale && 'font-semibold text-brand')}
            >
              <span>
                <span className="mr-2 inline-block w-6 text-xs font-bold text-muted">{LOCALE_SHORT[l]}</span>
                {LOCALE_NAMES[l]}
              </span>
              {l === locale && <CheckIcon size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
