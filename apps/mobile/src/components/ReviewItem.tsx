import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Review } from '@evtap/shared';
import { api } from '../api/client';
import { qk } from '../api/queryClient';
import { useI18n } from '../i18n';
import { brand, spacing, useTheme } from '../theme';
import { Avatar, Button, Field, Text } from './ui';
import { useToast } from './Toast';

export const Stars = ({ value, size = 14 }: { value: number; size?: number }) => (
  <View style={{ flexDirection: 'row', gap: 1 }} accessibilityLabel={`${value}/5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Ionicons key={i} name={value >= i ? 'star' : value >= i - 0.5 ? 'star-half' : 'star-outline'} size={size} color={brand.vip} />
    ))}
  </View>
);

/** A guest review; the host (listing owner) can reply once via POST /reviews/:id/reply. */
export function ReviewItem({ review, canReply }: { review: Review; canReply?: boolean }) {
  const { c } = useTheme();
  const { t, fmtDate } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const m = useMutation({
    mutationFn: () => api.replyReview(review.id, reply.trim()),
    onSuccess: () => {
      toast.success(t('listing.replySent'));
      setOpen(false);
      qc.invalidateQueries({ queryKey: qk.reviews(review.listingId) });
    },
    onError: toast.error,
  });
  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Avatar uri={review.author.avatarUrl} name={review.author.name} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '600' }}>{review.author.name}</Text>
          <Text variant="caption" muted>
            {fmtDate(review.createdAt)}
          </Text>
        </View>
        <Stars value={review.rating} />
      </View>
      <Text>{review.comment}</Text>
      {review.hostReply ? (
        <View style={{ backgroundColor: c.surface, borderRadius: 10, padding: spacing.md, marginLeft: spacing.xl }}>
          <Text variant="label">{t('listing.hostReply')}</Text>
          <Text variant="small">{review.hostReply}</Text>
        </View>
      ) : (
        canReply &&
        (open ? (
          <View style={{ gap: spacing.sm, marginLeft: spacing.xl }}>
            <Field value={reply} onChangeText={setReply} multiline maxLength={2000} placeholder={t('listing.reply')} />
            <Button title={t('common.send')} small loading={m.isPending} disabled={!reply.trim()} onPress={() => m.mutate()} />
          </View>
        ) : (
          <Button title={t('listing.reply')} kind="ghost" small full={false} icon="return-down-forward" onPress={() => setOpen(true)} />
        ))
      )}
    </View>
  );
}
