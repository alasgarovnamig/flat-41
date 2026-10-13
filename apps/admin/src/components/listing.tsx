import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ChevronLeft, ChevronRight, ExternalLink, ImageOff, Phone, ShieldAlert } from 'lucide-react';
import { formatPhone, formatPrice, pricePerM2, type ListingCard, type ListingReport } from '@evtap/shared';
import * as api from '../api/client';
import type { AdminListingDetail } from '../api/client';
import { listingSiteUrl } from '../env';
import { translate, useT } from '../i18n';
import { cityName, districtName, enumLabel, fmtDate, fmtDateTime, fmtNumber, fmtRelative, metroName } from '../lib/format';
import { Badge, StatusBadge } from './StatusBadge';
import { Avatar, EmptyState, KeyValue, Skeleton, cx } from './ui';

export const listingPrice = (l: Pick<ListingCard, 'price' | 'currency' | 'pricePeriod'>) =>
  formatPrice(l.price, l.currency) + (l.pricePeriod === 'MONTH' ? translate(' / month') : l.pricePeriod === 'DAY' ? translate(' / night') : '');

export function PromoBadges({ l }: { l: Pick<ListingCard, 'isVip' | 'isPremium' | 'isHighlighted' | 'isUrgent' | 'isVerified' | 'isBusiness'> }) {
  const { t } = useT();
  if (!(l.isVip || l.isPremium || l.isHighlighted || l.isUrgent || l.isVerified || l.isBusiness)) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {l.isPremium && <Badge tone="violet">Premium</Badge>}
      {l.isVip && <Badge tone="gold">VIP</Badge>}
      {l.isHighlighted && <Badge tone="info">{t('Highlight')}</Badge>}
      {l.isUrgent && <Badge tone="danger">{t('Urgent')}</Badge>}
      {l.isVerified && (
        <Badge tone="success">
          <BadgeCheck className="size-3" />
          {t('Verified')}
        </Badge>
      )}
      {l.isBusiness && <Badge tone="brand">{t('Business')}</Badge>}
    </span>
  );
}

export function Thumb({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={cx('shrink-0 rounded-md bg-hover object-cover', className)} />
  ) : (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-md bg-hover text-muted', className)}>
      <ImageOff className="size-4" />
    </span>
  );
}

/** Photo gallery; ←/→ handled by the parent via `index` / `onIndex` when keyboard control is wanted. */
export function Gallery({ images, index, onIndex }: { images: { url: string; thumbUrl: string }[]; index?: number; onIndex?: (i: number) => void }) {
  const { t } = useT();
  const [local, setLocal] = useState(0);
  const i = Math.min(index ?? local, Math.max(0, images.length - 1));
  const set = (n: number) => (onIndex ? onIndex(n) : setLocal(n));
  useEffect(() => setLocal(0), [images]);
  if (!images.length)
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-xl bg-hover text-muted">
        <ImageOff className="mr-2 size-5" /> {t('No photos')}
      </div>
    );
  const prev = () => set((i - 1 + images.length) % images.length);
  const next = () => set((i + 1) % images.length);
  return (
    <div>
      <div className="group relative aspect-[16/9] overflow-hidden rounded-xl bg-black/80">
        <img src={images[i].url} alt="" className="h-full w-full object-contain" />
        <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white tabular-nums">
          {i + 1} / {images.length}
        </span>
        {images.length > 1 && (
          <>
            <button onClick={prev} className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70" aria-label={t('Previous photo')}>
              <ChevronLeft className="size-5" />
            </button>
            <button onClick={next} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70" aria-label={t('Next photo')}>
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {images.map((img, n) => (
            <button key={n} onClick={() => set(n)} className={cx('shrink-0 overflow-hidden rounded-md ring-2', n === i ? 'ring-brand' : 'ring-transparent opacity-70 hover:opacity-100')}>
              <img src={img.thumbUrl || img.url} alt="" className="h-12 w-16 object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ListingFacts({ l }: { l: AdminListingDetail }) {
  const { t } = useT();
  const yes = (b: boolean) => (b ? t('Yes') : t('No'));
  const items: [ReactNode, ReactNode][] = [
    [t('Deal type'), enumLabel(l.dealType)],
    [t('Property type'), enumLabel(l.propertyType)],
    [t('Price'), <span key="p">{listingPrice(l)}{l.area > 0 && l.pricePeriod === 'TOTAL' && <span className="ml-1 text-xs font-normal text-muted">({formatPrice(pricePerM2(l.price, l.area), l.currency)}/m²)</span>}</span>],
    [t('Area'), `${fmtNumber(l.area)} m²` + (l.landArea ? ` · ${l.landArea} ${t('sot')}` : '')],
    [t('Rooms'), l.rooms ?? '—'],
    [t('Floor'), l.floor != null ? `${l.floor}${l.totalFloors ? ` / ${l.totalFloors}` : ''}` : '—'],
    [t('Building'), enumLabel(l.buildingType)],
    [t('Repair'), enumLabel(l.repair)],
    [t('Bathrooms'), l.bathrooms ?? '—'],
    [t('Year built'), l.yearBuilt ?? '—'],
    [t('Title deed (kupça)'), yes(l.hasDocument)],
    [t('Mortgage'), yes(l.mortgageAvailable)],
    [t('City'), cityName(l.cityId)],
    [t('District'), districtName(l.districtId)],
    [t('Metro'), metroName(l.metroId)],
    [t('Address'), l.address ?? '—'],
  ];
  if (l.dealType === 'RENT_DAILY')
    items.push(
      [t('Max guests'), l.maxGuests ?? '—'],
      [t('Min nights'), l.minNights ?? '—'],
      [t('Check-in / out'), `${l.checkInTime ?? '—'} / ${l.checkOutTime ?? '—'}`],
    );
  return (
    <div className="space-y-4">
      <KeyValue items={items} cols={3} />
      <div>
        <p className="mb-1 text-xs text-muted">{t('Description')}</p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{l.description}</p>
      </div>
      {l.houseRules && (
        <div>
          <p className="mb-1 text-xs text-muted">{t('House rules')}</p>
          <p className="text-sm whitespace-pre-wrap">{l.houseRules}</p>
        </div>
      )}
      {l.amenities.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-muted">{t('Amenities')}</p>
          <div className="flex flex-wrap gap-1.5">
            {l.amenities.map((a) => (
              <Badge key={a}>{enumLabel(a)}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Owner info + their listing history (other listings and statuses). */
export function OwnerCard({ l }: { l: AdminListingDetail }) {
  const { t } = useT();
  const history = useQuery({
    queryKey: ['admin', 'listings', { ownerId: l.owner.id, pageSize: 20 }],
    queryFn: () => api.listAdminListings({ ownerId: l.owner.id, pageSize: 20 }),
    enabled: !!l.owner.id,
  });
  const others = history.data?.items.filter((x) => x.id !== l.id) ?? [];
  const bad = others.filter((x) => x.status === 'REJECTED' || x.status === 'BLOCKED').length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={l.owner.name} url={l.owner.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <Link to={`/users/${l.owner.id}`} className="block truncate font-medium hover:text-brand-fg hover:underline">
            {l.owner.name}
          </Link>
          <p className="text-xs text-muted">
            {enumLabel(l.owner.accountType)} · {t('member since {d}', { d: fmtDate(l.owner.memberSince) })}
          </p>
        </div>
      </div>
      <KeyValue
        cols={2}
        items={[
          [t('Contact name'), l.contactName],
          [
            t('Phone'),
            l.ownerPhone ? (
              <a key="ph" href={`tel:${l.ownerPhone}`} className="inline-flex items-center gap-1 whitespace-nowrap hover:underline">
                <Phone className="size-3" />
                {formatPhone(l.ownerPhone)}
              </a>
            ) : (
              l.contactPhoneMasked
            ),
          ],
          [t('Agency'), l.agency ? <span key="ag" className="inline-flex items-center gap-1">{l.agency.name}{l.agency.verified && <BadgeCheck className="size-3.5 text-success" />}</span> : '—'],
          [t('Active listings'), l.owner.activeListings],
        ]}
      />
      <div>
        <p className="mb-1.5 flex items-center justify-between text-xs text-muted">
          <span>{t('Other listings by this owner')}</span>
          {bad > 0 && (
            <Badge tone="danger">
              <ShieldAlert className="size-3" />
              {t('{n} rejected/blocked', { n: bad })}
            </Badge>
          )}
        </p>
        {history.isLoading ? (
          <Skeleton className="h-10" />
        ) : history.error ? (
          <p className="text-xs text-muted">{t('History unavailable')}</p>
        ) : others.length === 0 ? (
          <p className="text-xs text-muted">{t('No other listings — first-time poster.')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {others.slice(0, 6).map((o) => (
              <li key={o.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <Link to={`/listings/${o.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {o.title}
                </Link>
                <span className="text-muted">{fmtRelative(o.createdAt)}</span>
                <StatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ReportsList({ reports }: { reports: ListingReport[] }) {
  const { t } = useT();
  if (!reports.length) return <EmptyState title={t('No reports')} hint={t('Nobody has complained about this listing.')} />;
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-lg border border-line p-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">{enumLabel(r.reason)}</Badge>
            <StatusBadge status={r.status} />
            <span className="ml-auto text-xs text-muted">{fmtDateTime(r.createdAt)}</span>
          </div>
          {r.comment && <p className="mt-1.5 whitespace-pre-wrap">{r.comment}</p>}
          <p className="mt-1 text-xs text-muted">{r.reporter ? r.reporter.name : t('Anonymous')}</p>
        </li>
      ))}
    </ul>
  );
}

export function SiteLink({ id, children }: { id: string; children?: ReactNode }) {
  const { t } = useT();
  return (
    <a href={listingSiteUrl(id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-fg hover:underline">
      {children ?? t('View on site')}
      <ExternalLink className="size-3.5" />
    </a>
  );
}
