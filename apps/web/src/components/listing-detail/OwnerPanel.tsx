'use client';

import type { ListingDetail } from '@evtap/shared';
import { Card, CardHeader, LinkButton, Notice, StatusPill } from '@/components/ds';
import { ArrowUpIcon, CalendarIcon, ChartIcon, EditIcon, WalletIcon } from '@/components/ds/icons';
import { listingStatusTone } from '@/lib/status';
import { useI18n } from '@/components/providers/I18nProvider';

export function OwnerPanel({ l }: { l: ListingDetail }) {
  const { t, href, date } = useI18n();
  return (
    <Card tone="ink" aria-labelledby="owner-h">
      <CardHeader id="owner-h" title={<span className="text-on-ink">{t('owner.title')}</span>} action={<StatusPill tone={listingStatusTone(l.status)}>{t(`enums.listingStatus.${l.status}`)}</StatusPill>} />
      {l.status === 'PENDING' && <Notice tone="info">{t('owner.pending')}</Notice>}
      {l.status === 'DRAFT' && <Notice tone="warning">{t('owner.draft')}</Notice>}
      {l.status === 'REJECTED' && (
        <Notice tone="error">
          {t('owner.rejected')}: {l.rejectionReason ?? '—'}
        </Notice>
      )}
      {l.expiresAt && l.status === 'ACTIVE' && <p className="text-caption opacity-70">{t('owner.expires', { date: date(l.expiresAt) })}</p>}
      {l.promotions.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-label">
          {l.promotions.map((p) => (
            <li key={p.id} className="flex justify-between gap-2 rounded-md bg-on-ink/10 px-3 py-2">
              <span className="font-medium">{t(`enums.promotionType.${p.type}`)}</span>
              <span className="opacity-70">{p.endsAt ? t('owner.until', { date: date(p.endsAt) }) : p.bumpsLeft != null ? t('owner.bumpsLeft', { n: p.bumpsLeft }) : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {l.status === 'DRAFT' ? (
          <LinkButton href={href(`/listings/${l.id}/pay`)} variant="accent" className="col-span-2" icon={<WalletIcon size={18} />}>
            {t('owner.payFee')}
          </LinkButton>
        ) : (
          <LinkButton href={href(`/listings/${l.id}/promote`)} variant="accent" className="col-span-2" icon={<ArrowUpIcon size={18} />}>
            {t('owner.promote')}
          </LinkButton>
        )}
        <LinkButton href={href(`/listings/${l.id}/edit`)} variant="glass" icon={<EditIcon size={16} />}>
          {t('common.edit')}
        </LinkButton>
        <LinkButton href={href(`/listings/${l.id}/stats`)} variant="glass" icon={<ChartIcon size={16} />}>
          {t('owner.stats')}
        </LinkButton>
        {l.dealType === 'RENT_DAILY' && (
          <LinkButton href={href(`/account/calendar?listing=${l.id}`)} variant="glass" className="col-span-2" icon={<CalendarIcon size={16} />}>
            {t('owner.calendar')}
          </LinkButton>
        )}
      </div>
    </Card>
  );
}
