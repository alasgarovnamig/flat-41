import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { sendMessageSchema, type Conversation, type Message, type Paginated } from '@evtap/shared';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { ErrorState, Loading, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useSocket, useSocketEvent } from '@/realtime/socket';

const PAGE = 50;

export default function ChatThread() {
  const params = useLocalSearchParams<{ id: string; name?: string; listingTitle?: string; listingId?: string }>();
  const id = params.id;
  const { c } = useTheme();
  const { t, fmtRelative } = useI18n();
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const socket = useSocket();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  // Header info: params, else the cached conversation list (no GET /conversations/:id in the contract).
  const conv = useMemo(() => {
    const data = qc.getQueryData<InfiniteData<Paginated<Conversation>>>(qk.conversations);
    return data?.pages.flatMap((p) => p.items).find((x) => x.id === id);
  }, [qc, id]);
  const title = params.name ?? conv?.otherUser.name ?? '';
  const subtitle = params.listingTitle ?? conv?.listing.title;
  const listingId = params.listingId ?? conv?.listing.id;

  const q = useQuery({ queryKey: qk.messages(id), queryFn: () => api.messages(id, { limit: PAGE }), staleTime: 5_000 });
  const messages = q.data ?? [];
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const markRead = useCallback(() => {
    api
      .markRead(id)
      .then(() => {
        qc.invalidateQueries({ queryKey: qk.unread });
        qc.invalidateQueries({ queryKey: qk.conversations });
      })
      .catch(() => {});
  }, [id, qc]);

  useFocusEffect(
    useCallback(() => {
      markRead();
    }, [markRead]),
  );

  // New incoming message while this thread is open → mark as read immediately.
  useSocketEvent<Message>('message:new', (m) => {
    if (m.conversationId === id && m.senderId !== me?.id) {
      setTyping(false);
      markRead();
    }
  });
  // Typing indicator (server relays client 'typing' events to the other participant).
  useSocketEvent<{ conversationId: string; userId?: string }>('typing', (e) => {
    if (e.conversationId !== id || e.userId === me?.id) return;
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 3500);
  });
  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);

  const onChangeText = (s: string) => {
    setText(s);
    const now = Date.now();
    if (socket && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      socket.emit('typing', { conversationId: id });
    }
  };

  const older = useMutation({
    mutationFn: () => api.messages(id, { before: messages[0]?.id, limit: PAGE }),
    onSuccess: (rows) => {
      if (rows.length < PAGE) setHasOlder(false);
      qc.setQueryData<Message[]>(qk.messages(id), (old = []) => [...rows.filter((r) => !old.some((o) => o.id === r.id)), ...old]);
    },
  });

  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(id, body),
    onMutate: (body) => {
      const temp: Message = { id: `temp-${Date.now()}`, conversationId: id, senderId: me?.id ?? '', body, createdAt: new Date().toISOString(), readAt: null };
      qc.setQueryData<Message[]>(qk.messages(id), (old = []) => [...old, temp]);
      setText('');
      return { temp };
    },
    onSuccess: (msg, _b, ctx) => {
      qc.setQueryData<Message[]>(qk.messages(id), (old = []) => {
        const withoutTemp = old.filter((m) => m.id !== ctx?.temp.id);
        return withoutTemp.some((m) => m.id === msg.id) ? withoutTemp : [...withoutTemp, msg];
      });
      qc.invalidateQueries({ queryKey: qk.conversations });
    },
    onError: (e, body, ctx) => {
      qc.setQueryData<Message[]>(qk.messages(id), (old = []) => old.filter((m) => m.id !== ctx?.temp.id));
      setText(body);
      toast.error(e);
    },
  });

  const submit = () => {
    const p = sendMessageSchema.safeParse({ body: text });
    if (p.success) send.mutate(p.data.body);
  };

  const lastMineRead = useMemo(() => [...messages].reverse().find((m) => m.senderId === me?.id && m.readAt)?.id, [messages, me?.id]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              disabled={!listingId}
              onPress={() => listingId && router.push({ pathname: '/listing/[id]', params: { id: listingId } })}
              accessibilityRole="link"
              style={{ alignItems: Platform.OS === 'ios' ? 'center' : 'flex-start', maxWidth: 240 }}
            >
              <Text style={{ fontWeight: '700' }} numberOfLines={1}>
                {title}
              </Text>
              <Text variant="caption" color={typing ? c.primary : c.muted} numberOfLines={1}>
                {typing ? t('chat.typing') : subtitle}
              </Text>
            </Pressable>
          ),
        }}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={inverted}
          inverted
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.md, gap: 6, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onEndReached={() => hasOlder && messages.length >= PAGE && !older.isPending && older.mutate()}
          onEndReachedThreshold={0.2}
          ListFooterComponent={older.isPending ? <ActivityIndicator color={c.primary} /> : null}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transform: [{ scaleY: -1 }] }}>
              <Text muted>{t('chat.empty')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.senderId === me?.id;
            const pending = item.id.startsWith('temp-');
            return (
              <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                <View style={[styles.bubble, mine ? { backgroundColor: c.primary, borderBottomRightRadius: 4 } : { backgroundColor: c.surface, borderBottomLeftRadius: 4 }]}>
                  <Text color={mine ? c.onPrimary : c.text}>{item.body}</Text>
                  <View style={styles.meta}>
                    <Text variant="caption" color={mine ? '#D1FAE5' : c.muted}>
                      {fmtRelative(item.createdAt).split(', ').pop()}
                    </Text>
                    {mine && (
                      <Ionicons
                        name={pending ? 'time-outline' : item.readAt ? 'checkmark-done' : 'checkmark'}
                        size={14}
                        color={item.readAt || item.id === lastMineRead ? '#A7F3D0' : '#D1FAE5'}
                        accessibilityLabel={item.readAt ? 'read' : 'sent'}
                      />
                    )}
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={[styles.inputBar, { borderTopColor: c.border, backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={c.muted}
          multiline
          maxLength={2000}
          style={[styles.input, { backgroundColor: c.surface, color: c.text }]}
          accessibilityLabel={t('chat.placeholder')}
        />
        <Pressable
          onPress={submit}
          disabled={!text.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('common.send')}
          style={[styles.send, { backgroundColor: text.trim() ? c.primary : c.border }]}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
