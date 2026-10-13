import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startConversationSchema } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Button, Card, Field, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';

/** First message to a listing owner → POST /conversations (re-uses an existing conversation server-side). */
export default function NewChat() {
  const { listingId, title, name } = useLocalSearchParams<{ listingId: string; title?: string; name?: string }>();
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState(t('chat.firstMessage'));

  const start = useMutation({
    mutationFn: () => {
      const p = startConversationSchema.parse({ listingId, message: body });
      return api.startConversation(p.listingId, p.message);
    },
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: qk.conversations });
      router.replace({ pathname: '/chat/[id]', params: { id: conv.id, name: conv.otherUser.name, listingTitle: conv.listing.title, listingId: conv.listing.id } });
    },
    onError: toast.error,
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 4 }}>
          {!!name && <Text style={{ fontWeight: '700' }}>{name}</Text>}
          {!!title && (
            <Text muted numberOfLines={2}>
              {title}
            </Text>
          )}
        </Card>
        <Field value={body} onChangeText={setBody} multiline maxLength={2000} autoFocus placeholder={t('chat.placeholder')} />
        <Button title={t('common.send')} icon="send" disabled={!body.trim()} loading={start.isPending} onPress={() => start.mutate()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
