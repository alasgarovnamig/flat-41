import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { PublicUser } from '@evtap/shared';
import { OwnerListings } from '@/components/listings/OwnerListings';
import { RetryError } from '@/components/RetryError';
import { Avatar, Badge, BigNumber, Card, Rating } from '@/components/ds';
import { ArrowUpRightIcon } from '@/components/ds/icons';
import { api, isApiError } from '@/lib/api';
import { formatDate, toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';
import { isUuid } from '@/lib/utils';

type Props = { params: Promise<{ locale: string; id: string }> };

const load = cache(async (id: string): Promise<PublicUser | 'not_found' | 'error'> => {
  if (!isUuid(id)) return 'not_found';
  try {
    return await api.users.get(id);
  } catch (e) {
    return isApiError(e) && (e.status === 404 || e.status === 400) ? 'not_found' : 'error';
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const t = getT(toLocale(locale));
  const u = await load(id);
  if (typeof u === 'string') return { title: t('user.title'), robots: { index: false } };
  return { title: u.name, description: t('user.metaDescription', { name: u.name, n: u.activeListings }) };
}

export default async function UserPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = toLocale(raw);
  const t = getT(locale);
  const u = await load(id);
  if (u === 'not_found') notFound();
  if (u === 'error') return <RetryError />;
  return (
    <div className="container-page py-8">
      <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card pad="lg" className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={u.name} url={u.avatarUrl} size={96} />
          <div className="min-w-0">
            <h1 className="text-h1">{u.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={u.accountType === 'BUSINESS' ? 'business' : 'neutral'} size="md">{t(`enums.accountType.${u.accountType}`)}</Badge>
              {u.rating != null && <Rating value={u.rating} count={u.reviewsCount} className="text-label" />}
              <span className="text-label font-normal text-ink-secondary">{t('listing.memberSince', { date: formatDate(u.memberSince, locale, { month: 'long', year: 'numeric' }) })}</span>
            </div>
            {u.agency && (
              <Link href={`/${locale}/agencies/${u.agency.slug}`} className="press mt-4 inline-flex h-10 items-center gap-2 rounded-pill bg-ink px-4 text-label font-medium text-on-ink">
                {u.agency.name} <ArrowUpRightIcon size={15} />
              </Link>
            )}
          </div>
        </Card>
        <Card className="flex flex-col justify-between gap-6">
          <div className="text-h3">{t('agencies.activeListings')}</div>
          <BigNumber size="xl">{u.activeListings}</BigNumber>
        </Card>
      </div>
      <OwnerListings ownerId={u.id} />
    </div>
  );
}
