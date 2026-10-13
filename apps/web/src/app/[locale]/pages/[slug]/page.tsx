import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { CmsPage } from '@evtap/shared';
import { Markdown } from '@/components/Markdown';
import { RetryError } from '@/components/RetryError';
import { Card } from '@/components/ds';
import { api, isApiError } from '@/lib/api';
import { STATIC_PAGE_SLUGS, fetchPageLinks, staticPageKey } from '@/lib/cms';
import { formatDate, toLocale, type Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; slug: string }> };

const load = cache(async (slug: string): Promise<CmsPage | 'not_found' | 'error'> => {
  if (!/^[a-z0-9-]+$/.test(slug)) return 'not_found';
  try {
    return await api.ref.page(slug);
  } catch (e) {
    return isApiError(e) && e.status === 404 ? 'not_found' : 'error';
  }
});

const pick = (r: Record<Locale, string>, l: Locale) => r[l] || r.az || r.en || '';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = toLocale(raw);
  const p = await load(slug);
  if (typeof p === 'string') return { title: getT(locale)(staticPageKey(slug)) };
  return {
    title: pick(p.title, locale),
    description: pick(p.body, locale).replace(/[#*_[\]()]/g, '').slice(0, 160),
    alternates: { canonical: `/${locale}/pages/${slug}` },
  };
}

export default async function CmsPageView({ params }: Props) {
  const { locale: raw, slug } = await params;
  const locale = toLocale(raw);
  const t = getT(locale);
  const [p, index] = await Promise.all([load(slug), fetchPageLinks(locale)]);
  if (p === 'not_found') notFound();
  if (p === 'error') return <RetryError />;
  // page navigation: the CMS index (GET /pages) when available, else the static slugs
  const links = index?.length ? index : STATIC_PAGE_SLUGS.map((s) => ({ slug: s, title: t(staticPageKey(s)) }));
  return (
    <div className="container-page grid gap-6 py-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:py-10">
      <nav aria-label={t('footer.company')}>
        <ul className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 lg:sticky lg:top-28 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:rounded-xl lg:bg-surface lg:p-3 lg:shadow-card">
          {links.map((l) => (
            <li key={l.slug} className="shrink-0">
              <Link
                href={`/${locale}/pages/${l.slug}`}
                aria-current={l.slug === slug ? 'page' : undefined}
                className={cn('press flex h-11 items-center rounded-pill px-4 text-[14px] font-medium', l.slug === slug ? 'bg-ink text-on-ink' : 'bg-pill text-ink hover:bg-pill-hover lg:bg-transparent lg:hover:bg-surface-sunken')}
              >
                {l.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Card as="article" pad="lg" className="max-w-3xl">
        <h1 className="text-[36px] font-normal leading-tight tracking-[-1px]">{pick(p.title, locale)}</h1>
        <p className="mb-8 mt-3 inline-flex h-8 items-center rounded-pill bg-surface-sunken px-3 text-caption text-ink-secondary">{t('pages.updated', { date: formatDate(p.updatedAt, locale) })}</p>
        <Markdown source={pick(p.body, locale)} />
      </Card>
    </div>
  );
}
