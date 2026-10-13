'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, toSearchParams, type Query } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { parseSearchState } from '@/lib/search-state';
import { PageHeader } from '@/components/account/PageHeader';
import { useSearchTitle } from '@/components/search/SaveSearchButton';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { BellIcon, BookmarkIcon, SearchIcon, TrashIcon } from '@/components/ui/icons';

export default function SavedSearchesPage() {
  const { t, href, date } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const describe = useSearchTitle();
  const q = useQuery({ queryKey: qk.savedSearches, queryFn: api.savedSearches.list });
  const del = useMutation({
    mutationFn: api.savedSearches.remove,
    onSuccess: () => {
      toast.success(t('savedSearches.deleted'));
      void qc.invalidateQueries({ queryKey: qk.savedSearches });
    },
  });
  return (
    <div>
      <PageHeader title={t('account.nav.savedSearches')} sub={t('savedSearches.sub')} />
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('savedSearches.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.length ? (
        <EmptyState icon={<BookmarkIcon />} title={t('savedSearches.empty')} text={t('savedSearches.emptyText')} action={<LinkButton href={href('/search')}>{t('savedSearches.goSearch')}</LinkButton>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((s) => {
            const qs = toSearchParams(s.query as Query).toString();
            return (
              <li key={s.id} className="card flex flex-wrap items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
                  <SearchIcon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`${href('/search')}?${qs}`} className="font-semibold hover:text-brand">
                    {s.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    {describe(parseSearchState(new URLSearchParams(qs)))} · {date(s.createdAt)}
                  </div>
                </div>
                {s.notify && <Badge tone="brand" icon={<BellIcon size={11} />}>{t('savedSearches.notifyOn')}</Badge>}
                {s.newMatches > 0 && <Badge tone="urgent">{t('savedSearches.newMatches', { n: s.newMatches })}</Badge>}
                <LinkButton size="sm" variant="secondary" href={`${href('/search')}?${qs}`}>
                  {t('savedSearches.open')}
                </LinkButton>
                <Button size="sm" variant="ghost" aria-label={t('common.delete')} loading={del.isPending && del.variables === s.id} onClick={() => del.mutate(s.id)}>
                  <TrashIcon size={16} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
