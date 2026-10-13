import '@fontsource-variable/inter';
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '404 — EvTap', robots: { index: false } };

/** Used only for URLs that bypass locale routing (e.g. unknown static files). */
export default function GlobalNotFound() {
  return (
    <html lang="az">
      <body className="flex min-h-dvh flex-col items-center justify-center bg-surface p-6 text-center">
        <div className="text-7xl font-black text-brand">404</div>
        <h1 className="mt-4 text-2xl font-bold">Səhifə tapılmadı · Page not found</h1>
        <a href="/az" className="mt-6 rounded-xl bg-brand px-5 py-3 font-semibold text-white">
          EvTap
        </a>
      </body>
    </html>
  );
}
