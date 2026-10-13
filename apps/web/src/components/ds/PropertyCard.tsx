'use client';

import Link from 'next/link';
import type { ListingCard } from '@evtap/shared';
import { useFavorites } from '@/lib/hooks';
import { cn, locationLabel } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { Badge, DealTag, Rating } from './Badge';
import { Skeleton } from './feedback';
import { ArrowUpRightIcon, CameraIcon, HeartIcon } from './icons';
import { Img } from './media';
import { Money } from './Money';

type Card = ListingCard;

/** "/ ay", "/ gecə" suffix for rent prices. */
export function usePeriodSuffix() {
  const { t } = useI18n();
  return (l: Pick<Card, 'pricePeriod'>) => (l.pricePeriod === 'MONTH' ? `/ ${t('common.perMonth')}` : l.pricePeriod === 'DAY' ? `/ ${t('common.perNight')}` : undefined);
}

/** Price as Money (grey ₼) + period suffix. */
export function Price({ l, className, symbolClassName }: { l: Pick<Card, 'price' | 'currency' | 'pricePeriod'>; className?: string; symbolClassName?: string }) {
  const suffix = usePeriodSuffix();
  return <Money value={l.price} currency={l.currency} suffix={suffix(l)} className={className} symbolClassName={symbolClassName} />;
}

/** Plain-text price label (aria labels, meta). */
export function usePriceLabel() {
  const suffix = usePeriodSuffix();
  return (l: Pick<Card, 'price' | 'currency' | 'pricePeriod'>) => {
    const sym = { AZN: '₼', USD: '$', EUR: '€', GEL: '₾' }[l.currency] ?? l.currency;
    const s = suffix(l);
    return `${Math.round(l.price).toLocaleString('en-US').replace(/,/g, ' ')} ${sym}${s ? ` ${s}` : ''}`;
  };
}

/** Spec chips (m², rooms, floor, land) — 11px muted pills. */
export function useSpecs() {
  const { t } = useI18n();
  return (l: Pick<Card, 'rooms' | 'area' | 'landArea' | 'floor' | 'totalFloors' | 'propertyType'>) => {
    const out: string[] = [];
    if (l.area) out.push(`${l.area} ${t('common.sqm')}`);
    if (l.rooms != null && l.propertyType !== 'LAND') out.push(t('listing.roomsShort', { n: l.rooms }));
    if (l.landArea) out.push(`${l.landArea} ${t('common.sot')}`);
    if (l.floor != null) out.push(l.totalFloors ? t('listing.floorOf', { floor: l.floor, total: l.totalFloors }) : t('listing.floorN', { floor: l.floor }));
    return out;
  };
}

export function SpecChips({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map((s) => (
        <li key={s} className="whitespace-nowrap rounded-pill bg-surface-sunken px-2.5 py-1 text-[11px] leading-none text-ink-secondary">
          {s}
        </li>
      ))}
    </ul>
  );
}

export function ListingBadges({ l, className }: { l: Card; className?: string }) {
  const { t } = useI18n();
  if (!l.isPremium && !l.isVip && !l.isUrgent && !l.isVerified) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {l.isPremium && <Badge tone="premium">{t('badges.premium')}</Badge>}
      {l.isVip && <Badge tone="vip">VIP</Badge>}
      {l.isUrgent && <Badge tone="urgent">{t('badges.urgent')}</Badge>}
      {l.isVerified && <Badge tone="verified">{t('badges.verified')}</Badge>}
    </div>
  );
}

/** Heart in a white 36px circle (44px hit area via padding on touch). */
export function FavoriteButton({ id, className, size = 'sm' }: { id: string; className?: string; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const fav = useFavorites();
  const on = fav.isFavorite(id);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('listing.removeFavorite') : t('listing.addFavorite')}
      title={on ? t('listing.removeFavorite') : t('listing.addFavorite')}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        fav.toggle(id);
      }}
      className={cn(
        "press relative flex items-center justify-center rounded-full bg-surface-raised shadow-pill hover:bg-surface-sunken after:absolute after:-inset-1 after:content-['']",
        size === 'sm' ? 'h-9 w-9' : 'h-11 w-11',
        on ? 'text-danger' : 'text-ink',
        className,
      )}
    >
      <HeartIcon size={size === 'sm' ? 17 : 20} filled={on} />
    </button>
  );
}

/**
 * PropertyCard — white card r22; 4:3 photo whose bottom fades into the card body; heart + black ↗ top-right;
 * meta row (deal dot + ★), title 15/500, address 12 muted, price right (grey ₼), spec chips.
 */
export function PropertyCard({ l, layout = 'grid', priority, className }: { l: Card; layout?: 'grid' | 'list'; priority?: boolean; className?: string }) {
  const { t, href, locale } = useI18n();
  const specs = useSpecs();
  const list = layout === 'list';
  const link = href(`/listings/${l.id}`);
  const address = l.address ? `${locationLabel(l, locale, { metro: false })}, ${l.address}` : locationLabel(l, locale);
  return (
    <article
      className={cn(
        'group relative flex overflow-hidden rounded-lg bg-surface-raised shadow-card transition-shadow hover:shadow-raised',
        list ? 'flex-col sm:flex-row' : 'flex-col',
        l.isHighlighted && 'ring-2 ring-inset ring-accent',
        className,
      )}
    >
      <div className={cn('relative shrink-0', list ? 'aspect-[4/3] sm:aspect-auto sm:w-80' : 'aspect-[4/3]')}>
        <Link href={link} prefetch={false} tabIndex={-1} aria-hidden className={cn('absolute inset-0 overflow-hidden', !list && 'fade-bottom')}>
          <Img
            src={l.coverUrl}
            alt=""
            fill
            priority={priority}
            sizes={list ? '(min-width: 640px) 320px, 100vw' : '(min-width: 1280px) 340px, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw'}
            className="object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]"
          />
        </Link>
        <ListingBadges l={l} className="absolute left-3 top-3 z-[1] max-w-[60%]" />
        {l.imagesCount > 1 && (
          <span className={cn('glass absolute left-3 z-[1] flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium text-ink', list ? 'bottom-3' : 'bottom-12')}>
            <CameraIcon size={12} /> {l.imagesCount}
          </span>
        )}
      </div>
      <div className={cn('absolute right-3 top-3 z-[2] flex gap-1.5')}>
        <FavoriteButton id={l.id} />
        <Link href={link} prefetch={false} tabIndex={-1} aria-hidden className="press flex h-9 w-9 items-center justify-center rounded-full bg-ink text-on-ink hover:bg-ink-secondary">
          <ArrowUpRightIcon size={17} />
        </Link>
      </div>
      <div className={cn('relative z-[1] flex min-w-0 flex-1 flex-col gap-2 px-4 pb-4', list ? 'pt-4 sm:p-5' : '-mt-9')}>
        <div className="flex items-center gap-3">
          <DealTag deal={l.dealType} label={t(`enums.dealType.${l.dealType}`)} />
          {l.rating != null && <Rating value={l.rating} />}
          {l.isBusiness && <span className="text-[11px] text-muted">· {t('badges.business')}</span>}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-sans text-[15px] font-medium leading-5 text-ink">
              <Link href={link} prefetch={false} className="line-clamp-1 hover:underline hover:underline-offset-2">
                {l.title}
              </Link>
            </h3>
            <p className="mt-0.5 truncate text-caption text-muted">{address}</p>
          </div>
          <Price l={l} className="shrink-0 text-[15px] font-medium leading-5 text-ink" />
        </div>
        <SpecChips items={specs(l)} className="mt-auto pt-1" />
      </div>
    </article>
  );
}

export function PropertyCardSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'list' }) {
  return (
    <div className={cn('overflow-hidden rounded-lg bg-surface-raised shadow-card', layout === 'list' && 'sm:flex')}>
      <Skeleton className={cn('aspect-[4/3] rounded-none', layout === 'list' && 'sm:aspect-auto sm:h-52 sm:w-80')} />
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <Skeleton className="h-3 w-1/3 rounded-pill" />
        <Skeleton className="h-4 w-3/4 rounded-pill" />
        <Skeleton className="h-3 w-1/2 rounded-pill" />
        <div className="flex gap-1.5 pt-1">
          <Skeleton className="h-5 w-14 rounded-pill" />
          <Skeleton className="h-5 w-14 rounded-pill" />
          <Skeleton className="h-5 w-16 rounded-pill" />
        </div>
      </div>
    </div>
  );
}

const gridCols = (layout: 'grid' | 'list', cols: 2 | 3 | 4) =>
  layout === 'list' ? 'grid-cols-1' : cols === 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';

export function PropertyGrid({ items, layout = 'grid', cols = 4 }: { items: Card[]; layout?: 'grid' | 'list'; cols?: 2 | 3 | 4 }) {
  return (
    <div className={cn('grid gap-4', gridCols(layout, cols))}>
      {items.map((l, i) => (
        <PropertyCard key={l.id} l={l} layout={layout} priority={i < 3} />
      ))}
    </div>
  );
}

export function PropertyGridSkeleton({ n = 8, layout = 'grid', cols = 4 }: { n?: number; layout?: 'grid' | 'list'; cols?: 2 | 3 | 4 }) {
  return (
    <div className={cn('grid gap-4', gridCols(layout, cols))} aria-busy>
      {Array.from({ length: n }, (_, i) => (
        <PropertyCardSkeleton key={i} layout={layout} />
      ))}
    </div>
  );
}

/** Horizontal scroll-snap row of PropertyCards ("Property Object"). */
export function PropertyRow({ items, loading, n = 4 }: { items: Card[]; loading?: boolean; n?: number }) {
  const w = 'w-[82%] shrink-0 snap-start sm:w-[46%] lg:w-[31.5%] xl:w-[calc(25%-12px)]';
  return (
    <div className="scrollbar-none -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 pt-1">
      {loading
        ? Array.from({ length: n }, (_, i) => (
            <div key={i} className={w}>
              <PropertyCardSkeleton />
            </div>
          ))
        : items.map((l, i) => (
            <div key={l.id} className={w}>
              <PropertyCard l={l} priority={i < 2} className="h-full" />
            </div>
          ))}
    </div>
  );
}
