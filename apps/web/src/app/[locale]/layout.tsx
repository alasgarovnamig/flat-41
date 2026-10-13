import '@fontsource-variable/inter';
import '../globals.css';
import 'leaflet/dist/leaflet.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LOCALES } from '@evtap/shared';
import { CookieNotice } from '@/components/layout/CookieNotice';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Providers } from '@/components/providers/Providers';
import { RealtimeBridge } from '@/components/providers/RealtimeBridge';
import { WEB_URL } from '@/lib/config';
import { toLocale } from '@/lib/i18n';
import { getMessages, getT } from '@/lib/i18n.server';

type Params = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: '#0E7C66',
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = getT(locale);
  return {
    metadataBase: new URL(WEB_URL),
    title: { default: `EvTap — ${t('meta.homeTitle')}`, template: '%s | EvTap' },
    description: t('meta.homeDescription'),
    applicationName: 'EvTap',
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
    openGraph: { type: 'website', siteName: 'EvTap', locale, title: `EvTap — ${t('meta.homeTitle')}`, description: t('meta.homeDescription') },
    twitter: { card: 'summary_large_image' },
    icons: { icon: '/icon.svg' },
  };
}

export default async function LocaleLayout({ children, params }: Params & { children: ReactNode }) {
  const locale = toLocale((await params).locale);
  const t = getT(locale);
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          {t('common.skipToContent')}
        </a>
        <Providers locale={locale} messages={getMessages(locale)}>
          <Header />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
          <CookieNotice />
          <RealtimeBridge />
        </Providers>
      </body>
    </html>
  );
}
