import { HeroSearch } from '@/components/home/HeroSearch';
import { HomeSections } from '@/components/home/HomeSections';
import { WEB_URL } from '@/lib/config';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  const t = getT(locale);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'EvTap',
    url: `${WEB_URL}/${locale}`,
    potentialAction: { '@type': 'SearchAction', target: `${WEB_URL}/${locale}/search?q={query}`, 'query-input': 'required name=query' },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-dark via-brand to-teal-600 pb-16 pt-12 sm:pb-24 sm:pt-20">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" />
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-vip/30 blur-3xl" />
        <div className="container-page relative">
          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">{t('home.heroTitle')}</h1>
          <p className="mt-3 max-w-2xl text-base text-white/80 sm:text-lg">{t('home.heroSubtitle')}</p>
          <div className="mt-8">
            <HeroSearch />
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
            <span>✓ {t('home.heroPoint1')}</span>
            <span>✓ {t('home.heroPoint2')}</span>
            <span>✓ {t('home.heroPoint3')}</span>
          </div>
        </div>
      </section>
      <HomeSections />
    </>
  );
}
