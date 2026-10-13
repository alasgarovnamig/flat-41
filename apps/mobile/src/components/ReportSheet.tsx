import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { REPORT_REASONS, type ReportReason } from '@evtap/shared';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Sheet } from './Sheet';
import { Button, Chip, Field, Text } from './ui';
import { useToast } from './Toast';
import { View } from 'react-native';
import { spacing } from '../theme';

export function ReportSheet({ listingId, visible, onClose }: { listingId: string; visible: boolean; onClose: () => void }) {
  const { t, te } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () => api.reportListing(listingId, { reason: reason!, comment: comment.trim() || undefined }),
    onSuccess: () => {
      toast.success(t('report.sent'));
      setReason(null);
      setComment('');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Sheet visible={visible} onClose={onClose} title={t('report.title')}>
      <Text variant="label">{t('report.reason')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {REPORT_REASONS.map((r) => (
          <Chip key={r} label={te('reportReason', r)} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <Field label={t('report.comment')} value={comment} onChangeText={setComment} multiline maxLength={1000} />
      <Button title={t('common.send')} disabled={!reason} loading={m.isPending} onPress={() => m.mutate()} />
    </Sheet>
  );
}
