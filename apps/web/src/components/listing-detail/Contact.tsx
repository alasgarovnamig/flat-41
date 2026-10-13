'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatPhone, startConversationSchema, type ListingDetail } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { issueMessage } from '@/lib/errors';
import { initials } from '@/lib/utils';
import { useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { ChatIcon, PhoneIcon, ShieldCheckIcon, StarIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';

export function usePhoneReveal(id: string) {
  const [phone, setPhone] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api.listings.phone(id), onSuccess: (r) => setPhone(r.phone) });
  return { phone, reveal: () => m.mutate(), loading: m.isPending };
}

export function MessageModal({ listing, open, onClose }: { listing: Pick<ListingDetail, 'id' | 'title'>; open: boolean; onClose: () => void }) {
  const { t, href } = useI18n();
  const router = useRouter();
  const [text, setText] = useState(() => t('listing.messageTemplate'));
  const [error, setError] = useState<string>();
  const send = useMutation({
    mutationFn: () => api.conversations.start({ listingId: listing.id, message: text.trim() }),
    onSuccess: (c) => router.push(`${href('/account/messages')}?c=${c.id}`),
  });
  const submit = () => {
    const r = startConversationSchema.safeParse({ listingId: listing.id, message: text });
    if (!r.success) {
      setError(issueMessage(r.error.issues.find((i) => i.path[0] === 'message') ?? r.error.issues[0]!, t));
      return;
    }
    setError(undefined);
    send.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('listing.writeMessage')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={send.isPending} onClick={submit} icon={<ChatIcon size={18} />}>
            {t('common.send')}
          </Button>
        </>
      }
    >
      <p className="mb-3 line-clamp-2 text-sm text-muted">{listing.title}</p>
      <Textarea label={t('listing.yourMessage')} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} error={error} />
    </Modal>
  );
}

export function ContactCard({ l }: { l: ListingDetail }) {
  const { t, href, date } = useI18n();
  const gate = useAuthGate();
  const { phone, reveal, loading } = usePhoneReveal(l.id);
  const [msg, setMsg] = useState(false);
  const agency = l.agency;
  const avatar = assetUrl(agency?.logoUrl ?? l.owner.avatarUrl);
  const profileHref = agency ? href(`/agencies/${agency.slug}`) : href(`/users/${l.owner.id}`);
  return (
    <div className="card p-5">
      <Link href={profileHref} className="flex items-center gap-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-12 w-12 rounded-full border border-line object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{initials(agency?.name ?? l.contactName)}</span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-semibold">
            {agency?.name ?? l.contactName}
            {agency?.verified && <ShieldCheckIcon size={16} className="shrink-0 text-brand" />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {agency ? <Badge tone="brand">{t(`enums.agencyType.${agency.type}`)}</Badge> : <Badge tone="gray">{t('listing.owner')}</Badge>}
            {l.owner.rating != null && (
              <span className="flex items-center gap-0.5">
                <StarIcon size={12} className="text-vip" /> {l.owner.rating.toFixed(1)} ({l.owner.reviewsCount})
              </span>
            )}
          </div>
        </div>
      </Link>
      {agency && <div className="mt-2 text-xs text-muted">{t('listing.contactPerson')}: {l.contactName}</div>}
      <div className="mt-1 text-xs text-muted">
        {t('listing.memberSince', { date: date(l.owner.memberSince, { month: 'long', year: 'numeric' }) })} · {t('listing.activeListings', { n: l.owner.activeListings })}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {phone ? (
          <a href={`tel:${phone}`} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand text-lg font-bold text-white hover:bg-brand-dark">
            <PhoneIcon size={18} /> {formatPhone(phone)}
          </a>
        ) : (
          <Button size="lg" loading={loading} onClick={reveal} icon={<PhoneIcon size={18} />}>
            <span className="flex flex-col items-start leading-tight">
              <span>{l.contactPhoneMasked}</span>
              <span className="text-[11px] font-medium opacity-80">{t('listing.showPhone')}</span>
            </span>
          </Button>
        )}
        {!l.isOwner && (
          <Button size="lg" variant="outline" icon={<ChatIcon size={18} />} onClick={() => gate(() => setMsg(true))}>
            {t('listing.writeMessage')}
          </Button>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-muted">{t('listing.safetyTip')}</p>
      <MessageModal listing={l} open={msg} onClose={() => setMsg(false)} />
    </div>
  );
}
