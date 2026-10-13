import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { formatPrice, getCity, localized, type ListingDetail } from '@evtap/shared';
import { ListingClientLoader } from '@/components/listing-detail/ListingClientLoader';
import { ListingDetailView } from '@/components/listing-detail/ListingDetailView';
import { api, isApiError } from '@/lib/api';
import { WEB_URL, assetUrl } from '@/lib/config';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';
import { AUTH_HINT_COOKIE } from '@/lib/tokens';
import { isUuid } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; id: string }> };

type Loaded = { listing: ListingDetail } | { error: 'not_found' | 'unavailable' };

/** One API call per request (shared by generateMetadata and the page). */
const load = cache(async (id: string): Promise<Loaded> => {
  if (!isUuid(id)) return { error: 'not_found' };
  try {
    return { listing: await api.listings.get(id) };
  } catch (e) {
    if (isApiError(e) && (e.status === 404 || e.status === 403 || e.status === 400)) return { error: 'not_found' };
    return { error: 'unavailable' };
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, id } = await params;
  const locale = toLocale(raw);
  const t = getT(locale);
  const r = await load(id);
  if (!('listing' in r)) return { title: t('listing.metaFallback'), robots: { index: false } };
  const l = r.listing;
  const city = localized(getCity(l.cityId)?.name, locale);
  const price = formatPrice(l.price, l.currency);
  const description = `${price} · ${t(`enums.dealType.${l.dealType}`)} · ${city}${l.area ? ` · ${l.area} m²` : ''} — ${l.description.slice(0, 140)}`;
  const image = assetUrl(l.images[0]?.url ?? l.coverUrl);
  return {
    title: `${l.title} — ${price}`,
    description,
    alternates: {
      canonical: `/${locale}/listings/${l.id}`,
      languages: { az: `/az/listings/${l.id}`, ru: `/ru/listings/${l.id}`, en: `/en/listings/${l.id}` },
    },
    openGraph: {
      type: 'website',
      title: `${l.title} — ${price}`,
      description,
      url: `${WEB_URL}/${locale}/listings/${l.id}`,
      images: image ? [{ url: image, width: 1200, height: 800, alt: l.title }] : undefined,
    },
    twitter: { card: 'summary_large_image', title: l.title, description, images: image ? [image] : undefined },
    robots: l.status === 'ACTIVE' ? undefined : { index: false },
  };
}

function jsonLd(l: ListingDetail, locale: string) {
  const city = getCity(l.cityId);
  const url = `${WEB_URL}/${locale}/listings/${l.id}`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      name: l.title,
      description: l.description.slice(0, 500),
      url,
      datePosted: l.publishedAt ?? l.createdAt,
      image: l.images.map((i) => assetUrl(i.url)).filter(Boolean).slice(0, 10),
      offers: {
        '@type': 'Offer',
        price: l.price,
        priceCurrency: l.currency,
        availability: l.status === 'ACTIVE' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
        businessFunction: l.dealType === 'SALE' ? 'http://purl.org/goodrelations/v1#Sell' : 'http://purl.org/goodrelations/v1#LeaseOut',
      },
      about: {
        '@type': l.propertyType === 'HOUSE' ? 'SingleFamilyResidence' : l.propertyType === 'APARTMENT' ? 'Apartment' : 'Place',
        floorSize: { '@type': 'QuantitativeValue', value: l.area, unitCode: 'MTK' },
        ...(l.rooms != null ? { numberOfRooms: l.rooms } : {}),
        address: { '@type': 'PostalAddress', addressLocality: city?.name.en, addressCountry: l.country, streetAddress: l.address ?? undefined },
        ...(l.lat != null && l.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: l.lat, longitude: l.lng } } : {}),
      },
      ...(l.rating != null && l.reviewsCount > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: l.rating, reviewCount: l.reviewsCount } } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'EvTap', item: `${WEB_URL}/${locale}` },
        { '@type': 'ListItem', position: 2, name: city?.name.en ?? l.cityId, item: `${WEB_URL}/${locale}/search?cityId=${l.cityId}&dealType=${l.dealType}` },
        { '@type': 'ListItem', position: 3, name: l.title, item: url },
      ],
    },
  ];
}

export default async function ListingPage({ params }: Props) {
  const { locale, id } = await params;
  const r = await load(id);
  if ('listing' in r) {
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(r.listing, toLocale(locale))).replace(/</g, '\\u003c') }} />
        <ListingDetailView initial={r.listing} />
      </>
    );
  }
  // Not public: may still be visible to its logged-in owner (DRAFT / PENDING / REJECTED) → let the client try with auth.
  const maybeOwner = (await cookies()).get(AUTH_HINT_COOKIE)?.value === '1';
  if (r.error === 'not_found' && (!maybeOwner || !isUuid(id))) notFound();
  return <ListingClientLoader id={id} />;
}
