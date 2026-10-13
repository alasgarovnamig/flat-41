import {
  BadgeCheck, Banknote, Building2, CalendarRange, FileText, Flag, Gauge, Home, Image, Landmark, Megaphone, ScrollText,
  Settings, ShieldCheck, Tags, Users, type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  counter?: 'pending' | 'reports';
};
export type NavSection = { label: string; items: NavItem[] };

export const NAV: NavSection[] = [
  { label: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: Gauge }] },
  {
    label: 'Moderation',
    items: [
      { to: '/moderation', label: 'Moderation queue', icon: ShieldCheck, counter: 'pending' },
      { to: '/reports', label: 'Reports', icon: Flag, counter: 'reports' },
      { to: '/listings', label: 'Listings', icon: Home },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/users', label: 'Users', icon: Users },
      { to: '/agencies', label: 'Agencies', icon: Building2 },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/payments', label: 'Payments', icon: Banknote },
      { to: '/bookings', label: 'Bookings', icon: CalendarRange },
      { to: '/subscriptions', label: 'Subscriptions', icon: BadgeCheck },
      { to: '/catalog', label: 'Catalog & pricing', icon: Tags },
      { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/banners', label: 'Banners', icon: Image },
      { to: '/pages', label: 'CMS pages', icon: FileText },
      { to: '/mortgage', label: 'Mortgage leads', icon: Landmark },
      { to: '/broadcast', label: 'Broadcast', icon: Megaphone, adminOnly: true },
    ],
  },
  { label: 'System', items: [{ to: '/audit', label: 'Audit log', icon: ScrollText, adminOnly: true }] },
];

export const ALL_NAV_ITEMS = NAV.flatMap((s) => s.items);
