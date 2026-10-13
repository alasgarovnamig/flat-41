'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatPrice, sendMessageSchema, type Conversation, type Message } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { getSocket } from '@/lib/realtime';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, PageSpinner, Skeleton } from '@/components/ui/feedback';
import { ChatIcon, ChevronLeft, SendIcon } from '@/components/ui/icons';
import { Img } from '@/components/ui/Img';

/** true while the socket.io connection is up; when false we fall back to polling. */
function useSocketConnected() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    setConnected(s.connected);
    s.on('connect', on);
    s.on('disconnect', off);
    s.on('connect_error', off);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
      s.off('connect_error', off);
    };
  }, []);
  return connected;
}

function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const src = assetUrl(url);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand" style={{ width: size, height: size }}>
      {initials(name)}
    </span>
  );
}

function ConversationList({ items, active, onOpen }: { items: Conversation[]; active: string | null; onOpen: (id: string) => void }) {
  const { t, relative } = useI18n();
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onOpen(c.id)} className={cn('flex w-full gap-3 px-3 py-3 text-left hover:bg-surface', active === c.id && 'bg-brand-50')}>
            <div className="relative">
              <Avatar name={c.otherUser.name} url={c.otherUser.avatarUrl} size={44} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{c.otherUser.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{relative(c.lastMessage?.createdAt ?? c.updatedAt)}</span>
              </div>
              <div className="truncate text-xs text-muted">{c.listing.title}</div>
              <div className="flex items-center justify-between gap-2">
                <span className={cn('truncate text-sm', c.unreadCount ? 'font-semibold text-ink' : 'text-ink/70')}>{c.lastMessage?.body ?? t('messages.noMessages')}</span>
                {c.unreadCount > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{c.unreadCount}</span>}
              </div>
            </div>
          </button>
        </li>
      ))}
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
  const bottom = useRef<HTMLDivElement>(null);
  const messages = [...older, ...(q.data ?? [])];
  const lastId = q.data?.[q.data.length - 1]?.id;

  useEffect(() => {
    setOlder([]);
    setNoMore(false);
  }, [conv.id]);
  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);
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
      <div className="flex items-center gap-3 border-b border-line p-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1.5 hover:bg-ink/5 md:hidden" aria-label={t('common.back')}>
          <ChevronLeft />
        </button>
        <Avatar name={conv.otherUser.name} url={conv.otherUser.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{conv.otherUser.name}</div>
          <Link href={href(`/listings/${conv.listing.id}`)} className="flex items-center gap-2 truncate text-xs text-muted hover:text-brand">
            {conv.listing.title} · <b>{formatPrice(conv.listing.price, conv.listing.currency)}</b>
          </Link>
        </div>
        <Link href={href(`/listings/${conv.listing.id}`)} className="relative hidden h-12 w-16 shrink-0 overflow-hidden rounded-lg sm:block">
          <Img src={conv.listing.coverUrl} alt="" fill sizes="64px" className="object-cover" />
        </Link>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-surface p-4">
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
          </div>
        ) : q.isError ? (
          <ErrorState title={t('messages.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
        ) : (
          <>
            {messages.length >= 50 && !noMore && (
              <div className="text-center">
                <Button size="sm" variant="ghost" loading={loadOlder.isPending} onClick={() => loadOlder.mutate()}>
                  {t('messages.loadOlder')}
                </Button>
              </div>
            )}
            {messages.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm', mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-white')}>
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                    <div className={cn('mt-0.5 text-right text-[10px]', mine ? 'text-white/70' : 'text-muted')}>
                      {dateTime(m.createdAt)}
                      {mine && (m.readAt ? ' ✓✓' : ' ✓')}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
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
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line px-3.5 py-2.5 text-[15px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        <Button type="submit" size="icon" disabled={!text.trim()} loading={send.isPending} aria-label={t('common.send')}>
          <SendIcon size={18} />
        </Button>
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
  const live = useSocketConnected();
  const list = useQuery({ queryKey: qk.conversations, queryFn: () => api.conversations.list({ page: 1, pageSize: 50 }), refetchInterval: live ? 60_000 : 15_000 });
  const open = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });
  const conv = list.data?.items.find((c) => c.id === active) ?? null;

  if (list.isLoading) return <PageSpinner />;
  if (list.isError) return <ErrorState title={t('messages.loadError')} text={errorMessage(list.error, t)} onRetry={() => void list.refetch()} retryLabel={t('common.retry')} />;
  if (!list.data?.items.length) return <EmptyState icon={<ChatIcon />} title={t('messages.empty')} text={t('messages.emptyText')} action={<Button onClick={() => router.push(href('/search'))}>{t('favorites.browse')}</Button>} />;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t('account.nav.messages')}</h1>
      <div className="card grid h-[calc(100dvh-12rem)] min-h-[480px] overflow-hidden md:grid-cols-[320px_1fr]">
        <div className={cn('min-h-0 overflow-y-auto border-r border-line', conv && 'hidden md:block')}>
          <ConversationList items={list.data.items} active={active} onOpen={open} />
        </div>
        <div className={cn('min-h-0', !conv && 'hidden md:block')}>
          {conv ? (
            <Thread conv={conv} onBack={() => open(null)} live={live} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">{t('messages.select')}</div>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{live ? t('messages.live') : t('messages.polling')}</p>
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
