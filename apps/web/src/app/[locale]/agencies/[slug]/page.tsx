import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { formatPhone, getCity, localized, type Agency } from '@evtap/shared';
import { AgencyLogo } from '@/components/agencies/AgenciesView';
import { OwnerListings } from '@/components/listings/OwnerListings';
import { RetryError } from '@/components/RetryError';
import { Badge } from '@/components/ui/feedback';
import { PhoneIcon, PinIcon, ShieldCheckIcon } from '@/components/ui/icons';
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
      <div className="card mb-8 flex flex-col gap-5 p-6 sm:flex-row">
        <AgencyLogo a={a} size={96} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold sm:text-3xl">{a.name}</h1>
            {a.verified && (
              <Badge tone="brand" icon={<ShieldCheckIcon size={12} />}>
                {t('agency.verified')}
              </Badge>
            )}
            <Badge tone={a.type === 'DEVELOPER' ? 'blue' : 'gray'}>{t(`enums.agencyType.${a.type}`)}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {city && <span className="flex items-center gap-1"><PinIcon size={14} /> {[city, a.address].filter(Boolean).join(', ')}</span>}
            {a.phone && <a href={`tel:${a.phone}`} className="flex items-center gap-1 font-semibold text-brand"><PhoneIcon size={14} /> {formatPhone(a.phone)}</a>}
            {a.email && <a href={`mailto:${a.email}`} className="hover:text-ink">{a.email}</a>}
            {a.website && <a href={a.website} target="_blank" rel="noopener nofollow" className="hover:text-ink">{a.website.replace(/^https?:\/\//, '')}</a>}
          </div>
          {a.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/80">{a.description}</p>}
          <div className="mt-3 text-xs text-muted">
            {t('agencies.listingsN', { n: a.activeListings })} · {t('agencies.since', { date: formatDate(a.createdAt, locale, { month: 'long', year: 'numeric' }) })}
          </div>
        </div>
      </div>
      <OwnerListings agencyId={a.id} />
    </div>
  );
}
