import type { Metadata } from 'next';
import type { Agency, Paginated } from '@evtap/shared';
import { AgenciesView } from '@/components/agencies/AgenciesView';
import { api } from '@/lib/api';
import { toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getT(toLocale((await params).locale));
  return { title: t('agencies.title'), description: t('agencies.subtitle') };
}

export const dynamic = 'force-dynamic';

export default async function AgenciesPage() {
  let initial: Paginated<Agency> | null = null;
  try {
    initial = await api.agencies.list({ page: 1, pageSize: 18 });
  } catch {
    initial = null;
  }
  return <AgenciesView initial={initial} />;
}
