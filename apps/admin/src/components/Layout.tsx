import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { ChevronRight, Languages, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useOverview } from '../api/queries';
import { MOCK } from '../env';
import { useT } from '../i18n';
import { useMedia, useTheme } from '../lib/hooks';
import { ALL_NAV_ITEMS, NAV } from '../nav';
import { StatusBadge } from './StatusBadge';
import { Avatar, cx } from './ui';

// ─────────────────────────── Breadcrumb detail label ───────────────────────────
const CrumbCtx = createContext<(label: string | null) => void>(() => {});
/** Detail pages call this to name the last breadcrumb (e.g. a listing title). */
export function useCrumb(label: string | null | undefined) {
  const set = useContext(CrumbCtx);
  useEffect(() => {
    set(label ?? null);
    return () => set(null);
  }, [label, set]);
}

const COLLAPSE_KEY = 'evtap.admin.sidebar';

export function Layout() {
  const isDesktop = useMedia('(min-width: 1024px)');
  const isMobile = !useMedia('(min-width: 768px)');
  const [pinnedCollapsed, setPinnedCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [crumb, setCrumb] = useState<string | null>(null);
  const loc = useLocation();

  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const collapsed = isMobile ? false : isDesktop ? pinnedCollapsed : true;
  const toggleCollapse = () => {
    if (isMobile) return setMobileOpen((o) => !o);
    const next = !pinnedCollapsed;
    setPinnedCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  return (
    <CrumbCtx.Provider value={setCrumb}>
      <div className="flex min-h-screen">
        {isMobile && mobileOpen && <div className="animate-fade fixed inset-0 z-30 bg-black/40" onClick={() => setMobileOpen(false)} />}
        <Sidebar collapsed={collapsed} hidden={isMobile && !mobileOpen} overlay={isMobile} onClose={() => setMobileOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar collapsed={collapsed} onToggle={toggleCollapse} isMobile={isMobile} crumb={crumb} />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 md:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </CrumbCtx.Provider>
  );
}

function Sidebar({ collapsed, hidden, overlay, onClose }: { collapsed: boolean; hidden: boolean; overlay: boolean; onClose: () => void }) {
  const { t } = useT();
  const { isAdmin } = useAuth();
  const overview = useOverview();
  const counters = {
    pending: overview.data?.listings.pending,
    reports: overview.data?.reports.open,
  };
  if (hidden) return null;
  return (
    <aside
      className={cx(
        'flex shrink-0 flex-col border-r border-line bg-card',
        overlay ? 'animate-drawer fixed inset-y-0 left-0 z-40 w-64 shadow-2xl' : 'sticky top-0 h-screen',
        !overlay && (collapsed ? 'w-[68px]' : 'w-60'),
      )}
    >
      <div className={cx('flex h-14 items-center gap-2.5 border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Link to="/" className="flex items-center gap-2.5" title="EvTap Admin">
          <img src="/favicon.svg" alt="" className="size-8" />
          {!collapsed && (
            <span className="text-[15px] font-semibold tracking-tight">
              EvTap <span className="font-normal text-muted">Admin</span>
            </span>
          )}
        </Link>
        {overlay && (
          <button onClick={onClose} className="ml-auto rounded-md p-1 text-muted hover:bg-hover" aria-label={t('Close menu')}>
            <X className="size-4" />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={t('Main')}>
        {NAV.map((section) => {
          const items = section.items.filter((i) => !i.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div key={section.label} className="mb-3">
              {!collapsed ? (
                <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{t(section.label)}</p>
              ) : (
                <div className="mx-3 mb-1.5 border-t border-line first:hidden" />
              )}
              {items.map((item) => {
                const count = item.counter ? counters[item.counter] : undefined;
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    title={collapsed ? t(item.label) : undefined}
                    className={({ isActive }) =>
                      cx(
                        'relative mb-0.5 flex items-center gap-2.5 rounded-lg text-[13.5px] font-medium transition-colors',
                        collapsed ? 'h-10 justify-center' : 'h-9 px-2.5',
                        isActive ? 'bg-brand-soft text-brand-fg' : 'text-muted hover:bg-hover hover:text-fg',
                      )
                    }
                  >
                    <Icon className="size-[18px] shrink-0" />
                    {!collapsed && <span className="flex-1 truncate">{t(item.label)}</span>}
                    {!!count && (
                      <span
                        className={cx(
                          'rounded-full bg-danger text-center text-[11px] leading-[18px] font-semibold text-white tabular-nums',
                          collapsed ? 'absolute top-0.5 right-1 min-w-[18px] px-1' : 'min-w-[20px] px-1.5',
                        )}
                        aria-label={t('{n} waiting', { n: count })}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>
      {MOCK && !collapsed && (
        <div className="m-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <strong>{t('Mock mode')}</strong> — {t('fixture data, no API calls.')}
        </div>
      )}
    </aside>
  );
}

function Topbar({ collapsed, onToggle, isMobile, crumb }: { collapsed: boolean; onToggle: () => void; isMobile: boolean; crumb: string | null }) {
  const { t, lang, setLang } = useT();
  const { dark, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-card/90 px-3 backdrop-blur md:px-4">
      <button onClick={onToggle} className="rounded-lg p-2 text-muted hover:bg-hover hover:text-fg" aria-label={t('Toggle sidebar')}>
        {isMobile ? <Menu className="size-5" /> : collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
      </button>
      <Breadcrumb detail={crumb} />
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => setLang(lang === 'en' ? 'az' : 'en')}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-hover hover:text-fg"
          aria-label={t('Language')}
          title={t('Language')}
        >
          <Languages className="size-4" />
          {lang.toUpperCase()}
        </button>
        <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-hover hover:text-fg" aria-label={dark ? t('Light mode') : t('Dark mode')} title={dark ? t('Light mode') : t('Dark mode')}>
          {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

function Breadcrumb({ detail }: { detail: string | null }) {
  const { t } = useT();
  const { pathname } = useLocation();
  const section = ALL_NAV_ITEMS.filter((i) => i.to !== '/').find((i) => pathname === i.to || pathname.startsWith(i.to + '/'));
  const crumbs: { label: string; to?: string }[] = [{ label: t('Dashboard'), to: '/' }];
  if (section) crumbs.push({ label: t(section.label), to: section.to });
  if (section && pathname !== section.to) crumbs.push({ label: detail ?? '…' });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className={cx('flex min-w-0 items-center gap-1', !last && i === 0 && crumbs.length > 2 && 'hidden sm:flex')}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted" />}
              {last || !c.to ? (
                <span className="truncate font-medium" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link to={c.to} className="truncate text-muted hover:text-fg">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-hover" aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} url={user.avatarUrl} size={30} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-[13px] font-medium">{user.name}</span>
          <span className="block text-[11px] text-muted">{user.role === 'ADMIN' ? t('Administrator') : t('Moderator')}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="animate-pop absolute right-0 mt-1 w-60 rounded-xl border border-line bg-elevated p-1.5 shadow-xl">
          <div className="px-2.5 py-2">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email ?? user.phone}</p>
            <div className="mt-1.5">
              <StatusBadge status={user.role} />
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          <button role="menuitem" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-soft">
            <LogOut className="size-4" />
            {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}
