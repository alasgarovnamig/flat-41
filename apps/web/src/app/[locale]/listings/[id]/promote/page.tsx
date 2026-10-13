import type { Metadata } from 'next';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { PromoteView } from '@/components/payments/PromoteView';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('promote.title'), robots: { index: false } };
}

export default async function PromotePage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="container-page py-8">
      <RequireAuth>
        <PromoteView id={id} />
      </RequireAuth>
    </div>
  );
}
