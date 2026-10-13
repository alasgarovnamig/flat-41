'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { REPORT_REASONS, type ReportReason } from '@evtap/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/form';
import { FlagIcon, ShareIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';

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
    <Button variant="outline" size="md" icon={<ShareIcon size={18} />} onClick={() => void share()} aria-label={t('common.share')}>
      <span className="hidden sm:inline">{t('common.share')}</span>
    </Button>
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
      <Button variant="outline" size="md" icon={<FlagIcon size={18} />} onClick={() => setOpen(true)} aria-label={t('listing.report')}>
        <span className="hidden sm:inline">{t('listing.report')}</span>
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('listing.reportTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>
              {t('listing.reportSend')}
            </Button>
          </>
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-muted">{t('listing.reportReason')}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm hover:bg-surface has-[:checked]:border-brand has-[:checked]:bg-brand-50">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-brand" />
              {t(`enums.reportReason.${r}`)}
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
