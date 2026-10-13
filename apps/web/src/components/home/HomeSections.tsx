'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CITIES, PLANS, formatMoney, localized } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { BannerSlot } from '@/components/BannerSlot';
import { StoreBadges } from '@/components/layout/Footer';
import { LogoMark } from '@/components/layout/Logo';
import { ListingCarousel } from '@/components/listings/Carousel';
import { ListingGrid, ListingGridSkeleton } from '@/components/listings/ListingCard';
import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { BuildingIcon, CalendarIcon, CheckIcon, ChevronRight, CrownIcon, HomeIcon, ShieldCheckIcon, StarIcon } from '@/components/ui/icons';

function SectionHead({ title, sub, href, icon }: { title: string; sub?: string; href?: string; icon?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          {icon}
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {href && (
        <Link href={href} className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-brand hover:underline">
          {t('common.seeAll')} <ChevronRight size={16} />
        </Link>
      )}
    </div>
  );
}

function PremiumSection() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.featured({ kind: 'premium' }), queryFn: () => api.listings.featured({ kind: 'premium', limit: 12 }), retry: false });
  if (!q.isLoading && !q.data?.length) return null;
  return (
    <section className="container-page mt-12" aria-labelledby="premium-h">
      <div id="premium-h">
        <SectionHead title={t('home.premium')} sub={t('home.premiumSub')} icon={<CrownIcon className="text-premium" />} href={href('/search?sort=date_desc')} />
      </div>
      <ListingCarousel items={q.data ?? []} loading={q.isLoading} />
    </section>
  );
}

function VipSection() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.featured({ kind: 'vip', home: true }), queryFn: () => api.listings.featured({ kind: 'vip', limit: 8 }), retry: false });
  if (!q.isLoading && !q.data?.length) return null;
  return (
    <section className="container-page mt-12">
      <SectionHead title={t('home.vip')} sub={t('home.vipSub')} icon={<CrownIcon className="text-vip" />} href={href('/search')} />
      {q.isLoading ? <ListingGridSkeleton n={4} /> : <ListingGrid items={q.data ?? []} />}
    </section>
  );
}

function LatestSection() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.search({ home: 'latest' }), queryFn: () => api.listings.search({ sort: 'date_desc', page: 1, pageSize: 12 }) });
  return (
    <section className="container-page mt-12">
      <SectionHead title={t('home.latest')} sub={t('home.latestSub')} href={href('/search')} />
      {q.isLoading ? (
        <ListingGridSkeleton n={8} />
      ) : q.isError ? (
        <ErrorState title={t('home.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : q.data && q.data.items.length > 0 ? (
        <ListingGrid items={q.data.items} />
      ) : (
        <EmptyState icon={<HomeIcon />} title={t('home.emptyTitle')} text={t('home.emptyText')} action={<LinkButton href={href('/listings/new')}>{t('nav.postAd')}</LinkButton>} />
      )}
    </section>
  );
}

const CITY_GRADIENTS = ['from-teal-600 to-emerald-800', 'from-sky-600 to-indigo-800', 'from-amber-500 to-orange-700', 'from-rose-500 to-fuchsia-800', 'from-violet-600 to-purple-900', 'from-cyan-600 to-blue-800', 'from-lime-600 to-green-800', 'from-slate-600 to-slate-900'];

function CitiesSection() {
  const { t, href, locale } = useI18n();
  const cities = CITIES.filter((c) => c.popular);
  return (
    <section className="container-page mt-12">
      <SectionHead title={t('home.popularCities')} sub={t('home.popularCitiesSub')} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cities.map((c, i) => (
          <Link key={c.id} href={href(`/search?cityId=${c.id}`)} className={`group relative flex h-28 flex-col justify-end overflow-hidden rounded-card bg-gradient-to-br p-4 text-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover sm:h-36 ${CITY_GRADIENTS[i % CITY_GRADIENTS.length]}`}>
            <span className="absolute -right-4 -top-4 text-white/10 transition group-hover:scale-110">
              <BuildingIcon size={110} />
            </span>
            <span className="relative text-lg font-bold">{localized(c.name, locale)}</span>
            <span className="relative text-xs text-white/80">{c.country === 'GE' ? t('home.georgia') : t('home.azerbaijan')}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DailyPromo() {
  const { t, href } = useI18n();
  const points = [t('home.daily1'), t('home.daily2'), t('home.daily3')];
  return (
    <section className="container-page mt-12">
      <div className="grid overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark text-white md:grid-cols-2">
        <div className="p-6 sm:p-10">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            <CalendarIcon size={14} /> {t('home.dailyBadge')}
          </span>
          <h2 className="mt-3 text-2xl font-bold sm:text-3xl">{t('home.dailyTitle')}</h2>
          <p className="mt-2 text-white/80">{t('home.dailyText')}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <CheckIcon size={16} className="text-vip" /> {p}
              </li>
            ))}
          </ul>
          <LinkButton href={href('/search?dealType=RENT_DAILY')} variant="vip" className="mt-6">
            {t('home.dailyCta')}
          </LinkButton>
        </div>
        <div className="relative hidden items-center justify-center p-10 md:flex">
          <div className="w-full max-w-xs rotate-2 rounded-2xl bg-white p-4 text-ink shadow-2xl">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold">120 ₼ <span className="font-normal text-muted">/ {t('common.perNight')}</span></span>
              <span className="flex items-center gap-1 font-semibold"><StarIcon size={14} className="text-vip" /> 4.9</span>
            </div>
            <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-line text-xs">
              <div className="border-r border-line p-2"><div className="font-semibold uppercase text-muted">{t('booking.checkIn')}</div>12.07</div>
              <div className="p-2"><div className="font-semibold uppercase text-muted">{t('booking.checkOut')}</div>15.07</div>
            </div>
            <div className="mt-3 rounded-xl bg-brand py-2.5 text-center text-sm font-semibold text-white">{t('booking.reserve')}</div>
            <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-muted"><ShieldCheckIcon size={12} /> {t('booking.securePayment')}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BusinessTeaser() {
  const { t, href, locale } = useI18n();
  return (
    <section className="container-page mt-12">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <span className="text-sm font-semibold uppercase tracking-wide text-brand">{t('home.businessBadge')}</span>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{t('home.businessTitle')}</h2>
            <p className="mt-2 text-muted">{t('home.businessText')}</p>
            <LinkButton href={href('/business')} className="mt-5">
              {t('home.businessCta')}
            </LinkButton>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {PLANS.map((p) => (
              <Link key={p.code} href={href('/business')} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-card-hover ${p.code === 'PRO' ? 'border-brand bg-brand-50' : 'border-line'}`}>
                <div className="text-sm font-semibold text-muted">{localized(p.name, locale)}</div>
                <div className="mt-1 text-xl font-bold">
                  {formatMoney(p.priceMonthly)}
                  <span className="text-sm font-normal text-muted"> / {t('common.perMonth')}</span>
                </div>
                <div className="mt-2 text-xs text-muted">{p.listingQuota === -1 ? t('business.unlimitedListings') : t('business.listingsN', { n: p.listingQuota })}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AppPromo() {
  const { t } = useI18n();
  return (
    <section className="container-page mt-12">
      <div className="flex flex-col items-center gap-6 overflow-hidden rounded-2xl bg-ink p-6 text-white sm:p-10 md:flex-row">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white/10">
          <LogoMark size={56} />
        </div>
        <div className="flex-1 text-center md:text-left">
          <h2 className="text-2xl font-bold">{t('home.appTitle')}</h2>
          <p className="mt-1 text-white/70">{t('home.appText')}</p>
        </div>
        <StoreBadges dark={false} />
      </div>
    </section>
  );
}

function TrustStrip() {
  const { t } = useI18n();
  const items = [
    { icon: <ShieldCheckIcon />, title: t('home.trust1'), text: t('home.trust1Text') },
    { icon: <CalendarIcon />, title: t('home.trust2'), text: t('home.trust2Text') },
    { icon: <BuildingIcon />, title: t('home.trust3'), text: t('home.trust3Text') },
  ];
  return (
    <section className="container-page mt-12 grid gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.title} className="flex gap-3 rounded-card border border-line bg-white p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">{i.icon}</div>
          <div>
            <div className="font-semibold">{i.title}</div>
            <div className="text-sm text-muted">{i.text}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

export function HomeSections() {
  return (
    <>
      <div className="container-page mt-8">
        <BannerSlot placement="HOME_TOP" />
      </div>
      <PremiumSection />
      <VipSection />
      <LatestSection />
      <TrustStrip />
      <CitiesSection />
      <DailyPromo />
      <BusinessTeaser />
      <AppPromo />
    </>
  );
}
