import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALES } from '@evtap/shared';

/** Locale routing: every page lives under /az, /ru or /en. "/" → "/az" (or the remembered NEXT_LOCALE cookie). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/')[1];
  if ((LOCALES as string[]).includes(first ?? '')) return NextResponse.next();

  const cookie = request.cookies.get('NEXT_LOCALE')?.value;
  const locale = cookie && (LOCALES as string[]).includes(cookie) ? cookie : DEFAULT_LOCALE;
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // skip Next internals, metadata routes and any file with an extension
  matcher: ['/((?!_next|api|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\..*).*)'],
};
