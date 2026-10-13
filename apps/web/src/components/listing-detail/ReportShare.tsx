'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { REPORT_REASONS, type ReportReason } from '@evtap/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, IconButton, Modal, Textarea } from '@/components/ds';
import { CheckIcon, FlagIcon, ShareIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

export function ShareButton({ title, url }: { title: string; url?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const share = async () => {
    const link = url ?? window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url: link });
        return;
      } catch {
        /* cancelled → fall back to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('common.linkCopied'));
    } catch {
      toast.error(t('errors.generic'));
    }
  };
  return (
    <IconButton label={t('common.share')} variant="raised" onClick={() => void share()}>
      <ShareIcon size={19} />
    </IconButton>
  );
}

export function ReportButton({ listingId }: { listingId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => api.listings.report(listingId, { reason: reason!, comment: comment.trim() || undefined }),
    onSuccess: () => {
      toast.success(t('listing.reportSent'));
      setOpen(false);
      setReason(null);
      setComment('');
    },
  });
  return (
    <>
      <IconButton label={t('listing.report')} variant="raised" onClick={() => setOpen(true)}>
        <FlagIcon size={19} />
      </IconButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('listing.reportTitle')}
        sub={t('listing.reportReason')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>
              {t('listing.reportSend')}
            </Button>
          </>
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('listing.reportReason')}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className={cn('flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg px-4 text-[14px] transition-colors', reason === r ? 'bg-ink text-on-ink' : 'bg-surface-sunken hover:bg-pill')}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
              {t(`enums.reportReason.${r}`)}
              {reason === r && <CheckIcon size={16} />}
            </label>
          ))}
        </fieldset>
        <div className="mt-4">
          <Textarea label={t('listing.reportComment')} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} />
        </div>
      </Modal>
    </>
  );
}
