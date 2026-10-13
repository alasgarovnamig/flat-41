'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { formatPrice, getCity, getDistrict, getMetro, localized, pricePerM2, type ListingDetail } from '@evtap/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { stateToSearch } from '@/lib/search-state';
import { cn } from '@/lib/utils';
import { BannerSlot } from '@/components/BannerSlot';
import { ListingCarousel } from '@/components/listings/Carousel';
import { FavoriteButton, ListingBadges, usePriceLabel } from '@/components/listings/ListingCard';
import { LocationMap } from '@/components/map';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { CheckIcon, ChevronRight, EyeIcon, HeartIcon, PhoneIcon, PinIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { BookingWidget } from './BookingWidget';
import { ContactCard, usePhoneReveal } from './Contact';
import { Gallery } from './Gallery';
import { MortgageCalculator } from './MortgageCalculator';
import { OwnerPanel } from './OwnerPanel';
import { ReportButton, ShareButton } from './ReportShare';
import { Reviews } from './Reviews';

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-line py-2.5 text-sm last:border-0 sm:block sm:border-0 sm:py-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold sm:mt-0.5">{value}</dd>
    </div>
  );
}

function Description({ text }: { text: string }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const long = text.length > 600;
  return (
    <div>
      <p className={cn('whitespace-pre-line leading-relaxed text-ink/90', long && !more && 'line-clamp-[8]')}>{text}</p>
      {long && (
        <button type="button" onClick={() => setMore(!more)} className="mt-2 text-sm font-semibold text-brand hover:underline">
          {more ? t('common.showLess') : t('common.showMore')}
        </button>
      )}
    </div>
  );
}

function Similar({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.similar(id), queryFn: () => api.listings.similar(id), retry: false });
  if (!q.isLoading && !q.data?.length) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-xl font-bold">{t('listing.similar')}</h2>
      <ListingCarousel items={q.data ?? []} loading={q.isLoading} />
    </section>
  );
}

function MobileBar({ l }: { l: ListingDetail }) {
  const { t } = useI18n();
  const price = usePriceLabel();
  const { phone, reveal, loading } = usePhoneReveal(l.id);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-line bg-white/95 p-3 backdrop-blur lg:hidden">
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{price(l)}</div>
        <div className="truncate text-xs text-muted">{l.contactName}</div>
      </div>
      {l.dealType === 'RENT_DAILY' ? (
        <Button onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{t('booking.reserve')}</Button>
      ) : phone ? (
        <a href={`tel:${phone}`} className="flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white">
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
  // SSR is anonymous: the owner re-fetches with auth to get owner-only fields (promotions, rejection reason…)
  const q = useQuery({ queryKey: qk.listing(initial.id), queryFn: () => api.listings.get(initial.id), initialData: initial, enabled: ownerView && !initial.isOwner, staleTime: 0, retry: false });
  const fetched = q.data ?? initial;
  const l = ownerView && !fetched.isOwner ? { ...fetched, isOwner: true } : fetched;
  const priceLabel = usePriceLabel();
  const city = getCity(l.cityId);
  const district = l.districtId ? getDistrict(l.districtId) : null;
  const metro = l.metroId ? getMetro(l.metroId) : null;
  const searchHref = (extra: Record<string, string>) => `${href('/search')}?${stateToSearch({ dealType: l.dealType, ...extra } as never)}`;
  const daily = l.dealType === 'RENT_DAILY';

  const facts: [string, React.ReactNode][] = [
    [t('listing.facts.dealType'), t(`enums.dealType.${l.dealType}`)],
    [t('listing.facts.propertyType'), t(`enums.propertyType.${l.propertyType}`)],
  ];
  if (l.buildingType) facts.push([t('listing.facts.buildingType'), t(`enums.buildingType.${l.buildingType}`)]);
  facts.push([t('listing.facts.area'), `${number(l.area)} ${t('common.sqm')}`]);
  if (l.landArea) facts.push([t('listing.facts.landArea'), `${number(l.landArea)} ${t('common.sot')}`]);
  if (l.rooms != null) facts.push([t('listing.facts.rooms'), l.rooms]);
  if (l.bathrooms != null) facts.push([t('listing.facts.bathrooms'), l.bathrooms]);
  if (l.floor != null) facts.push([t('listing.facts.floor'), l.totalFloors ? `${l.floor} / ${l.totalFloors}` : l.floor]);
  if (l.yearBuilt) facts.push([t('listing.facts.yearBuilt'), l.yearBuilt]);
  if (l.ceilingHeight) facts.push([t('listing.facts.ceiling'), `${l.ceilingHeight} m`]);
  if (l.repair) facts.push([t('listing.facts.repair'), t(`enums.repair.${l.repair}`)]);
  if (!daily) facts.push([t('listing.facts.document'), l.hasDocument ? t('common.yes') : t('common.no')]);
  if (l.dealType === 'SALE') facts.push([t('listing.facts.mortgage'), l.mortgageAvailable ? t('common.yes') : t('common.no')]);
  if (daily && l.maxGuests) facts.push([t('listing.facts.maxGuests'), l.maxGuests]);
  if (daily && l.minNights) facts.push([t('listing.facts.minNights'), l.minNights]);

  return (
    <div className="container-page pb-28 pt-4 lg:pb-12">
      {/* breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href={href('/')} className="hover:text-ink">EvTap</Link>
        <ChevronRight size={14} />
        <Link href={searchHref({})} className="hover:text-ink">{t(`enums.dealType.${l.dealType}`)}</Link>
        {city && (
          <>
            <ChevronRight size={14} />
            <Link href={searchHref({ cityId: city.id })} className="hover:text-ink">{localized(city.name, locale)}</Link>
          </>
        )}
        {district && (
          <>
            <ChevronRight size={14} />
            <Link href={searchHref({ cityId: l.cityId, districtId: district.id })} className="hover:text-ink">{localized(district.name, locale)}</Link>
          </>
        )}
        {metro && (
          <>
            <ChevronRight size={14} />
            <Link href={searchHref({ cityId: l.cityId, metroId: metro.id })} className="hover:text-ink">m. {localized(metro.name, locale)}</Link>
          </>
        )}
      </nav>

      <Gallery images={l.images} title={l.title} coverUrl={l.coverUrl} />

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <ListingBadges l={l} className="mb-2" />
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{l.title}</h1>
              <p className="mt-1 flex items-center gap-1 text-muted">
                <PinIcon size={16} className="shrink-0" />
                {[localized(city?.name, locale), district && localized(district.name, locale), metro && `m. ${localized(metro.name, locale)}`, l.address].filter(Boolean).join(', ')}
              </p>
            </div>
            <div className="flex gap-2">
              <FavoriteButton id={l.id} className="h-10 w-10 border border-line shadow-none" />
              <ShareButton title={l.title} />
              <ReportButton listingId={l.id} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1">
            <div className="text-3xl font-extrabold tracking-tight text-ink">{priceLabel(l)}</div>
            {l.dealType === 'SALE' && l.area > 0 && <div className="pb-1 text-sm text-muted">{formatPrice(pricePerM2(l.price, l.area), l.currency)} / {t('common.sqm')}</div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {l.isVerified && <Badge tone="brand" icon={<ShieldCheckIcon size={12} />}>{t('badges.verified')}</Badge>}
            {l.hasDocument && <Badge tone="green">{t('badges.document')}</Badge>}
            {l.mortgageAvailable && <Badge tone="blue">{t('badges.mortgage')}</Badge>}
            {l.isBusiness && <Badge tone="brand">{t('badges.business')}</Badge>}
            {l.buildingType === 'NEW' && <Badge tone="blue">{t('badges.newBuilding')}</Badge>}
          </div>

          <div className="mt-6 lg:hidden">{l.isOwner && <OwnerPanel l={l} />}</div>

          <section className="mt-8">
            <h2 className="mb-3 text-xl font-bold">{t('listing.keyFacts')}</h2>
            <dl className="grid gap-x-6 sm:grid-cols-3 sm:gap-y-5 lg:grid-cols-4">
              {facts.map(([k, v]) => (
                <Fact key={k} label={k} value={v} />
              ))}
            </dl>
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-xl font-bold">{t('listing.description')}</h2>
            <Description text={l.description} />
          </section>

          {l.amenities.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-xl font-bold">{t('listing.amenities')}</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {l.amenities.map((a) => (
                  <li key={a} className="flex items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-brand">
                      <CheckIcon size={14} strokeWidth={2.5} />
                    </span>
                    {t(`enums.amenity.${a}`)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {daily && (l.houseRules || l.checkInTime || l.checkOutTime) && (
            <section className="mt-8">
              <h2 className="mb-3 text-xl font-bold">{t('listing.houseRules')}</h2>
              <div className="rounded-card border border-line bg-white p-4 text-sm">
                {(l.checkInTime || l.checkOutTime) && (
                  <p className="mb-2 font-medium">
                    {l.checkInTime && `${t('booking.checkInFrom')} ${l.checkInTime}`} {l.checkOutTime && `· ${t('booking.checkOutUntil')} ${l.checkOutTime}`}
                  </p>
                )}
                {l.houseRules && <p className="whitespace-pre-line text-ink/80">{l.houseRules}</p>}
              </div>
            </section>
          )}

          {l.lat != null && l.lng != null && (
            <section className="mt-8">
              <h2 className="mb-3 text-xl font-bold">{t('listing.location')}</h2>
              <div className="h-72 overflow-hidden rounded-card border border-line">
                <LocationMap lat={l.lat} lng={l.lng} />
              </div>
            </section>
          )}

          {daily && (
            <div className="mt-10">
              <Reviews listingId={l.id} rating={l.rating} count={l.reviewsCount} isOwner={l.isOwner} />
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-4 text-xs text-muted">
            <span>ID: {l.id.slice(0, 8).toUpperCase()}</span>
            <span className="flex items-center gap-1"><EyeIcon size={14} /> {t('listing.views', { n: number(l.views) })}</span>
            <span className="flex items-center gap-1"><HeartIcon size={14} /> {number(l.favoritesCount)}</span>
            {l.publishedAt && <span suppressHydrationWarning>{t('listing.published', { date: date(l.publishedAt) })}</span>}
            <span suppressHydrationWarning>{t('listing.updated', { date: date(l.updatedAt) })}</span>
          </div>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
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
