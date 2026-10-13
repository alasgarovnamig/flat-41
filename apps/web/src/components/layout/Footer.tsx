'use client';

import Link from 'next/link';
import { CITIES, localized } from '@evtap/shared';
import { useI18n } from '@/components/providers/I18nProvider';
import { AppleIcon, PlayIcon } from '@/components/ui/icons';
import { Logo } from './Logo';

export function StoreBadges({ dark = true }: { dark?: boolean }) {
  const { t } = useI18n();
  const cls = dark ? 'bg-ink text-white hover:bg-black' : 'bg-white text-ink hover:bg-white/90';
  return (
    <div className="flex flex-wrap gap-2">
      <a href="#" aria-label="App Store" className={`flex h-11 items-center gap-2 rounded-xl px-3.5 ${cls}`}>
        <AppleIcon size={22} />
        <span className="flex flex-col leading-none">
          <span className="text-[10px] opacity-75">{t('footer.downloadOn')}</span>
          <span className="text-sm font-semibold">App Store</span>
        </span>
      </a>
      <a href="#" aria-label="Google Play" className={`flex h-11 items-center gap-2 rounded-xl px-3.5 ${cls}`}>
        <PlayIcon size={18} />
        <span className="flex flex-col leading-none">
          <span className="text-[10px] opacity-75">{t('footer.getItOn')}</span>
          <span className="text-sm font-semibold">Google Play</span>
        </span>
      </a>
    </div>
  );
}

const SOCIAL = [
  { name: 'Instagram', href: 'https://instagram.com/', d: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5zm5.2-1.7a1 1 0 1 0 1 1 1 1 0 0 0-1-1z' },
  { name: 'Facebook', href: 'https://facebook.com/', d: 'M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z' },
  { name: 'TikTok', href: 'https://tiktok.com/', d: 'M16 3c.3 2.3 1.7 3.8 4 4v3.2a7.5 7.5 0 0 1-4-1.2V15a6 6 0 1 1-6-6v3.3A2.7 2.7 0 1 0 12.7 15V3z' },
  { name: 'YouTube', href: 'https://youtube.com/', d: 'M22 8.2a3 3 0 0 0-2.1-2.1C18 5.5 12 5.5 12 5.5s-6 0-7.9.6A3 3 0 0 0 2 8.2 31 31 0 0 0 1.5 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.6 7.9.6 7.9.6s6 0 7.9-.6a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-3.8 31 31 0 0 0-.5-3.8zM10 15V9l5.2 3z' },
];

export function Footer() {
  const { t, href, locale } = useI18n();
  const cols = [
    {
      title: t('footer.platform'),
      links: [
        { href: href('/search?dealType=SALE'), label: t('nav.sale') },
        { href: href('/search?dealType=RENT_LONG'), label: t('nav.rent') },
        { href: href('/search?dealType=RENT_DAILY'), label: t('nav.daily') },
        { href: href('/agencies'), label: t('nav.agencies') },
        { href: href('/listings/new'), label: t('nav.postAd') },
      ],
    },
    {
      title: t('footer.company'),
      links: [
        { href: href('/pages/about'), label: t('footer.about') },
        { href: href('/business'), label: t('nav.business') },
        { href: href('/pages/pricing-info'), label: t('footer.pricingInfo') },
        { href: href('/pages/help'), label: t('footer.help') },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { href: href('/pages/terms'), label: t('footer.terms') },
        { href: href('/pages/privacy'), label: t('footer.privacy') },
      ],
    },
  ];
  const popular = CITIES.filter((c) => c.popular).slice(0, 6);
  return (
    <footer className="mt-16 bg-ink text-white/80">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo href={href('/')} light />
          <p className="mt-3 max-w-xs text-sm text-white/60">{t('footer.tagline')}</p>
          <div className="mt-5">
            <StoreBadges dark={false} />
          </div>
          <div className="mt-5 flex gap-2">
            {SOCIAL.map((s) => (
              <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.name} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d={s.d} />
                </svg>
              </a>
            ))}
          </div>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">{c.title}</h3>
            <ul className="space-y-2 text-sm">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-3 py-5 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} EvTap. {t('footer.rights')}</span>
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {popular.map((c) => (
              <Link key={c.id} href={href(`/search?cityId=${c.id}`)} className="hover:text-white">
                {localized(c.name, locale)}
              </Link>
            ))}
          </span>
        </div>
      </div>
    </footer>
  );
}
