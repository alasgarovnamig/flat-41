'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { useFavorites } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Modal';
import {
  BellIcon, BookmarkIcon, BuildingIcon, CalendarIcon, ChatIcon, ChevronDown, CardIcon, HeartIcon, HomeIcon, LogoutIcon,
  MenuIcon, PlusIcon, SettingsIcon, UserIcon, UsersIcon, WalletIcon,
} from '@/components/ui/icons';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';

function CountBadge({ n, tone = 'urgent' }: { n: number; tone?: 'urgent' | 'brand' }) {
  if (!n) return null;
  return (
    <span className={cn('absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white', tone === 'urgent' ? 'bg-urgent' : 'bg-brand')}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function IconLink({ href, label, children, badge, tone }: { href: string; label: string; children: React.ReactNode; badge?: number; tone?: 'urgent' | 'brand' }) {
  return (
    <Link href={href} aria-label={label} title={label} className="relative flex h-10 w-10 items-center justify-center rounded-xl text-ink hover:bg-ink/5">
      {children}
      <CountBadge n={badge ?? 0} tone={tone} />
    </Link>
  );
}

export function useNavLinks() {
  const { t, href } = useI18n();
  return [
    { href: href('/search?dealType=SALE'), label: t('nav.sale') },
    { href: href('/search?dealType=RENT_LONG'), label: t('nav.rent') },
    { href: href('/search?dealType=RENT_DAILY'), label: t('nav.daily') },
    { href: href('/agencies'), label: t('nav.agencies') },
    { href: href('/search?dealType=SALE&propertyType=APARTMENT&buildingType=NEW'), label: t('nav.newBuildings') },
  ];
}

function useAccountLinks() {
  const { t, href } = useI18n();
  return [
    { href: href('/account/listings'), label: t('account.nav.listings'), icon: <HomeIcon size={18} /> },
    { href: href('/account/favorites'), label: t('account.nav.favorites'), icon: <HeartIcon size={18} /> },
    { href: href('/account/messages'), label: t('account.nav.messages'), icon: <ChatIcon size={18} /> },
    { href: href('/account/bookings'), label: t('account.nav.bookings'), icon: <CalendarIcon size={18} /> },
    { href: href('/account/saved-searches'), label: t('account.nav.savedSearches'), icon: <BookmarkIcon size={18} /> },
    { href: href('/account/wallet'), label: t('account.nav.wallet'), icon: <WalletIcon size={18} /> },
    { href: href('/account/payments'), label: t('account.nav.payments'), icon: <CardIcon size={18} /> },
    { href: href('/account/business'), label: t('account.nav.business'), icon: <BuildingIcon size={18} /> },
    { href: href('/account/profile'), label: t('account.nav.profile'), icon: <SettingsIcon size={18} /> },
  ];
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const links = useAccountLinks();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);
  if (!user) return null;
  const avatar = assetUrl(user.avatarUrl);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex h-10 items-center gap-2 rounded-xl pl-1 pr-2 hover:bg-ink/5">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{initials(user.name)}</span>
        )}
        <ChevronDown size={14} className="hidden text-muted lg:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-2xl border border-line bg-white shadow-xl animate-in">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate font-semibold">{user.name || user.phone || user.email}</div>
            <div className="truncate text-xs text-muted">{user.phone ?? user.email}</div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 text-sm">
              <span className="text-brand-dark">{t('account.wallet.balance')}</span>
              <span className="font-bold text-brand-dark">{formatMoney(user.wallet.balance + user.wallet.bonusBalance, user.wallet.currency)}</span>
            </div>
          </div>
          <div className="py-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} role="menuitem" className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface">
                <span className="text-muted">{l.icon}</span>
                {l.label}
              </Link>
            ))}
          </div>
          <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-sm text-urgent hover:bg-urgent-50" role="menuitem">
            <LogoutIcon size={18} />
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { t, href } = useI18n();
  const { status, user, signOut } = useAuth();
  const fav = useFavorites();
  const nav = useNavLinks();
  const accountLinks = useAccountLinks();
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  useEffect(() => setDrawer(false), [pathname]);
  const authed = status === 'authenticated';
  const unread = useQuery({ queryKey: qk.unread, queryFn: api.conversations.unreadCount, enabled: authed, refetchInterval: 60_000, meta: { silent: true } });
  const unreadMessages = unread.data?.count ?? user?.unreadMessages ?? 0;

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="container-page flex h-16 items-center gap-3">
        <button type="button" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-xl hover:bg-ink/5 lg:hidden" aria-label={t('nav.menu')} onClick={() => setDrawer(true)}>
          <MenuIcon />
        </button>
        <Logo href={href('/')} />
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label={t('nav.main')}>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-ink/80 hover:bg-ink/5 hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <IconLink href={authed ? href('/account/favorites') : href('/login?next=' + encodeURIComponent(href('/account/favorites')))} label={t('nav.favorites')} badge={fav.count} tone="brand">
            <HeartIcon />
          </IconLink>
          {authed && (
            <>
              <IconLink href={href('/account/messages')} label={t('nav.messages')} badge={unreadMessages}>
                <ChatIcon />
              </IconLink>
              <span className="hidden sm:block">
                <IconLink href={href('/account/notifications')} label={t('nav.notifications')} badge={user?.unreadNotifications ?? 0}>
                  <BellIcon />
                </IconLink>
              </span>
            </>
          )}
          <span className="ml-1 hidden md:block">
            <LinkButton href={href('/listings/new')} size="md" icon={<PlusIcon size={18} />}>
              {t('nav.postAd')}
            </LinkButton>
          </span>
          <LinkButton href={href('/listings/new')} size="icon" className="ml-1 md:hidden" aria-label={t('nav.postAd')}>
            <PlusIcon size={20} />
          </LinkButton>
          {authed ? (
            <div className="ml-1 hidden sm:block">
              <UserMenu />
            </div>
          ) : status === 'loading' ? (
            <div className="ml-1 hidden h-8 w-8 rounded-full skeleton sm:block" />
          ) : (
            <Link href={href('/login')} aria-label={t('nav.login')} className="ml-1 flex h-10 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold hover:bg-ink/5 sm:px-3">
              <UserIcon size={18} />
              <span className="hidden sm:inline">{t('nav.login')}</span>
            </Link>
          )}
        </div>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title={<Logo href={href('/')} />}>
        <nav className="flex flex-col gap-1" aria-label={t('nav.main')}>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-xl px-3 py-3 font-semibold hover:bg-surface">
              {n.label}
            </Link>
          ))}
          <Link href={href('/business')} className="rounded-xl px-3 py-3 font-semibold hover:bg-surface">
            {t('nav.business')}
          </Link>
        </nav>
        <div className="my-4 border-t border-line" />
        {authed ? (
          <div className="flex flex-col gap-1">
            <div className="px-3 pb-2 text-sm text-muted">{user?.name || user?.phone}</div>
            {accountLinks.map((l) => (
              <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface">
                <span className="text-muted">{l.icon}</span>
                {l.label}
              </Link>
            ))}
            <Link href={href('/account/notifications')} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface">
              <span className="text-muted"><BellIcon size={18} /></span>
              {t('nav.notifications')}
            </Link>
            <button type="button" onClick={() => void signOut()} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-urgent hover:bg-urgent-50">
              <LogoutIcon size={18} />
              {t('nav.logout')}
            </button>
          </div>
        ) : (
          <LinkButton href={href('/login')} variant="outline" className="w-full" icon={<UserIcon size={18} />}>
            {t('nav.login')}
          </LinkButton>
        )}
        <div className="mt-4 flex items-center justify-between rounded-xl bg-surface px-3 py-2">
          <span className="text-sm text-muted">{t('header.language')}</span>
          <LanguageSwitcher />
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted">
          <UsersIcon size={14} /> {t('footer.tagline')}
        </div>
      </Drawer>
    </header>
  );
}
