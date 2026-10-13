import type { Metadata } from 'next';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ListingWizard } from '@/components/wizard/ListingWizard';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('wizard.title'), robots: { index: false } };
}

export default function NewListingPage() {
  return (
    <div className="container-page py-8">
      <RequireAuth>
        <ListingWizard mode="create" />
      </RequireAuth>
    </div>
  );
}
