'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sendMessageSchema, type Conversation, type Message } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useRealtimeEvent, useRealtimeStatus } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { realtime } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { Avatar, Button, Card, EmptyState, ErrorState, IconButton, Img, PageHeader, PageSpinner, Price, SearchField, Skeleton } from '@/components/ds';
import { ArrowUpRightIcon, ChatIcon, CheckCheckIcon, CheckIcon, ChevronLeft, SearchIcon, SendIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';

function ConversationList({ items, active, onOpen }: { items: Conversation[]; active: string | null; onOpen: (id: string) => void }) {
  const { t, relative } = useI18n();
  return (
    <ul className="flex flex-col gap-1 p-2">
      {items.map((c) => {
        const on = active === c.id;
        return (
          <li key={c.id}>
            <button type="button" onClick={() => onOpen(c.id)} aria-current={on ? 'true' : undefined} className={cn('flex w-full gap-3 rounded-lg p-3 text-left transition-colors', on ? 'bg-ink text-on-ink' : 'hover:bg-surface-sunken')}>
              <Avatar name={c.otherUser.name} url={c.otherUser.avatarUrl} size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{c.otherUser.name}</span>
                  <span className={cn('shrink-0 text-[11px]', on ? 'opacity-70' : 'text-muted')}>{relative(c.lastMessage?.createdAt ?? c.updatedAt)}</span>
                </span>
                <span className={cn('block truncate text-caption', on ? 'opacity-70' : 'text-muted')}>{c.listing.title}</span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className={cn('truncate text-label', c.unreadCount ? 'font-medium' : on ? 'opacity-80' : 'font-normal text-ink-secondary')}>{c.lastMessage?.body ?? t('messages.noMessages')}</span>
                  {c.unreadCount > 0 && <span className={cn('tabular rounded-pill px-1.5 text-[11px] font-semibold', on ? 'bg-on-ink text-ink' : 'bg-ink text-on-ink')}>{c.unreadCount}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thread({ conv, onBack, live }: { conv: Conversation; onBack: () => void; live: boolean }) {
  const { t, href, dateTime } = useI18n();
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const key = qk.messages(conv.id);
  const q = useQuery({ queryKey: key, queryFn: () => api.conversations.messages(conv.id, { limit: 50 }), refetchInterval: live ? false : 10_000 });
  const [older, setOlder] = useState<Message[]>([]);
  const [noMore, setNoMore] = useState(false);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = [...older, ...(q.data ?? [])];
  const lastId = q.data?.[q.data.length - 1]?.id;

  useEffect(() => {
    setOlder([]);
    setNoMore(false);
    setTyping(false);
  }, [conv.id]);
  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lastId, typing]);
  // "typing…" from the other participant (relayed by the server, ~1/s); hide after 3 s of silence
  useRealtimeEvent('typing', (e) => {
    if (e.conversationId !== conv.id || e.userId === user?.id) return;
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 3000);
  });
  useRealtimeEvent('message:new', (m) => {
    if (m.conversationId === conv.id && m.senderId !== user?.id) setTyping(false);
  });
  // mark read whenever new messages arrive in the open thread
  useEffect(() => {
    if (!lastId) return;
    api.conversations
      .read(conv.id)
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.unread });
        void qc.invalidateQueries({ queryKey: qk.conversations });
        refresh();
      })
      .catch(() => undefined);
  }, [conv.id, lastId, qc, refresh]);

  const loadOlder = useMutation({
    mutationFn: () => api.conversations.messages(conv.id, { before: messages[0]?.id, limit: 50 }),
    onSuccess: (list) => {
      if (list.length < 50) setNoMore(true);
      setOlder((o) => [...list, ...o]);
    },
  });
  const send = useMutation({
    mutationFn: (body: string) => api.conversations.send(conv.id, body),
    onSuccess: (m) => {
      qc.setQueryData<Message[]>(key, (l = []) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      void qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = sendMessageSchema.safeParse({ body: text });
    if (!r.success) return;
    setText('');
    send.mutate(r.data.body);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="glass flex items-center gap-3 rounded-t-xl border-x-0 border-t-0 p-3 md:rounded-tl-none">
        <IconButton label={t('common.back')} onClick={onBack} className="md:hidden">
          <ChevronLeft size={20} />
        </IconButton>
        <Avatar name={conv.otherUser.name} url={conv.otherUser.avatarUrl} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{conv.otherUser.name}</div>
          <div className="truncate text-caption text-muted" aria-live="polite">
            {typing ? t('messages.typing') : live ? t('messages.online') : t('messages.polling')}
          </div>
        </div>
        <Link href={href(`/listings/${conv.listing.id}`)} className="hidden max-w-[45%] items-center gap-3 rounded-pill bg-surface-raised p-1 pr-3 shadow-pill hover:bg-surface-sunken sm:flex">
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full">
            <Img src={conv.listing.coverUrl} alt="" fill sizes="40px" className="object-cover" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-caption">{conv.listing.title}</span>
            <Price l={conv.listing} className="text-label font-medium" />
          </span>
          <ArrowUpRightIcon size={16} className="shrink-0" />
        </Link>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-5" role="log" aria-label={t('account.nav.messages')}>
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 w-2/3 rounded-xl" />
            <Skeleton className="ml-auto h-11 w-1/2 rounded-xl" />
          </div>
        ) : q.isError ? (
          <ErrorState title={t('messages.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <>
            {messages.length >= 50 && !noMore && (
              <div className="text-center">
                <Button size="sm" variant="secondary" loading={loadOlder.isPending} onClick={() => loadOlder.mutate()}>
                  {t('messages.loadOlder')}
                </Button>
              </div>
            )}
            {messages.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[78%] rounded-xl px-4 py-2.5 text-[14px] leading-relaxed', mine ? 'rounded-br-sm bg-ink text-on-ink' : 'rounded-bl-sm bg-surface-raised text-ink shadow-pill')}>
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                    <div className={cn('mt-1 flex items-center justify-end gap-1 text-[10.5px]', mine ? 'opacity-60' : 'text-muted')}>
                      {dateTime(m.createdAt)}
                      {mine && (m.readAt ? <CheckCheckIcon size={13} aria-label={t('messages.read')} /> : <CheckIcon size={13} aria-label={t('messages.sent')} />)}
                    </div>
                  </div>
                </div>
              );
            })}
            {typing && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-xl rounded-bl-sm bg-surface-raised px-4 py-3 shadow-pill" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-hairline p-3">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            realtime.typing(conv.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={t('messages.placeholder')}
          aria-label={t('messages.placeholder')}
          className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-[15px] outline-none focus:border-ink focus:ring-2 focus:ring-ink/20"
        />
        <IconButton type="submit" label={t('common.send')} variant="ink" size="lg" disabled={!text.trim() || send.isPending}>
          <SendIcon size={19} />
        </IconButton>
      </form>
    </div>
  );
}

function Messages() {
  const { t, href } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const active = sp.get('c');
  const live = useRealtimeStatus() === 'open';
  const [filter, setFilter] = useState('');
  const list = useQuery({ queryKey: qk.conversations, queryFn: () => api.conversations.list({ page: 1, pageSize: 50 }), refetchInterval: live ? 60_000 : 15_000 });
  const open = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });
  const fromList = list.data?.items.find((c) => c.id === active) ?? null;
  // deep link to a thread that is not on the first page → GET /conversations/:id for the header
  const single = useQuery({ queryKey: ['conversations', 'detail', active], queryFn: () => api.conversations.get(active!), enabled: !!active && !!list.data && !fromList, retry: false });
  const conv = fromList ?? single.data ?? null;
  const items = (list.data?.items ?? []).filter((c) => !filter.trim() || `${c.otherUser.name} ${c.listing.title}`.toLowerCase().includes(filter.trim().toLowerCase()));

  if (list.isLoading) return <PageSpinner />;
  if (list.isError) return <ErrorState title={t('messages.loadError')} text={errorMessage(list.error, t)} onRetry={() => void list.refetch()} retryLabel={t('common.retry')} />;
  if (!list.data?.items.length && !conv)
    return (
      <>
        <PageHeader title={t('account.nav.messages')} />
        <EmptyState icon={<ChatIcon />} title={t('messages.empty')} text={t('messages.emptyText')} action={<Button onClick={() => router.push(href('/search'))} icon={<SearchIcon size={18} />}>{t('favorites.browse')}</Button>} />
      </>
    );

  return (
    <div>
      <PageHeader title={t('account.nav.messages')} sub={live ? t('messages.live') : t('messages.pollingNote')} />
      <Card pad="none" className="grid h-[calc(100dvh-14rem)] min-h-[520px] overflow-hidden md:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cn('flex min-h-0 flex-col border-hairline md:border-r', conv && 'hidden md:flex')}>
          <div className="p-3 pb-0">
            <SearchField value={filter} onChange={setFilter} placeholder={t('messages.filter')} label={t('messages.filter')} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConversationList items={items} active={active} onOpen={open} />
          </div>
        </div>
        <div className={cn('min-h-0 bg-surface', !conv && 'hidden md:block')}>
          {conv ? (
            <Thread conv={conv} onBack={() => open(null)} live={live} />
          ) : active && single.isLoading ? (
            <PageSpinner />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="flex h-18 w-18 items-center justify-center rounded-full bg-surface-sunken">
                <ChatIcon size={30} />
              </span>
              <p className="max-w-xs text-label text-ink-secondary">{t('messages.select')}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Messages />
    </Suspense>
  );
}
