'use client';

import Link from 'next/link';
import { formatPrice, type ListingCard as Card } from '@evtap/shared';
import { useFavorites } from '@/lib/hooks';
import { cn, locationLabel } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { CameraIcon, CrownIcon, HeartIcon, PinIcon, ShieldCheckIcon, StarIcon, BoltIcon } from '@/components/ui/icons';
import { Img } from '@/components/ui/Img';

export function usePriceLabel() {
  const { t } = useI18n();
  return (l: Pick<Card, 'price' | 'currency' | 'pricePeriod'>) =>
    `${formatPrice(l.price, l.currency)}${l.pricePeriod === 'MONTH' ? ` / ${t('common.perMonth')}` : l.pricePeriod === 'DAY' ? ` / ${t('common.perNight')}` : ''}`;
}

export function ListingBadges({ l, className }: { l: Card; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {l.isPremium && (
        <Badge tone="premium" icon={<CrownIcon size={11} strokeWidth={2.5} />}>
          {t('badges.premium')}
        </Badge>
      )}
      {l.isVip && (
        <Badge tone="vip" icon={<CrownIcon size={11} strokeWidth={2.5} />}>
          VIP
        </Badge>
      )}
      {l.isUrgent && (
        <Badge tone="urgent" icon={<BoltIcon size={11} strokeWidth={2.5} />}>
          {t('badges.urgent')}
        </Badge>
      )}
    </div>
  );
}

export function FactsLine({ l, className }: { l: Card; className?: string }) {
  const { t } = useI18n();
  const parts: string[] = [];
  if (l.rooms != null && l.propertyType !== 'LAND') parts.push(t('listing.roomsShort', { n: l.rooms }));
  if (l.area) parts.push(`${l.area} ${t('common.sqm')}`);
  if (l.landArea) parts.push(`${l.landArea} ${t('common.sot')}`);
  if (l.floor != null) parts.push(l.totalFloors ? t('listing.floorOf', { floor: l.floor, total: l.totalFloors }) : t('listing.floorN', { floor: l.floor }));
  return <div className={cn('truncate text-sm text-ink/80', className)}>{parts.join(' · ')}</div>;
}

export function FavoriteButton({ id, className, size = 18 }: { id: string; className?: string; size?: number }) {
  const { t } = useI18n();
  const fav = useFavorites();
  const on = fav.isFavorite(id);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('listing.removeFavorite') : t('listing.addFavorite')}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        fav.toggle(id);
      }}
      className={cn('flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105', on ? 'text-urgent' : 'text-ink/70 hover:text-urgent', className)}
    >
      <HeartIcon size={size} filled={on} />
    </button>
  );
}

export function ListingCard({ l, layout = 'grid', priority }: { l: Card; layout?: 'grid' | 'list'; priority?: boolean }) {
  const { t, href, locale, relative } = useI18n();
  const price = usePriceLabel();
  const list = layout === 'list';
  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-card border bg-white shadow-card transition-shadow hover:shadow-card-hover',
        l.isHighlighted ? 'border-vip/40 bg-highlight' : 'border-line',
        l.isPremium && 'ring-1 ring-premium/30',
        list && 'sm:flex',
      )}
    >
      <Link href={href(`/listings/${l.id}`)} className={cn('block', list && 'sm:flex sm:w-full')} prefetch={false}>
        <div className={cn('relative aspect-[4/3] overflow-hidden bg-surface', list && 'sm:aspect-auto sm:h-auto sm:w-72 sm:shrink-0')}>
          <Img
            src={l.coverUrl}
            alt={l.title}
            fill
            priority={priority}
            sizes={list ? '(min-width: 640px) 288px, 100vw' : '(min-width: 1280px) 300px, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw'}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <ListingBadges l={l} className="absolute left-2 top-2" />
          {l.imagesCount > 0 && (
            <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
              <CameraIcon size={12} /> {l.imagesCount}
            </span>
          )}
          {l.isVerified && (
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white">
              <ShieldCheckIcon size={12} /> {t('badges.verified')}
            </span>
          )}
        </div>
        <div className={cn('flex flex-col gap-1 p-3.5', list && 'sm:flex-1 sm:p-5')}>
          <div className="flex items-baseline justify-between gap-2">
            <div className={cn('font-bold tracking-tight text-ink', list ? 'text-xl' : 'text-lg')}>{price(l)}</div>
            {l.dealType === 'RENT_DAILY' && l.rating != null && (
              <span className="flex items-center gap-0.5 text-sm font-semibold">
                <StarIcon size={14} className="text-vip" /> {l.rating.toFixed(1)}
              </span>
            )}
          </div>
          <FactsLine l={l} />
          {list && <h3 className="line-clamp-1 text-sm font-medium text-ink">{l.title}</h3>}
          <div className="flex items-center gap-1 truncate text-sm text-muted">
            <PinIcon size={14} className="shrink-0" />
            <span className="truncate">{l.address ? `${locationLabel(l, locale, { metro: false })}, ${l.address}` : locationLabel(l, locale)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span suppressHydrationWarning>{relative(l.bumpedAt || l.publishedAt || l.createdAt)}</span>
            <span className="flex gap-1">
              {l.buildingType === 'NEW' && <Badge tone="blue">{t('badges.newBuilding')}</Badge>}
              {l.hasDocument && <Badge tone="green">{t('badges.document')}</Badge>}
              {l.isBusiness && <Badge tone="brand">{t('badges.business')}</Badge>}
            </span>
          </div>
        </div>
      </Link>
      <FavoriteButton id={l.id} className="absolute right-2 top-2" />
    </article>
  );
}

export function ListingCardSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'list' }) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-line bg-white', layout === 'list' && 'sm:flex')}>
      <Skeleton className={cn('aspect-[4/3] rounded-none', layout === 'list' && 'sm:aspect-auto sm:h-48 sm:w-72')} />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function ListingGrid({ items, layout = 'grid', cols = 4 }: { items: Card[]; layout?: 'grid' | 'list'; cols?: 3 | 4 }) {
  return (
    <div className={cn('grid gap-4', layout === 'list' ? 'grid-cols-1' : cols === 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((l, i) => (
        <ListingCard key={l.id} l={l} layout={layout} priority={i < 4} />
      ))}
    </div>
  );
}

export function ListingGridSkeleton({ n = 8, layout = 'grid', cols = 4 }: { n?: number; layout?: 'grid' | 'list'; cols?: 3 | 4 }) {
  return (
    <div className={cn('grid gap-4', layout === 'list' ? 'grid-cols-1' : cols === 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {Array.from({ length: n }, (_, i) => (
        <ListingCardSkeleton key={i} layout={layout} />
      ))}
    </div>
  );
}
