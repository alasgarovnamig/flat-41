import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { CmsPage } from '@evtap/shared';
import { Markdown } from '@/components/Markdown';
import { RetryError } from '@/components/RetryError';
import { api, isApiError } from '@/lib/api';
import { formatDate, toLocale, type Locale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

type Props = { params: Promise<{ locale: string; slug: string }> };

const STATIC_PAGES = ['about', 'terms', 'privacy', 'help', 'pricing-info'] as const;

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
  if (typeof p === 'string') return { title: getT(locale)(`footer.${slug === 'pricing-info' ? 'pricingInfo' : slug}`) };
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
  const p = await load(slug);
  if (p === 'not_found') notFound();
  if (p === 'error') return <RetryError />;
  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[220px_1fr]">
      <nav aria-label={t('footer.company')} className="hidden lg:block">
        <ul className="sticky top-20 space-y-1 text-sm">
          {STATIC_PAGES.map((s) => (
            <li key={s}>
              <Link href={`/${locale}/pages/${s}`} aria-current={s === slug ? 'page' : undefined} className={`block rounded-lg px-3 py-2 ${s === slug ? 'bg-brand-50 font-semibold text-brand-dark' : 'text-ink/80 hover:bg-white'}`}>
                {t(`footer.${s === 'pricing-info' ? 'pricingInfo' : s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="card max-w-3xl p-6 sm:p-10">
        <h1 className="mb-2 text-3xl font-bold tracking-tight">{pick(p.title, locale)}</h1>
        <p className="mb-6 text-xs text-muted">{t('pages.updated', { date: formatDate(p.updatedAt, locale) })}</p>
        <Markdown source={pick(p.body, locale)} />
      </article>
    </div>
  );
}
