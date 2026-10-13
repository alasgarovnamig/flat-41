'use client';

import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ds';
import { useI18n } from '@/components/providers/I18nProvider';

/** Server-rendered page could not reach the API: show a friendly error with a retry (router.refresh). */
export function RetryError({ titleKey = 'errors.pageUnavailable' }: { titleKey?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="container-page py-16">
      <ErrorState title={t(titleKey)} text={t('errors.NETWORK_ERROR')} onRetry={() => router.refresh()} retryLabel={t('common.retry')} />
    </div>
  );
}
