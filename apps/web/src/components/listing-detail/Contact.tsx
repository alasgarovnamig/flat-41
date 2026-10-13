'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatPhone, startConversationSchema, type ListingDetail } from '@evtap/shared';
import { api } from '@/lib/api';
import { issueMessage } from '@/lib/errors';
import { Avatar, Badge, Button, Card, Modal, Rating, Textarea } from '@/components/ds';
import { ArrowUpRightIcon, ChatIcon, PhoneIcon, ShieldCheckIcon, VerifiedIcon } from '@/components/ds/icons';
import { useAuthGate } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

/** Reveal the phone (POST /listings/:id/phone). The owner gets `contactPhone` directly in the DTO. */
export function usePhoneReveal(id: string, known?: string | null) {
  const [phone, setPhone] = useState<string | null>(known ?? null);
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
      sub={listing.title}
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
      <Textarea label={t('listing.yourMessage')} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} error={error} data-autofocus />
    </Modal>
  );
}

/** Owner / agency card: avatar, name + verified, type + rating, member since; black phone pill + message pill. */
export function ContactCard({ l }: { l: ListingDetail }) {
  const { t, href, date } = useI18n();
  const gate = useAuthGate();
  const { phone, reveal, loading } = usePhoneReveal(l.id, l.isOwner ? l.contactPhone : null);
  const [msg, setMsg] = useState(false);
  const agency = l.agency;
  const profileHref = agency ? href(`/agencies/${agency.slug}`) : href(`/users/${l.owner.id}`);
  return (
    <Card aria-labelledby="contact-h">
      <div className="flex items-start gap-3">
        <Avatar name={agency?.name ?? l.contactName} url={agency?.logoUrl ?? l.owner.avatarUrl} size={56} square={!!agency} />
        <div className="min-w-0 flex-1">
          <h2 id="contact-h" className="flex items-center gap-1.5 truncate font-sans text-[16px] font-medium">
            {agency?.name ?? l.contactName}
            {agency?.verified && <VerifiedIcon size={17} className="shrink-0 text-success" aria-label={t('agency.verified')} />}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {agency ? <Badge tone="business">{t(`enums.agencyType.${agency.type}`)}</Badge> : <Badge tone="neutral">{t('listing.owner')}</Badge>}
            {l.owner.rating != null && <Rating value={l.owner.rating} count={l.owner.reviewsCount} />}
          </div>
        </div>
        <Link href={profileHref} aria-label={t('listing.openProfile')} title={t('listing.openProfile')} className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised shadow-pill hover:bg-ink hover:text-on-ink">
          <ArrowUpRightIcon size={18} />
        </Link>
      </div>
      <p className="mt-4 text-caption text-muted">
        {agency && (
          <>
            {t('listing.contactPerson')}: <span className="text-ink-secondary">{l.contactName}</span> ·{' '}
          </>
        )}
        {t('listing.memberSince', { date: date(l.owner.memberSince, { month: 'long', year: 'numeric' }) })} · {t('listing.activeListings', { n: l.owner.activeListings })}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {phone ? (
          <a href={`tel:${phone}`} className="press flex h-13 items-center justify-center gap-2 rounded-pill bg-ink text-[17px] font-medium tracking-[0.2px] text-on-ink hover:bg-ink-secondary">
            <PhoneIcon size={18} /> {formatPhone(phone)}
          </a>
        ) : (
          <Button size="lg" loading={loading} onClick={reveal} icon={<PhoneIcon size={18} />} className="justify-between pl-5 pr-2">
            <span className="tabular">{l.contactPhoneMasked}</span>
            <span className="ml-auto rounded-pill bg-on-ink/15 px-3 py-1.5 text-label">{t('listing.showPhone')}</span>
          </Button>
        )}
        {!l.isOwner && (
          <Button size="lg" variant="secondary" icon={<ChatIcon size={18} />} onClick={() => gate(() => setMsg(true))}>
            {t('listing.writeMessage')}
          </Button>
        )}
      </div>
      <p className="mt-4 flex gap-2 rounded-md bg-surface-sunken p-3 text-caption text-ink-secondary">
        <ShieldCheckIcon size={16} className="shrink-0" />
        {t('listing.safetyTip')}
      </p>
      <MessageModal listing={l} open={msg} onClose={() => setMsg(false)} />
    </Card>
  );
}
