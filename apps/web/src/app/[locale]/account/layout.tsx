'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Avatar, Card, Money } from '@/components/ds';
import {
  BellIcon, BookmarkIcon, BuildingIcon, CalendarDaysIcon, CalendarIcon, CardIcon, ChartIcon, ChatIcon, HeartIcon, HomeIcon, SettingsIcon, UsersIcon, WalletIcon,
} from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

interface NavItem { path: string; label: string; icon: ReactNode; badge?: number }

function useGroups() {
  const { t } = useI18n();
  const { user } = useAuth();
  const groups: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { path: '/account', label: t('account.nav.overview'), icon: <ChartIcon size={18} /> },
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
        { path: '/account/calendar', label: t('account.nav.calendar'), icon: <CalendarDaysIcon size={18} /> },
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
  return groups;
}

function AccountNav() {
  const { t, href } = useI18n();
  const { user } = useAuth();
  const pathname = usePathname();
  const groups = useGroups();
  const all = groups.flatMap((g) => g.items);
  // longest matching path wins (so /account/agency/stats doesn't also light up /account/agency or /account)
  const activePath = all
    .filter((i) => pathname === href(i.path) || pathname.startsWith(href(i.path) + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const pill = (active: boolean) =>
    cn('press flex items-center gap-3 rounded-pill text-[14px] font-medium', active ? 'bg-ink text-on-ink' : 'text-ink hover:bg-surface-sunken');
  return (
    <>
      {/* phones / tablets: horizontal pill row */}
      <nav className="scrollbar-none -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 py-0.5 lg:hidden" aria-label={t('account.title')}>
        {all.map((i) => (
          <Link key={i.path} href={href(i.path)} aria-current={activePath === i.path ? 'page' : undefined} className={cn(pill(activePath === i.path), 'h-11 shrink-0 px-4', activePath !== i.path && 'bg-pill')}>
            {i.label}
            {!!i.badge && <span className="tabular rounded-pill bg-accent-strong px-1.5 text-[11px] text-on-accent">{i.badge}</span>}
          </Link>
        ))}
      </nav>
      {/* desktop sidebar */}
      <aside className="hidden lg:block">
        <Card className="p-3" aria-label={t('account.title')}>
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface-raised p-3 shadow-pill">
            <Avatar name={user?.name || user?.phone} url={user?.avatarUrl} size={48} />
            <div className="min-w-0">
              <div className="truncate font-medium">{user?.name || user?.phone}</div>
              {user && (
                <Link href={href('/account/wallet')} className="text-caption text-ink-secondary hover:underline">
                  {t('account.wallet.balance')}: <Money value={user.wallet.balance + user.wallet.bonusBalance} currency={user.wallet.currency} minor className="font-medium text-ink" />
                </Link>
              )}
            </div>
          </div>
          <nav aria-label={t('account.title')}>
            {groups.map((g, gi) => (
              <div key={gi} className="mt-3">
                {g.title && <div className="px-3 pb-1.5 text-caption text-muted">{g.title}</div>}
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((i) => {
                    const active = activePath === i.path;
                    return (
                      <li key={i.path}>
                        <Link href={href(i.path)} aria-current={active ? 'page' : undefined} className={cn(pill(active), 'h-11 px-3')}>
                          <span className={active ? 'text-on-ink' : 'text-ink-secondary'}>{i.icon}</span>
                          <span className="flex-1 truncate">{i.label}</span>
                          {!!i.badge && <span className={cn('tabular rounded-pill px-1.5 text-[11px]', active ? 'bg-on-ink text-ink' : 'bg-ink text-on-ink')}>{i.badge}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </Card>
      </aside>
    </>
  );
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container-page py-6 sm:py-8">
      <RequireAuth>
        <div className="lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-6">
          <AccountNav />
          <div className="min-w-0">{children}</div>
        </div>
      </RequireAuth>
    </div>
  );
}
