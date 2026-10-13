'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CITIES, PLANS, localized, type DealType } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { dailyCounts } from '@/lib/series';
import { BannerSlot } from '@/components/BannerSlot';
import {
  BigNumber, Card, CardHeader, CardLink, EmptyState, ErrorState, LinkButton, Money, PropertyGrid, PropertyGridSkeleton, PropertyRow, SectionTitle,
  Skeleton, SplitMeter, StatCard,
} from '@/components/ds';
import { ArrowUpRightIcon, BuildingIcon, CalendarIcon, CheckIcon, HomeIcon, PinIcon, ShieldCheckIcon, StarIcon } from '@/components/ds/icons';
import { StoreBadges } from '@/components/layout/Footer';
import { LogoMark } from '@/components/layout/Logo';
import { useI18n } from '@/components/providers/I18nProvider';

/** Total active listings per deal type (cheap: pageSize=1 → `total`). */
function useDealTotals() {
  const one = (dealType: DealType) => ({ queryKey: qk.search({ dealType, count: true }), queryFn: () => api.listings.search({ dealType, page: 1, pageSize: 1 }), staleTime: 5 * 60_000 });
  const sale = useQuery(one('SALE'));
  const rent = useQuery(one('RENT_LONG'));
  const daily = useQuery(one('RENT_DAILY'));
  const loading = sale.isLoading || rent.isLoading || daily.isLoading;
  return { loading, sale: sale.data?.total ?? 0, rent: rent.data?.total ?? 0, daily: daily.data?.total ?? 0, error: sale.isError && rent.isError };
}

/** Hero SplitMeter: Satış (ink) vs Kirayə (peach), günlük kirayə = hatched remainder (labelled below). */
export function HeroMarket() {
  const { t, number, href } = useI18n();
  const d = useDealTotals();
  if (d.error) return null;
  return (
    <div className="rounded-xl bg-frame/70 p-1 backdrop-blur-sm">
      {d.loading ? (
        <div className="grid grid-cols-2 gap-4 p-2">
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="h-14 rounded-sm" />
          <Skeleton className="col-span-2 h-4 rounded-pill" />
        </div>
      ) : (
        <>
          <SplitMeter
            left={{ label: t('home.marketSale'), amount: d.sale, value: <Link href={href('/search?dealType=SALE')} className="hover:underline"><BigNumber>{number(d.sale)}</BigNumber></Link> }}
            right={{ label: t('home.marketRent'), amount: d.rent, value: <Link href={href('/search?dealType=RENT_LONG')} className="hover:underline"><BigNumber>{number(d.rent)}</BigNumber></Link> }}
            capacity={d.sale + d.rent + d.daily}
          />
          <p className="mt-2 flex items-center gap-2 pl-1 text-caption text-muted">
            <span className="hatch inline-block h-3 w-6 rounded-pill" aria-hidden />
            {t('home.marketDaily', { n: number(d.daily) })}
          </p>
        </>
      )}
    </div>
  );
}

function StatsStrip() {
  const { t, number, href } = useI18n();
  const latest = useQuery({ queryKey: qk.search({ home: 'stats' }), queryFn: () => api.listings.search({ sort: 'date_desc', page: 1, pageSize: 60 }), staleTime: 60_000 });
  const agencies = useQuery({ queryKey: qk.agencies({ home: true }), queryFn: () => api.agencies.list({ page: 1, pageSize: 50 }), staleTime: 5 * 60_000, retry: false });
  const items = latest.data?.items ?? [];
  const perDay = dailyCounts(items.map((l) => l.publishedAt ?? l.createdAt), 28);
  const dayAgo = Date.now() - 86_400_000;
  const today = items.filter((l) => Date.parse(l.publishedAt ?? l.createdAt) >= dayAgo).length;
  const hourly = Array.from({ length: 24 }, (_, h) => items.filter((l) => new Date(l.publishedAt ?? l.createdAt).getHours() === h && Date.parse(l.publishedAt ?? l.createdAt) >= dayAgo).length);
  const agencySpark = [...(agencies.data?.items ?? [])].map((a) => a.activeListings).sort((a, b) => a - b);
  return (
    <section className="container-page grid gap-4 md:grid-cols-3" aria-label={t('home.statsLabel')}>
      <StatCard label={t('home.statActive')} value={number(latest.data?.total ?? 0)} caption={t('home.statActiveCaption')} spark={perDay} sparkLabel={t('home.sparkPerDay')} loading={latest.isLoading} href={href('/search')} hrefLabel={t('common.seeAll')} />
      <StatCard label={t('home.statToday')} value={number(today)} caption={t('home.statTodayCaption')} spark={hourly} sparkLabel={t('home.sparkPerHour')} loading={latest.isLoading} href={href('/search?sort=date_desc')} hrefLabel={t('common.seeAll')} />
      <StatCard label={t('home.statAgencies')} value={number(agencies.data?.total ?? 0)} caption={t('home.statAgenciesCaption')} spark={agencySpark.length ? agencySpark : undefined} sparkLabel={t('home.sparkAgencies')} loading={agencies.isLoading} href={href('/agencies')} hrefLabel={t('nav.agencies')} />
    </section>
  );
}

function PremiumSection() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.featured({ kind: 'premium' }), queryFn: () => api.listings.featured({ kind: 'premium', limit: 12 }), retry: false });
  if (!q.isLoading && !q.data?.length) return null;
  return (
    <section className="container-page mt-6" aria-labelledby="premium-h">
      <Card>
        <CardHeader id="premium-h" title={t('home.premium')} sub={t('home.premiumSub')} action={<CardLink href={href('/search?sort=date_desc')} label={t('common.seeAll')} />} />
        <PropertyRow items={q.data ?? []} loading={q.isLoading} />
      </Card>
    </section>
  );
}

function VipSection() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.featured({ kind: 'vip', home: true }), queryFn: () => api.listings.featured({ kind: 'vip', limit: 8 }), retry: false });
  if (!q.isLoading && !q.data?.length) return null;
  return (
    <section className="container-page mt-12" aria-labelledby="vip-h">
      <SectionTitle id="vip-h" title={t('home.vip')} sub={t('home.vipSub')} action={<LinkButton href={href('/search')} variant="secondary" trailing={<ArrowUpRightIcon size={16} />}>{t('common.seeAll')}</LinkButton>} />
      {q.isLoading ? <PropertyGridSkeleton n={4} /> : <PropertyGrid items={q.data ?? []} />}
    </section>
  );
}

function LatestSection() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.search({ home: 'latest' }), queryFn: () => api.listings.search({ sort: 'date_desc', page: 1, pageSize: 8 }) });
  return (
    <section className="container-page mt-12" aria-labelledby="latest-h">
      <SectionTitle id="latest-h" title={t('home.latest')} sub={t('home.latestSub')} action={<LinkButton href={href('/search')} variant="secondary" trailing={<ArrowUpRightIcon size={16} />}>{t('common.seeAll')}</LinkButton>} />
      {q.isLoading ? (
        <PropertyGridSkeleton n={8} />
      ) : q.isError ? (
        <ErrorState title={t('home.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : q.data && q.data.items.length > 0 ? (
        <PropertyGrid items={q.data.items} />
      ) : (
        <EmptyState icon={<HomeIcon />} title={t('home.emptyTitle')} text={t('home.emptyText')} action={<LinkButton href={href('/listings/new')}>{t('nav.postAd')}</LinkButton>} />
      )}
    </section>
  );
}

function CitiesSection() {
  const { t, href, locale } = useI18n();
  const cities = CITIES.filter((c) => c.popular);
  return (
    <section className="container-page mt-12" aria-labelledby="cities-h">
      <Card>
        <CardHeader id="cities-h" title={t('home.popularCities')} sub={t('home.popularCitiesSub')} />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cities.map((c, i) => (
            <li key={c.id}>
              <Link href={href(`/search?cityId=${c.id}`)} className="press group relative flex h-28 flex-col justify-between overflow-hidden rounded-lg bg-surface-raised p-4 shadow-pill hover:shadow-raised sm:h-32">
                <span aria-hidden className={i % 3 === 0 ? 'hatch absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-60' : i % 3 === 1 ? 'absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/50' : 'absolute -right-6 -top-6 h-24 w-24 rounded-full bg-surface-sunken'} />
                <span className="relative flex items-center gap-1 text-caption text-muted">
                  <PinIcon size={13} /> {c.country === 'GE' ? t('home.georgia') : t('home.azerbaijan')}
                </span>
                <span className="relative flex items-end justify-between gap-2">
                  <span className="font-display text-[22px] font-normal leading-none tracking-[-0.4px]">{localized(c.name, locale)}</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-on-ink transition-transform motion-safe:group-hover:rotate-45">
                    <ArrowUpRightIcon size={16} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function DailyPromo() {
  const { t, href } = useI18n();
  const points = [t('home.daily1'), t('home.daily2'), t('home.daily3')];
  return (
    <Card pad="lg" className="relative overflow-hidden">
      <span aria-hidden className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,var(--c-accent)_0%,transparent_70%)] opacity-80" />
      <div className="relative grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
        <div>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-surface-raised px-3 text-label shadow-pill">
            <CalendarIcon size={14} /> {t('home.dailyBadge')}
          </span>
          <h2 className="mt-4 text-h1">{t('home.dailyTitle')}</h2>
          <p className="mt-2 text-ink-secondary">{t('home.dailyText')}</p>
          <ul className="mt-5 space-y-2.5 text-[14px]">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-on-ink">
                  <CheckIcon size={13} strokeWidth={2.4} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <LinkButton href={href('/search?dealType=RENT_DAILY')} className="mt-7" trailing={<ArrowUpRightIcon size={16} />}>
            {t('home.dailyCta')}
          </LinkButton>
        </div>
        <div className="glass mx-auto w-full max-w-xs rounded-xl p-5 shadow-raised" aria-hidden>
          <div className="flex items-center justify-between">
            <Money value={120} suffix={`/ ${t('common.perNight')}`} className="font-display text-[26px] tracking-[-0.6px]" />
            <span className="flex items-center gap-1 text-label">
              <StarIcon size={14} filled className="text-star" /> 4.9
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-label">
            <div className="rounded-md bg-surface-raised p-3">
              <div className="text-caption text-muted">{t('booking.checkIn')}</div>12.07
            </div>
            <div className="rounded-md bg-surface-raised p-3">
              <div className="text-caption text-muted">{t('booking.checkOut')}</div>15.07
            </div>
          </div>
          <div className="mt-3 flex h-12 items-center justify-center rounded-pill bg-ink text-[14px] font-medium text-on-ink">{t('booking.reserve')}</div>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-caption text-muted">
            <ShieldCheckIcon size={13} /> {t('booking.securePayment')}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BusinessTeaser() {
  const { t, href, locale } = useI18n();
  return (
    <Card pad="lg" className="flex flex-col">
      <span className="inline-flex h-8 w-fit items-center gap-1.5 rounded-pill bg-surface-raised px-3 text-label shadow-pill">
        <BuildingIcon size={14} /> {t('home.businessBadge')}
      </span>
      <h2 className="mt-4 text-h1">{t('home.businessTitle')}</h2>
      <p className="mt-2 text-ink-secondary">{t('home.businessText')}</p>
      <ul className="mt-6 grid flex-1 gap-2">
        {PLANS.map((p) => (
          <li key={p.code}>
            <Link href={href('/business')} className={`press flex items-center justify-between gap-3 rounded-lg p-4 ${p.code === 'PRO' ? 'bg-ink text-on-ink' : 'bg-surface-raised shadow-pill hover:shadow-raised'}`}>
              <span>
                <span className="block font-medium">{localized(p.name, locale)}</span>
                <span className={`block text-caption ${p.code === 'PRO' ? 'opacity-70' : 'text-muted'}`}>{p.listingQuota === -1 ? t('business.unlimitedListings') : t('business.listingsN', { n: p.listingQuota })}</span>
              </span>
              <Money value={p.priceMonthly} minor suffix={`/ ${t('common.perMonth')}`} className="font-display text-[22px] tracking-[-0.4px]" symbolClassName={p.code === 'PRO' ? 'text-subtle' : undefined} />
            </Link>
          </li>
        ))}
      </ul>
      <LinkButton href={href('/business')} variant="secondary" className="mt-5 w-full" trailing={<ArrowUpRightIcon size={16} />}>
        {t('home.businessCta')}
      </LinkButton>
    </Card>
  );
}

function AppPromo() {
  const { t } = useI18n();
  return (
    <section className="container-page mt-12">
      <Card pad="lg" className="flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
        <LogoMark size={72} />
        <div className="flex-1">
          <h2 className="text-h2">{t('home.appTitle')}</h2>
          <p className="mt-1 text-ink-secondary">{t('home.appText')}</p>
        </div>
        <StoreBadges />
      </Card>
    </section>
  );
}

function TrustStrip() {
  const { t } = useI18n();
  const items = [
    { icon: <ShieldCheckIcon size={22} />, title: t('home.trust1'), text: t('home.trust1Text') },
    { icon: <CalendarIcon size={22} />, title: t('home.trust2'), text: t('home.trust2Text') },
    { icon: <BuildingIcon size={22} />, title: t('home.trust3'), text: t('home.trust3Text') },
  ];
  return (
    <section className="container-page mt-12 grid gap-4 md:grid-cols-3">
      {items.map((i) => (
        <Card key={i.title} className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink">{i.icon}</div>
          <div>
            <h3 className="text-h3">{i.title}</h3>
            <p className="mt-1 text-label font-normal text-ink-secondary">{i.text}</p>
          </div>
        </Card>
      ))}
    </section>
  );
}

export function HomeSections() {
  return (
    <>
      <StatsStrip />
      <PremiumSection />
      <div className="container-page mt-6 empty:hidden">
        <BannerSlot placement="HOME_TOP" />
      </div>
      <VipSection />
      <LatestSection />
      <TrustStrip />
      <CitiesSection />
      <section className="container-page mt-12 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <DailyPromo />
        <BusinessTeaser />
      </section>
      <AppPromo />
    </>
  );
}
