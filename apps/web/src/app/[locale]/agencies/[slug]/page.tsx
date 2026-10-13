import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { formatPhone, getCity, localized, type Agency } from '@evtap/shared';
import { AgencyLogo } from '@/components/agencies/AgenciesView';
import { OwnerListings } from '@/components/listings/OwnerListings';
import { RetryError } from '@/components/RetryError';
import { Badge, BigNumber, Card } from '@/components/ds';
import { GlobeIcon, PhoneIcon, PinIcon, SendIcon } from '@/components/ds/icons';
import { api, isApiError } from '@/lib/api';
import { WEB_URL, assetUrl } from '@/lib/config';
import { formatDate, toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

type Props = { params: Promise<{ locale: string; slug: string }> };

const load = cache(async (slug: string): Promise<Agency | 'not_found' | 'error'> => {
  try {
    return await api.agencies.get(slug);
  } catch (e) {
    return isApiError(e) && (e.status === 404 || e.status === 400) ? 'not_found' : 'error';
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = getT(toLocale(locale));
  const a = await load(slug);
  if (typeof a === 'string') return { title: t('agencies.title') };
  const logo = assetUrl(a.logoUrl);
  return {
    title: `${a.name} — ${t(`enums.agencyType.${a.type}`)}`,
    description: a.description?.slice(0, 160) ?? t('agencies.metaDescription', { name: a.name }),
    alternates: { canonical: `/${locale}/agencies/${a.slug}` },
    openGraph: { title: a.name, images: logo ? [logo] : undefined, url: `${WEB_URL}/${locale}/agencies/${a.slug}` },
  };
}

const chip = 'inline-flex h-10 items-center gap-2 rounded-pill bg-surface-raised px-4 text-label shadow-pill';

export default async function AgencyPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  const locale = toLocale(raw);
  const t = getT(locale);
  const a = await load(slug);
  if (a === 'not_found') notFound();
  if (a === 'error') return <RetryError />;
  const city = a.cityId ? localized(getCity(a.cityId)?.name, locale) : null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: a.name,
    url: `${WEB_URL}/${locale}/agencies/${a.slug}`,
    logo: assetUrl(a.logoUrl) ?? undefined,
    telephone: a.phone ?? undefined,
    email: a.email ?? undefined,
    address: a.address ? { '@type': 'PostalAddress', streetAddress: a.address, addressLocality: city ?? undefined } : undefined,
  };
  return (
    <div className="container-page py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card pad="lg" className="flex flex-col gap-6 sm:flex-row">
          <AgencyLogo a={a} size={104} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-h1">{a.name}</h1>
              {a.verified && <Badge tone="verified" size="md">{t('agency.verified')}</Badge>}
              <Badge tone={a.type === 'DEVELOPER' ? 'info' : 'business'} size="md">{t(`enums.agencyType.${a.type}`)}</Badge>
            </div>
            {a.description && <p className="mt-3 whitespace-pre-line leading-relaxed text-ink-secondary">{a.description}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {city && (
                <span className={chip}>
                  <PinIcon size={16} /> {[city, a.address].filter(Boolean).join(', ')}
                </span>
              )}
              {a.phone && (
                <a href={`tel:${a.phone}`} className="press inline-flex h-10 items-center gap-2 rounded-pill bg-ink px-4 text-label font-medium text-on-ink">
                  <PhoneIcon size={16} /> {formatPhone(a.phone)}
                </a>
              )}
              {a.email && (
                <a href={`mailto:${a.email}`} className={chip}>
                  <SendIcon size={16} /> {a.email}
                </a>
              )}
              {a.website && (
                <a href={a.website} target="_blank" rel="noopener nofollow" className={chip}>
                  <GlobeIcon size={16} /> {a.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          </div>
        </Card>
        <Card className="flex flex-col justify-between gap-6">
          <div className="text-h3">{t('agencies.activeListings')}</div>
          <div>
            <BigNumber size="xl">{a.activeListings}</BigNumber>
            <div className="mt-1 text-label font-normal text-ink-secondary">{t('agencies.since', { date: formatDate(a.createdAt, locale, { month: 'long', year: 'numeric' }) })}</div>
          </div>
        </Card>
      </div>
      <OwnerListings agencyId={a.id} />
    </div>
  );
}
