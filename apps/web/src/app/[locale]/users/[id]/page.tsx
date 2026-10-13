import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { PublicUser } from '@evtap/shared';
import { OwnerListings } from '@/components/listings/OwnerListings';
import { RetryError } from '@/components/RetryError';
import { Badge } from '@/components/ui/feedback';
import { StarIcon } from '@/components/ui/icons';
import { api, isApiError } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { formatDate, toLocale } from '@/lib/i18n';
import { getT } from '@/lib/i18n.server';
import { initials, isUuid } from '@/lib/utils';

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
  const avatar = assetUrl(u.avatarUrl);
  return (
    <div className="container-page py-8">
      <div className="card mb-8 flex items-center gap-5 p-6">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand text-2xl font-bold text-white">{initials(u.name)}</span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{u.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={u.accountType === 'BUSINESS' ? 'brand' : 'gray'}>{t(`enums.accountType.${u.accountType}`)}</Badge>
            <span>{t('listing.memberSince', { date: formatDate(u.memberSince, locale, { month: 'long', year: 'numeric' }) })}</span>
            <span>· {t('listing.activeListings', { n: u.activeListings })}</span>
            {u.rating != null && (
              <span className="flex items-center gap-1">
                · <StarIcon size={14} className="text-vip" /> {u.rating.toFixed(1)} ({u.reviewsCount})
              </span>
            )}
          </div>
          {u.agency && (
            <Link href={`/${locale}/agencies/${u.agency.slug}`} className="mt-2 inline-block text-sm font-semibold text-brand hover:underline">
              {u.agency.name} →
            </Link>
          )}
        </div>
      </div>
      <OwnerListings ownerId={u.id} />
    </div>
  );
}
