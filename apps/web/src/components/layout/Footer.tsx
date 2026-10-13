'use client';

import Link from 'next/link';
import { CITIES, localized } from '@evtap/shared';
import type { CmsPageLink } from '@/lib/api';
import { STATIC_PAGE_SLUGS, isLegalSlug, staticPageKey } from '@/lib/cms';
import { Card } from '@/components/ds';
import { AppleIcon, PlayIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';
import { Logo } from './Logo';

export function StoreBadges({ className }: { className?: string }) {
  const { t } = useI18n();
  const cls = 'press flex h-12 items-center gap-2.5 rounded-pill bg-ink pl-4 pr-5 text-on-ink hover:bg-ink-secondary';
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      <a href="#" aria-label="App Store" className={cls}>
        <AppleIcon size={20} />
        <span className="flex flex-col leading-none">
          <span className="text-[10px] opacity-70">{t('footer.downloadOn')}</span>
          <span className="text-[14px] font-medium">App Store</span>
        </span>
      </a>
      <a href="#" aria-label="Google Play" className={cls}>
        <PlayIcon size={18} />
        <span className="flex flex-col leading-none">
          <span className="text-[10px] opacity-70">{t('footer.getItOn')}</span>
          <span className="text-[14px] font-medium">Google Play</span>
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

/** CMS links: from GET /pages when available, else the static slugs with translated titles. */
export function usePageLinks(pages: CmsPageLink[] | null) {
  const { t } = useI18n();
  return pages && pages.length ? pages : STATIC_PAGE_SLUGS.map((slug) => ({ slug, title: t(staticPageKey(slug)) }));
}

export function Footer({ pages }: { pages: CmsPageLink[] | null }) {
  const { t, href, locale } = useI18n();
  const links = usePageLinks(pages);
  const company = links.filter((p) => !isLegalSlug(p.slug));
  const legal = links.filter((p) => isLegalSlug(p.slug));
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
    { title: t('footer.company'), links: [...company.map((p) => ({ href: href(`/pages/${p.slug}`), label: p.title })), { href: href('/business'), label: t('nav.business') }] },
    { title: t('footer.legal'), links: legal.map((p) => ({ href: href(`/pages/${p.slug}`), label: p.title })) },
  ].filter((c) => c.links.length);
  const popular = CITIES.filter((c) => c.popular).slice(0, 6);
  return (
    <footer className="container-page mt-16 pb-4 sm:pb-6">
      <Card pad="lg" className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <Logo href={href('/')} />
          <p className="mt-4 max-w-xs text-label font-normal text-ink-secondary">{t('footer.tagline')}</p>
          <StoreBadges className="mt-6" />
          <div className="mt-5 flex gap-2">
            {SOCIAL.map((s) => (
              <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.name} title={s.name} className="press flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-ink hover:bg-pill">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d={s.d} />
                </svg>
              </a>
            ))}
          </div>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="mb-3 font-sans text-caption font-normal text-muted">{c.title}</h2>
            <ul className="space-y-1">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-[14px] text-ink hover:underline hover:underline-offset-4">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <div className="flex flex-col gap-4 border-t border-hairline pt-6 md:col-span-4 md:flex-row md:items-center md:justify-between">
          <span className="text-caption text-muted">
            © {new Date().getFullYear()} EvTap. {t('footer.rights')}
          </span>
          <ul className="flex flex-wrap gap-2">
            {popular.map((c) => (
              <li key={c.id}>
                <Link href={href(`/search?cityId=${c.id}`)} className="press inline-flex h-9 items-center rounded-pill bg-surface-sunken px-3.5 text-label text-ink hover:bg-pill">
                  {localized(c.name, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </footer>
  );
}
