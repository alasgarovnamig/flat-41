'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { SavedSearch } from '@evtap/shared';
import { api, toSearchParams, type Query } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { parseSearchState } from '@/lib/search-state';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Input, LinkButton, Modal, PageHeader, Skeleton, Toggle } from '@/components/ds';
import { ArrowUpRightIcon, BookmarkIcon, EditIcon, SearchIcon, TrashIcon } from '@/components/ds/icons';
import { useSearchTitle } from '@/components/search/SaveSearchButton';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

function SavedSearchCard({ s }: { s: SavedSearch }) {
  const { t, href, date } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const describe = useSearchTitle();
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(s.name);
  const qs = toSearchParams(s.query as Query).toString();
  const link = `${href('/search')}?${qs}`;

  // PATCH /saved-searches/:id — optimistic notify toggle / rename
  const update = useMutation({
    mutationFn: (b: { name?: string; notify?: boolean }) => api.savedSearches.update(s.id, b),
    onMutate: async (b) => {
      await qc.cancelQueries({ queryKey: qk.savedSearches });
      const prev = qc.getQueryData<SavedSearch[]>(qk.savedSearches);
      qc.setQueryData<SavedSearch[]>(qk.savedSearches, (l) => l?.map((x) => (x.id === s.id ? { ...x, ...b } : x)));
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(qk.savedSearches, ctx.prev),
    onSuccess: (_r, b) => {
      if (b.name !== undefined) {
        setRename(false);
        toast.success(t('savedSearches.renamed'));
      }
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.savedSearches }),
  });
  const del = useMutation({
    mutationFn: () => api.savedSearches.remove(s.id),
    onSuccess: () => {
      toast.success(t('savedSearches.deleted'));
      void qc.invalidateQueries({ queryKey: qk.savedSearches });
    },
  });

  return (
    <li>
      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
            <SearchIcon size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={link} className="truncate text-[16px] font-medium hover:underline">
                {s.name}
              </Link>
              {s.newMatches > 0 && <Badge tone="accent">{t('savedSearches.newMatches', { n: s.newMatches })}</Badge>}
            </div>
            <div className="truncate text-caption text-muted">
              {describe(parseSearchState(new URLSearchParams(qs)))} · {date(s.createdAt)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Toggle checked={s.notify} onChange={(v) => update.mutate({ notify: v })} label={t('savedSearches.notify')} className="mr-2" />
          <IconButton label={t('savedSearches.rename')} variant="raised" onClick={() => { setName(s.name); setRename(true); }}>
            <EditIcon size={18} />
          </IconButton>
          <IconButton label={t('common.delete')} variant="raised" disabled={del.isPending} onClick={() => del.mutate()}>
            <TrashIcon size={18} />
          </IconButton>
          <LinkButton href={link} trailing={<ArrowUpRightIcon size={16} />}>
            {t('savedSearches.open')}
          </LinkButton>
        </div>
      </Card>
      <Modal
        open={rename}
        onClose={() => setRename(false)}
        size="sm"
        title={t('savedSearches.rename')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRename(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={update.isPending} disabled={!name.trim()} onClick={() => update.mutate({ name: name.trim() })}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Input label={t('search.saveSearchName')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Modal>
    </li>
  );
}

export default function SavedSearchesPage() {
  const { t, href } = useI18n();
  const q = useQuery({ queryKey: qk.savedSearches, queryFn: api.savedSearches.list });
  return (
    <div>
      <PageHeader title={t('account.nav.savedSearches')} sub={t('savedSearches.sub')} />
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('savedSearches.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.length ? (
        <EmptyState icon={<BookmarkIcon />} title={t('savedSearches.empty')} text={t('savedSearches.emptyText')} action={<LinkButton href={href('/search')} icon={<SearchIcon size={18} />}>{t('savedSearches.goSearch')}</LinkButton>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((s) => (
            <SavedSearchCard key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
