'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import type { Locale } from '@evtap/shared';
import { errorMessage } from '@/lib/errors';
import { isApiError } from '@/lib/api';
import type { Messages } from '@/lib/i18n';
import { AuthProvider } from './AuthProvider';
import { I18nProvider, useI18n } from './I18nProvider';
import { ToastProvider, useToast } from './ToastProvider';

function QueryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { t } = useI18n();
  // keep latest toast/t for the (stable) mutation cache callback
  const ref = useRef({ toast, t });
  ref.current = { toast, t };
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, e) => !(isApiError(e) && e.status >= 400 && e.status < 500) && count < 1,
          },
        },
        mutationCache: new MutationCache({
          onError: (e, _v, _c, m) => {
            if (m.meta?.silent) return;
            ref.current.toast.error(errorMessage(e, ref.current.t));
          },
        }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function Providers({ locale, messages, fallback, children }: { locale: Locale; messages: Messages; fallback?: Messages; children: ReactNode }) {
  return (
    <I18nProvider locale={locale} messages={messages} fallback={fallback}>
      <ToastProvider>
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
