import { HeroSearch } from '@/components/home/HeroSearch';
import { HeroMarket, HomeSections } from '@/components/home/HomeSections';
import { Badge, HouseIllustration } from '@/components/ds';
import { CheckIcon } from '@/components/ds/icons';
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
      <section className="relative overflow-hidden" aria-labelledby="hero-title">
        <div className="container-page grid items-center gap-6 pb-8 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:pb-10 lg:pt-8">
          <div className="relative z-[1] min-w-0">
            <Badge tone="glass" size="md" className="mb-5 shadow-pill">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-strong" aria-hidden /> {t('home.heroEyebrow')}
            </Badge>
            <h1 id="hero-title" className="max-w-[13ch] font-display text-[44px] font-light leading-[1.02] tracking-[-1.6px] text-ink sm:text-[58px] sm:tracking-[-2.2px] xl:text-[68px]">
              {t('home.heroTitle')}
            </h1>
            <p className="mt-4 max-w-xl text-body text-ink-secondary sm:text-[17px] sm:leading-7">{t('home.heroSubtitle')}</p>
            <div className="mt-7 max-w-2xl">
              <HeroSearch />
            </div>
            <ul className="mt-5 flex flex-wrap gap-2">
              {[t('home.heroPoint1'), t('home.heroPoint2'), t('home.heroPoint3')].map((p) => (
                <li key={p} className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-sunken px-3.5 text-label text-ink-secondary">
                  <CheckIcon size={14} strokeWidth={2} className="text-ink" /> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative min-w-0 lg:-mr-8 xl:-mr-12">
            <div className="fade-radial">
              <HouseIllustration className="mx-auto w-full max-w-[680px]" />
            </div>
            <div className="relative mt-2 lg:mr-8 xl:mr-12">
              <HeroMarket />
            </div>
          </div>
        </div>
      </section>
      <HomeSections />
    </>
  );
}
