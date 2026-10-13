import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import 'leaflet/dist/leaflet.css';
import '../globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import tokens from '@evtap/design-tokens/tokens.json';
import { LOCALES } from '@evtap/shared';
import { CookieNotice } from '@/components/layout/CookieNotice';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Providers } from '@/components/providers/Providers';
import { RealtimeBridge } from '@/components/providers/RealtimeBridge';
import { fetchPageLinks } from '@/lib/cms';
import { WEB_URL } from '@/lib/config';
import { toLocale } from '@/lib/i18n';
import { getMessages, getT } from '@/lib/i18n.server';
import { THEME_SCRIPT } from '@/lib/theme';

type Params = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: tokens.color.light.canvas },
    { media: '(prefers-color-scheme: dark)', color: tokens.color.dark.canvas },
  ],
  colorScheme: 'light dark',
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

/**
 * AppFrame: canvas background, a centered rounded frame (max 1440px, radius 36) that holds the glass TopNav,
 * the page and the footer. On phones the frame is the screen.
 */
export default async function LocaleLayout({ children, params }: Params & { children: ReactNode }) {
  const locale = toLocale((await params).locale);
  const t = getT(locale);
  const pages = await fetchPageLinks(locale);
  return (
    <html lang={locale} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas lg:p-3">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-pill focus:bg-ink focus:px-5 focus:py-3 focus:text-on-ink">
          {t('common.skipToContent')}
        </a>
        <Providers locale={locale} messages={getMessages(locale)}>
          <div className="relative mx-auto flex min-h-dvh max-w-[1440px] flex-col bg-frame lg:min-h-[calc(100dvh-24px)] lg:rounded-frame lg:shadow-card" style={{ overflow: 'clip' }}>
            <Header />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Footer pages={pages} />
          </div>
          <CookieNotice />
          <RealtimeBridge />
        </Providers>
      </body>
    </html>
  );
}
