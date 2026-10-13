import type { Metadata } from 'next';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { EditListing } from '@/components/wizard/EditListing';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('wizard.editTitle'), robots: { index: false } };
}

export default async function EditListingPage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="container-page py-8">
      <RequireAuth>
        <EditListing id={id} />
      </RequireAuth>
    </div>
  );
}
