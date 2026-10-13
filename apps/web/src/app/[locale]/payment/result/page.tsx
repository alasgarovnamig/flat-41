import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PaymentResult } from '@/components/payments/PaymentResult';
import { PageSpinner } from '@/components/ds';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('result.title'), robots: { index: false } };
}

export default function PaymentResultPage() {
  return (
    <div className="container-page py-12">
      <Suspense fallback={<PageSpinner />}>
        <PaymentResult />
      </Suspense>
    </div>
  );
}
