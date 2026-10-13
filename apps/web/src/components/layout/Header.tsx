'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Avatar, IconButton, IconLink, LinkButton, MenuItem, Money, Popover, Sheet, Skeleton } from '@/components/ds';
import {
  BellIcon, BookmarkIcon, BuildingIcon, CalendarIcon, CardIcon, ChartIcon, ChatIcon, HeartIcon, HomeIcon, LogoutIcon, MenuIcon, PlusIcon,
  SearchIcon, SettingsIcon, UserIcon, WalletIcon,
} from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { LanguageOptions, SettingsMenu, ThemeOptions } from './LanguageSwitcher';
import { Logo } from './Logo';

type NavKey = 'sale' | 'rent' | 'daily' | 'agencies' | 'newBuildings';

export function useNavLinks() {
  const { t, href } = useI18n();
  return [
    { key: 'sale' as NavKey, href: href('/search?dealType=SALE'), label: t('nav.sale') },
    { key: 'rent' as NavKey, href: href('/search?dealType=RENT_LONG'), label: t('nav.rent') },
    { key: 'daily' as NavKey, href: href('/search?dealType=RENT_DAILY'), label: t('nav.daily') },
    { key: 'agencies' as NavKey, href: href('/agencies'), label: t('nav.agencies') },
    { key: 'newBuildings' as NavKey, href: href('/search?dealType=SALE&propertyType=APARTMENT&buildingType=NEW'), label: t('nav.newBuildings') },
  ];
}

export function useAccountLinks() {
  const { t, href } = useI18n();
  const { user } = useAuth();
  return [
    { href: href('/account'), label: t('account.nav.overview'), icon: <ChartIcon size={18} /> },
    { href: href('/account/listings'), label: t('account.nav.listings'), icon: <HomeIcon size={18} /> },
    { href: href('/account/favorites'), label: t('account.nav.favorites'), icon: <HeartIcon size={18} /> },
    { href: href('/account/messages'), label: t('account.nav.messages'), icon: <ChatIcon size={18} />, badge: user?.unreadMessages },
    { href: href('/account/notifications'), label: t('account.nav.notifications'), icon: <BellIcon size={18} />, badge: user?.unreadNotifications },
    { href: href('/account/bookings'), label: t('account.nav.bookings'), icon: <CalendarIcon size={18} /> },
    { href: href('/account/saved-searches'), label: t('account.nav.savedSearches'), icon: <BookmarkIcon size={18} /> },
    { href: href('/account/wallet'), label: t('account.nav.wallet'), icon: <WalletIcon size={18} /> },
    { href: href('/account/payments'), label: t('account.nav.payments'), icon: <CardIcon size={18} /> },
    { href: href('/account/business'), label: t('account.nav.business'), icon: <BuildingIcon size={18} /> },
    { href: href('/account/profile'), label: t('account.nav.profile'), icon: <SettingsIcon size={18} /> },
  ];
}

function useActiveNav(): NavKey | null {
  const pathname = usePathname();
  const sp = useSearchParams();
  if (/^\/[a-z]{2}\/agencies/.test(pathname)) return 'agencies';
  if (!/^\/[a-z]{2}\/search/.test(pathname)) return null;
  if (sp.get('buildingType') === 'NEW') return 'newBuildings';
  const d = sp.get('dealType');
  return d === 'SALE' ? 'sale' : d === 'RENT_LONG' ? 'rent' : d === 'RENT_DAILY' ? 'daily' : null;
}

function NavTabs({ active }: { active: NavKey | null }) {
  const { t } = useI18n();
  const nav = useNavLinks();
  return (
    <nav aria-label={t('nav.main')} className="hidden items-center gap-1.5 lg:flex">
      {nav.map((n) => (
        <Link
          key={n.key}
          href={n.href}
          aria-current={active === n.key ? 'page' : undefined}
          className={cn(
            'press inline-flex h-11 items-center whitespace-nowrap rounded-pill px-4 text-[14px] font-medium xl:px-5',
            active === n.key ? 'bg-ink text-on-ink' : 'bg-pill text-ink hover:bg-pill-hover',
            n.key === 'newBuildings' && 'hidden xl:inline-flex',
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function ActiveNavTabs() {
  return <NavTabs active={useActiveNav()} />;
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const links = useAccountLinks();
  if (!user) return null;
  return (
    <Popover
      align="right"
      width="w-80"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={t('account.title')} className="press rounded-full ring-2 ring-transparent hover:ring-pill focus-visible:ring-ink">
          <Avatar name={user.name || user.phone} url={user.avatarUrl} size={44} />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label={t('account.title')}>
          <div className="mb-2 rounded-md bg-surface-sunken p-3">
            <div className="truncate font-medium">{user.name || user.phone || user.email}</div>
            <div className="truncate text-caption text-muted">{user.phone ?? user.email}</div>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-caption text-ink-secondary">{t('account.wallet.balance')}</span>
              <Money value={user.wallet.balance + user.wallet.bonusBalance} currency={user.wallet.currency} minor className="font-display text-[22px] leading-none tracking-[-0.4px]" />
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {links.map((l) => (
              <MenuItem key={l.href} href={l.href} icon={l.icon} onClick={close} trailing={l.badge ? <span className="tabular rounded-pill bg-ink px-1.5 text-[11px] text-on-ink">{l.badge}</span> : undefined}>
                {l.label}
              </MenuItem>
            ))}
          </div>
          <div className="mt-1 border-t border-hairline pt-1">
            <MenuItem danger icon={<LogoutIcon size={18} />} onClick={() => void signOut()}>
              {t('nav.logout')}
            </MenuItem>
          </div>
        </div>
      )}
    </Popover>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, href } = useI18n();
  const { status, user, signOut } = useAuth();
  const nav = useNavLinks();
  const account = useAccountLinks();
  const authed = status === 'authenticated';
  return (
    <Sheet open={open} onClose={onClose} title={<Logo href={href('/')} size={32} />} side="left">
      {authed && user && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-surface-sunken p-3">
          <Avatar name={user.name || user.phone} url={user.avatarUrl} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{user.name || user.phone}</div>
            <Money value={user.wallet.balance + user.wallet.bonusBalance} currency={user.wallet.currency} minor className="text-label" />
          </div>
        </div>
      )}
      <nav className="flex flex-wrap gap-2" aria-label={t('nav.main')}>
        {nav.map((n) => (
          <Link key={n.key} href={n.href} className="press inline-flex h-11 items-center rounded-pill bg-pill px-4 text-[14px] font-medium hover:bg-pill-hover">
            {n.label}
          </Link>
        ))}
        <Link href={href('/business')} className="press inline-flex h-11 items-center rounded-pill bg-pill px-4 text-[14px] font-medium hover:bg-pill-hover">
          {t('nav.business')}
        </Link>
      </nav>
      <LinkButton href={href('/listings/new')} className="mt-4 w-full" icon={<PlusIcon size={18} />}>
        {t('nav.postAd')}
      </LinkButton>
      <div className="my-5 h-px bg-hairline" />
      {authed ? (
        <div className="flex flex-col">
          {account.map((l) => (
            <MenuItem key={l.href} href={l.href} icon={l.icon} onClick={onClose} trailing={l.badge ? <span className="tabular rounded-pill bg-ink px-1.5 text-[11px] text-on-ink">{l.badge}</span> : undefined}>
              {l.label}
            </MenuItem>
          ))}
          <MenuItem danger icon={<LogoutIcon size={18} />} onClick={() => void signOut()}>
            {t('nav.logout')}
          </MenuItem>
        </div>
      ) : (
        <LinkButton href={href('/login')} variant="secondary" className="w-full" icon={<UserIcon size={18} />}>
          {t('nav.login')}
        </LinkButton>
      )}
      <div className="my-5 h-px bg-hairline" />
      <div className="mb-2 text-caption text-muted">{t('theme.title')}</div>
      <ThemeOptions />
      <div className="mb-1 mt-5 text-caption text-muted">{t('header.language')}</div>
      <LanguageOptions onDone={onClose} />
    </Sheet>
  );
}

function RightCluster({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex items-center gap-2">{children}</div>;
}

/** TopNav: logo + wordmark · pill tabs · circular icon buttons + avatar · black "+ Elan yerləşdir" pill. */
export function Header() {
  const { t, href } = useI18n();
  const { status, user } = useAuth();
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenu(false), [pathname]);
  const authed = status === 'authenticated';
  const unread = useQuery({ queryKey: qk.unread, queryFn: api.conversations.unreadCount, enabled: authed, refetchInterval: 60_000, meta: { silent: true } });
  const unreadMessages = unread.data?.count ?? user?.unreadMessages ?? 0;
  const unreadNotifications = user?.unreadNotifications ?? 0;
  const loginHref = `${href('/login')}?next=${encodeURIComponent(pathname)}`;

  return (
    <header className="glass sticky top-0 z-50 border-x-0 border-t-0 lg:rounded-t-frame">
      <div className="flex h-18 items-center gap-2 px-4 md:px-6 lg:h-[84px] xl:px-8">
        <Logo href={href('/')} className="mr-2 xl:mr-6" />
        <Suspense fallback={<NavTabs active={null} />}>
          <ActiveNavTabs />
        </Suspense>
        <RightCluster>
          <IconLink href={href('/search')} label={t('common.search')} className="hidden sm:inline-flex">
            <SearchIcon size={20} />
          </IconLink>
          {authed && (
            <>
              <IconLink href={href('/account/messages')} label={t('nav.messages')} count={unreadMessages} className="hidden xl:inline-flex">
                <ChatIcon size={20} />
              </IconLink>
              <IconLink href={href('/account/notifications')} label={t('nav.notifications')} dot={unreadNotifications > 0 || unreadMessages > 0}>
                <BellIcon size={20} />
              </IconLink>
            </>
          )}
          <span className="hidden lg:block">
            <SettingsMenu />
          </span>
          {authed ? (
            <span className="hidden lg:block">
              <UserMenu />
            </span>
          ) : status === 'loading' ? (
            <Skeleton className="hidden h-11 w-11 rounded-full lg:block" />
          ) : (
            <LinkButton href={loginHref} variant="secondary" className="hidden lg:inline-flex" icon={<UserIcon size={18} />}>
              {t('nav.login')}
            </LinkButton>
          )}
          <LinkButton href={href('/listings/new')} className="hidden xl:inline-flex" icon={<PlusIcon size={18} />}>
            {t('nav.postAd')}
          </LinkButton>
          <IconLink href={href('/listings/new')} label={t('nav.postAd')} variant="ink" className="xl:hidden">
            <PlusIcon size={20} />
          </IconLink>
          <IconButton label={t('nav.menu')} className="lg:hidden" onClick={() => setMenu(true)} aria-haspopup="dialog">
            <MenuIcon size={20} />
          </IconButton>
        </RightCluster>
      </div>
      <MobileMenu open={menu} onClose={() => setMenu(false)} />
    </header>
  );
}
