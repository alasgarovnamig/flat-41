import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import './globals.css';
import type { Metadata } from 'next';
import { THEME_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = { title: '404 — EvTap', robots: { index: false } };

/** Used only for URLs that bypass locale routing (e.g. unknown static files). */
export default function GlobalNotFound() {
  return (
    <html lang="az" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh items-center justify-center bg-canvas p-3">
        <main className="flex w-full max-w-xl flex-col items-center rounded-frame bg-frame px-6 py-16 text-center shadow-card">
          <div className="font-display text-[96px] font-light leading-none tracking-[-4px] text-ink">404</div>
          <h1 className="mt-4 text-h2">Səhifə tapılmadı · Page not found</h1>
          <a href="/az" className="mt-8 inline-flex h-12 items-center rounded-pill bg-ink px-6 font-medium text-on-ink">
            EvTap
          </a>
        </main>
      </body>
    </html>
  );
}
