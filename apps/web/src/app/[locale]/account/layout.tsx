'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatMoney } from '@evtap/shared';
import { assetUrl } from '@/lib/config';
import { cn, initials } from '@/lib/utils';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import {
  BellIcon, BookmarkIcon, BuildingIcon, CalendarIcon, CardIcon, ChartIcon, ChatIcon, HeartIcon, HomeIcon, SettingsIcon, UsersIcon, WalletIcon,
} from '@/components/ui/icons';

function AccountNav() {
  const { t, href } = useI18n();
  const { user } = useAuth();
  const pathname = usePathname();
  const groups: { title?: string; items: { path: string; label: string; icon: ReactNode; badge?: number }[] }[] = [
    {
      items: [
        { path: '/account/listings', label: t('account.nav.listings'), icon: <HomeIcon size={18} /> },
        { path: '/account/favorites', label: t('account.nav.favorites'), icon: <HeartIcon size={18} /> },
        { path: '/account/saved-searches', label: t('account.nav.savedSearches'), icon: <BookmarkIcon size={18} /> },
        { path: '/account/messages', label: t('account.nav.messages'), icon: <ChatIcon size={18} />, badge: user?.unreadMessages },
        { path: '/account/notifications', label: t('account.nav.notifications'), icon: <BellIcon size={18} />, badge: user?.unreadNotifications },
      ],
    },
    {
      title: t('account.nav.dailyRent'),
      items: [
        { path: '/account/bookings', label: t('account.nav.bookings'), icon: <CalendarIcon size={18} /> },
        { path: '/account/calendar', label: t('account.nav.calendar'), icon: <CalendarIcon size={18} /> },
      ],
    },
    {
      title: t('account.nav.money'),
      items: [
        { path: '/account/wallet', label: t('account.nav.wallet'), icon: <WalletIcon size={18} /> },
        { path: '/account/payments', label: t('account.nav.payments'), icon: <CardIcon size={18} /> },
      ],
    },
    {
      title: t('account.nav.businessGroup'),
      items: [
        { path: '/account/business', label: t('account.nav.business'), icon: <BuildingIcon size={18} /> },
        { path: '/account/agency', label: t('account.nav.agency'), icon: <BuildingIcon size={18} /> },
        { path: '/account/agency/members', label: t('account.nav.members'), icon: <UsersIcon size={18} /> },
        { path: '/account/agency/stats', label: t('account.nav.agencyStats'), icon: <ChartIcon size={18} /> },
      ],
    },
    { items: [{ path: '/account/profile', label: t('account.nav.profile'), icon: <SettingsIcon size={18} /> }] },
  ];
  const all = groups.flatMap((g) => g.items);
  const isActive = (p: string) => {
    const full = href(p);
    return pathname === full || (pathname.startsWith(full + '/') && !all.some((x) => x.path !== p && x.path.startsWith(p) && pathname.startsWith(href(x.path))));
  };
  const avatar = assetUrl(user?.avatarUrl);
  return (
    <>
      {/* mobile: horizontal tabs */}
      <nav className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 lg:hidden" aria-label={t('account.title')}>
        {all.map((i) => (
          <Link key={i.path} href={href(i.path)} className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium', isActive(i.path) ? 'border-brand bg-brand text-white' : 'border-line bg-white')}>
            {i.label}
            {!!i.badge && <span className="rounded-full bg-urgent px-1.5 text-[10px] font-bold text-white">{i.badge}</span>}
          </Link>
        ))}
      </nav>
      {/* desktop sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 rounded-card border border-line bg-white p-3 shadow-card">
          <div className="flex items-center gap-3 border-b border-line px-2 pb-3">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand font-bold text-white">{initials(user?.name)}</span>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold">{user?.name || user?.phone}</div>
              {user && <div className="text-xs text-muted">{t('account.wallet.balance')}: <b className="text-brand">{formatMoney(user.wallet.balance + user.wallet.bonusBalance, user.wallet.currency)}</b></div>}
            </div>
          </div>
          <nav aria-label={t('account.title')}>
            {groups.map((g, gi) => (
              <div key={gi} className="mt-2">
                {g.title && <div className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted">{g.title}</div>}
                {g.items.map((i) => (
                  <Link key={i.path} href={href(i.path)} aria-current={isActive(i.path) ? 'page' : undefined} className={cn('flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors', isActive(i.path) ? 'bg-brand-50 text-brand-dark' : 'text-ink/80 hover:bg-surface')}>
                    <span className={isActive(i.path) ? 'text-brand' : 'text-muted'}>{i.icon}</span>
                    <span className="flex-1">{i.label}</span>
                    {!!i.badge && <span className="rounded-full bg-urgent px-1.5 text-[10px] font-bold text-white">{i.badge}</span>}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container-page py-6">
      <RequireAuth>
        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
          <AccountNav />
          <div className="min-w-0">{children}</div>
        </div>
      </RequireAuth>
    </div>
  );
}
