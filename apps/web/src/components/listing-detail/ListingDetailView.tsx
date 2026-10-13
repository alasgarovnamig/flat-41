'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { getCity, getDistrict, getMetro, localized, pricePerM2, type ListingDetail } from '@evtap/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { stateToSearch } from '@/lib/search-state';
import { cn } from '@/lib/utils';
import { BannerSlot } from '@/components/BannerSlot';
import { Badge, Button, Card, CardHeader, DealTag, FavoriteButton, ListingBadges, MapCard, Money, Price, PropertyRow } from '@/components/ds';
import { AreaIcon, BathIcon, BedIcon, CheckIcon, ChevronRight, EyeIcon, HeartIcon, LayersIcon, PhoneIcon, PinIcon } from '@/components/ds/icons';
import { LocationMap } from '@/components/map';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { BookingWidget } from './BookingWidget';
import { ContactCard, usePhoneReveal } from './Contact';
import { Gallery } from './Gallery';
import { MortgageCalculator } from './MortgageCalculator';
import { OwnerPanel } from './OwnerPanel';
import { ReportButton, ShareButton } from './ReportShare';
import { Reviews } from './Reviews';

/** Fact as a spec chip: muted label over ink value in a white pill-card. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-raised px-4 py-3 shadow-pill">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium">{value}</dd>
    </div>
  );
}

/** Big spec chip with icon (m², rooms, baths, floor). */
function Spec({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-3 rounded-pill bg-surface-raised py-1.5 pl-1.5 pr-4 shadow-pill">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken">{icon}</span>
      <span>
        <span className="block text-[14px] font-medium leading-tight">{value}</span>
        <span className="block text-[11px] leading-tight text-muted">{label}</span>
      </span>
    </li>
  );
}

function Description({ text }: { text: string }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const long = text.length > 600;
  return (
    <div>
      <p className={cn('whitespace-pre-line leading-relaxed text-ink-secondary', long && !more && 'line-clamp-[8]')}>{text}</p>
      {long && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? t('common.showLess') : t('common.showMore')}
        </Button>
      )}
    </div>
  );
}

function Similar({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.similar(id), queryFn: () => api.listings.similar(id), retry: false });
  if (!q.isLoading && !q.data?.length) return null;
  return (
    <Card as="section" className="mt-10" aria-labelledby="similar-h">
      <CardHeader id="similar-h" title={t('listing.similar')} />
      <PropertyRow items={q.data ?? []} loading={q.isLoading} />
    </Card>
  );
}

function MobileBar({ l }: { l: ListingDetail }) {
  const { t } = useI18n();
  const { phone, reveal, loading } = usePhoneReveal(l.id);
  return (
    <div className="glass fixed inset-x-3 bottom-3 z-40 flex items-center gap-3 rounded-pill p-2 pl-5 shadow-raised lg:hidden">
      <div className="min-w-0 flex-1">
        <Price l={l} className="block truncate font-display text-[19px] leading-tight" />
        <div className="truncate text-caption text-muted">{l.contactName}</div>
      </div>
      {l.dealType === 'RENT_DAILY' ? (
        <Button onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{t('booking.reserve')}</Button>
      ) : phone ? (
        <a href={`tel:${phone}`} className="press inline-flex h-11 items-center gap-2 rounded-pill bg-ink px-5 text-[14px] font-medium text-on-ink">
          <PhoneIcon size={16} /> {t('listing.call')}
        </a>
      ) : (
        <Button loading={loading} onClick={reveal} icon={<PhoneIcon size={16} />}>
          {t('listing.showPhone')}
        </Button>
      )}
    </div>
  );
}

export function ListingDetailView({ initial }: { initial: ListingDetail }) {
  const { t, href, locale, date, number } = useI18n();
  const { user } = useAuth();
  const ownerView = !!user && user.id === initial.owner.id;
  // SSR is anonymous: the owner re-fetches with auth to get owner-only fields (promotions, contactPhone, rejection reason…)
  const q = useQuery({ queryKey: qk.listing(initial.id), queryFn: () => api.listings.get(initial.id), initialData: initial, enabled: ownerView && !initial.isOwner, staleTime: 0, retry: false });
  const fetched = q.data ?? initial;
  const l = ownerView && !fetched.isOwner ? { ...fetched, isOwner: true } : fetched;
  const city = getCity(l.cityId);
  const district = l.districtId ? getDistrict(l.districtId) : null;
  const metro = l.metroId ? getMetro(l.metroId) : null;
  const searchHref = (extra: Record<string, string>) => `${href('/search')}?${stateToSearch({ dealType: l.dealType, ...extra } as never)}`;
  const daily = l.dealType === 'RENT_DAILY';

  const facts: [string, ReactNode][] = [
    [t('listing.facts.dealType'), t(`enums.dealType.${l.dealType}`)],
    [t('listing.facts.propertyType'), t(`enums.propertyType.${l.propertyType}`)],
  ];
  if (l.buildingType) facts.push([t('listing.facts.buildingType'), t(`enums.buildingType.${l.buildingType}`)]);
  if (l.landArea) facts.push([t('listing.facts.landArea'), `${number(l.landArea)} ${t('common.sot')}`]);
  if (l.yearBuilt) facts.push([t('listing.facts.yearBuilt'), l.yearBuilt]);
  if (l.ceilingHeight) facts.push([t('listing.facts.ceiling'), `${l.ceilingHeight} m`]);
  if (l.repair) facts.push([t('listing.facts.repair'), t(`enums.repair.${l.repair}`)]);
  if (!daily) facts.push([t('listing.facts.document'), l.hasDocument ? t('common.yes') : t('common.no')]);
  if (l.dealType === 'SALE') facts.push([t('listing.facts.mortgage'), l.mortgageAvailable ? t('common.yes') : t('common.no')]);
  if (daily && l.maxGuests) facts.push([t('listing.facts.maxGuests'), l.maxGuests]);
  if (daily && l.minNights) facts.push([t('listing.facts.minNights'), l.minNights]);

  const crumbs = [
    { href: href('/'), label: 'EvTap' },
    { href: searchHref({}), label: t(`enums.dealType.${l.dealType}`) },
    ...(city ? [{ href: searchHref({ cityId: city.id }), label: localized(city.name, locale) }] : []),
    ...(district ? [{ href: searchHref({ cityId: l.cityId, districtId: district.id }), label: localized(district.name, locale) }] : []),
    ...(metro ? [{ href: searchHref({ cityId: l.cityId, metroId: metro.id }), label: `m. ${localized(metro.name, locale)}` }] : []),
  ];

  return (
    <div className="container-page pb-28 pt-6 lg:pb-12">
      <nav aria-label="Breadcrumb" className="scrollbar-none -mx-1 mb-5 overflow-x-auto px-1">
        <ol className="flex items-center gap-1.5 whitespace-nowrap text-label">
          {crumbs.map((c, i) => (
            <li key={c.href + i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} className="text-subtle" />}
              <Link href={c.href} className="inline-flex h-9 items-center rounded-pill bg-pill px-3.5 text-ink hover:bg-pill-hover">
                {c.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <DealTag deal={l.dealType} label={t(`enums.dealType.${l.dealType}`)} className="text-label" />
            <ListingBadges l={l} />
          </div>
          <h1 className="text-[28px] font-normal leading-tight tracking-[-0.8px] sm:text-[36px] sm:tracking-[-1px]">{l.title}</h1>
          <p className="mt-2 flex items-start gap-1.5 text-ink-secondary">
            <PinIcon size={17} className="mt-0.5 shrink-0" />
            {[localized(city?.name, locale), district && localized(district.name, locale), metro && `m. ${localized(metro.name, locale)}`, l.address].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex gap-2">
          <FavoriteButton id={l.id} size="md" />
          <ShareButton title={l.title} />
          <ReportButton listingId={l.id} />
        </div>
      </div>

      <Gallery images={l.images} title={l.title} coverUrl={l.coverUrl} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <Price l={l} className="font-display text-[40px] font-normal leading-none tracking-[-1.2px] sm:text-display" />
              {l.dealType === 'SALE' && l.area > 0 && (
                <span className="text-label text-ink-secondary">
                  <Money value={pricePerM2(l.price, l.area)} currency={l.currency} /> / {t('common.sqm')}
                </span>
              )}
            </div>
            <ul className="mt-5 flex flex-wrap gap-2">
              <Spec icon={<AreaIcon size={17} />} value={`${number(l.area)} ${t('common.sqm')}`} label={t('listing.facts.area')} />
              {l.rooms != null && <Spec icon={<BedIcon size={17} />} value={l.rooms} label={t('listing.facts.rooms')} />}
              {l.bathrooms != null && <Spec icon={<BathIcon size={17} />} value={l.bathrooms} label={t('listing.facts.bathrooms')} />}
              {l.floor != null && <Spec icon={<LayersIcon size={17} />} value={l.totalFloors ? `${l.floor} / ${l.totalFloors}` : l.floor} label={t('listing.facts.floor')} />}
            </ul>
            {(l.isVerified || l.hasDocument || l.mortgageAvailable || l.isBusiness || l.buildingType === 'NEW') && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {l.isVerified && <Badge tone="verified" size="md">{t('badges.verified')}</Badge>}
                {l.hasDocument && <Badge tone="outline" size="md" icon={<CheckIcon size={13} />}>{t('badges.document')}</Badge>}
                {l.mortgageAvailable && <Badge tone="outline" size="md" icon={<CheckIcon size={13} />}>{t('badges.mortgage')}</Badge>}
                {l.isBusiness && <Badge tone="business" size="md">{t('badges.business')}</Badge>}
                {l.buildingType === 'NEW' && <Badge tone="info" size="md">{t('badges.newBuilding')}</Badge>}
              </div>
            )}
          </Card>

          {l.isOwner && (
            <div className="lg:hidden">
              <OwnerPanel l={l} />
            </div>
          )}

          <Card as="section" aria-labelledby="facts-h">
            <CardHeader id="facts-h" title={t('listing.keyFacts')} />
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {facts.map(([k, v]) => (
                <Fact key={k} label={k} value={v} />
              ))}
            </dl>
          </Card>

          <Card as="section" aria-labelledby="desc-h">
            <CardHeader id="desc-h" title={t('listing.description')} />
            <Description text={l.description} />
          </Card>

          {l.amenities.length > 0 && (
            <Card as="section" aria-labelledby="amen-h">
              <CardHeader id="amen-h" title={t('listing.amenities')} />
              <ul className="flex flex-wrap gap-2">
                {l.amenities.map((a) => (
                  <li key={a} className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-raised pl-1.5 pr-4 text-[14px] shadow-pill">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-on-ink">
                      <CheckIcon size={14} strokeWidth={2.2} />
                    </span>
                    {t(`enums.amenity.${a}`)}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {daily && (l.houseRules || l.checkInTime || l.checkOutTime) && (
            <Card as="section" aria-labelledby="rules-h">
              <CardHeader id="rules-h" title={t('listing.houseRules')} />
              {(l.checkInTime || l.checkOutTime) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {l.checkInTime && <Badge tone="outline" size="md">{t('booking.checkInFrom')} {l.checkInTime}</Badge>}
                  {l.checkOutTime && <Badge tone="outline" size="md">{t('booking.checkOutUntil')} {l.checkOutTime}</Badge>}
                </div>
              )}
              {l.houseRules && <p className="whitespace-pre-line text-ink-secondary">{l.houseRules}</p>}
            </Card>
          )}

          {l.lat != null && l.lng != null && (
            <section aria-label={t('listing.location')}>
              <MapCard title={t('listing.location')} className="h-80">
                <LocationMap lat={l.lat} lng={l.lng} />
              </MapCard>
            </section>
          )}

          {daily && <Reviews listingId={l.id} rating={l.rating} count={l.reviewsCount} isOwner={l.isOwner} />}

          <div className="flex flex-wrap gap-2 text-caption text-ink-secondary">
            <span className="inline-flex h-8 items-center rounded-pill bg-surface-sunken px-3">ID {l.id.slice(0, 8).toUpperCase()}</span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-surface-sunken px-3">
              <EyeIcon size={14} /> {t('listing.views', { n: number(l.views) })}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-surface-sunken px-3">
              <HeartIcon size={14} /> {number(l.favoritesCount)}
            </span>
            {l.publishedAt && (
              <span className="inline-flex h-8 items-center rounded-pill bg-surface-sunken px-3" suppressHydrationWarning>
                {t('listing.published', { date: date(l.publishedAt) })}
              </span>
            )}
            <span className="inline-flex h-8 items-center rounded-pill bg-surface-sunken px-3" suppressHydrationWarning>
              {t('listing.updated', { date: date(l.updatedAt) })}
            </span>
          </div>
        </div>

        <aside className="flex flex-col gap-5 lg:self-start" aria-label={t('listing.contact')}>
          {l.isOwner && (
            <div className="hidden lg:block">
              <OwnerPanel l={l} />
            </div>
          )}
          {daily && <BookingWidget l={l} />}
          <ContactCard l={l} />
          {l.dealType === 'SALE' && ['APARTMENT', 'HOUSE'].includes(l.propertyType) && <MortgageCalculator listingId={l.id} price={l.price} currency={l.currency} />}
          <BannerSlot placement="LISTING_SIDEBAR" aspect="aspect-[4/3]" />
        </aside>
      </div>

      <Similar id={l.id} />
      {!l.isOwner && <MobileBar l={l} />}
    </div>
  );
}
