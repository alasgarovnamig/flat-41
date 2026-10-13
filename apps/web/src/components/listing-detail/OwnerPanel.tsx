'use client';

import type { ListingDetail } from '@evtap/shared';
import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { Alert, Badge } from '@/components/ui/feedback';
import { ArrowUpIcon, CalendarIcon, ChartIcon, SettingsIcon } from '@/components/ui/icons';

export function OwnerPanel({ l }: { l: ListingDetail }) {
  const { t, href, date } = useI18n();
  return (
    <div className="card border-brand/30 bg-brand-50/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t('owner.title')}</h3>
        <Badge tone={l.status === 'ACTIVE' ? 'green' : l.status === 'REJECTED' || l.status === 'BLOCKED' ? 'urgent' : 'gray'}>{t(`enums.listingStatus.${l.status}`)}</Badge>
      </div>
      {l.status === 'PENDING' && <Alert tone="info" className="mt-3">{t('owner.pending')}</Alert>}
      {l.status === 'DRAFT' && <Alert tone="warning" className="mt-3">{t('owner.draft')}</Alert>}
      {l.status === 'REJECTED' && (
        <Alert tone="error" className="mt-3">
          {t('owner.rejected')}: {l.rejectionReason ?? '—'}
        </Alert>
      )}
      {l.expiresAt && l.status === 'ACTIVE' && <p className="mt-2 text-xs text-muted">{t('owner.expires', { date: date(l.expiresAt) })}</p>}
      {l.promotions.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {l.promotions.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span className="font-medium">{t(`enums.promotionType.${p.type}`)}</span>
              <span className="text-muted">{p.endsAt ? t('owner.until', { date: date(p.endsAt) }) : p.bumpsLeft != null ? t('owner.bumpsLeft', { n: p.bumpsLeft }) : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {l.status === 'DRAFT' ? (
          <LinkButton href={href(`/listings/${l.id}/pay`)} variant="vip" className="col-span-2">
            {t('owner.payFee')}
          </LinkButton>
        ) : (
          <LinkButton href={href(`/listings/${l.id}/promote`)} variant="premium" className="col-span-2" icon={<ArrowUpIcon size={18} />}>
            {t('owner.promote')}
          </LinkButton>
        )}
        <LinkButton href={href(`/listings/${l.id}/edit`)} variant="outline" icon={<SettingsIcon size={16} />}>
          {t('common.edit')}
        </LinkButton>
        <LinkButton href={href(`/listings/${l.id}/stats`)} variant="outline" icon={<ChartIcon size={16} />}>
          {t('owner.stats')}
        </LinkButton>
        {l.dealType === 'RENT_DAILY' && (
          <LinkButton href={href(`/account/calendar?listing=${l.id}`)} variant="outline" className="col-span-2" icon={<CalendarIcon size={16} />}>
            {t('owner.calendar')}
          </LinkButton>
        )}
      </div>
    </div>
  );
}
