'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addMemberSchema, formatPhone } from '@evtap/shared';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/config';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { initials } from '@/lib/utils';
import { PageHeader } from '@/components/account/PageHeader';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { TrashIcon, UsersIcon } from '@/components/ui/icons';

export default function MembersPage() {
  const { t, href, date } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.agencyMembers, queryFn: api.agencies.members, retry: false });
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string>();
  const add = useMutation({
    mutationFn: (l: string) => api.agencies.addMember(l),
    onSuccess: () => {
      setLogin('');
      toast.success(t('members.added'));
      void qc.invalidateQueries({ queryKey: qk.agencyMembers });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.agencies.removeMember(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.agencyMembers }),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = addMemberSchema.safeParse({ login });
    if (!r.success) return setError(zodFieldErrors(r.error.issues, t).login);
    setError(undefined);
    add.mutate(r.data.login);
  };
  return (
    <div>
      <PageHeader title={t('account.nav.members')} sub={t('members.sub')} />
      {q.isError ? (
        <ErrorState title={t('members.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <>
          <form onSubmit={submit} className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end" noValidate>
            <Input wrapperClass="flex-1" label={t('members.addLabel')} placeholder={t('members.addPlaceholder')} value={login} onChange={(e) => setLogin(e.target.value)} error={error} />
            <Button type="submit" loading={add.isPending}>{t('members.add')}</Button>
          </form>
          {q.isLoading ? (
            <Skeleton className="h-40" />
          ) : !q.data?.length ? (
            <EmptyState icon={<UsersIcon />} title={t('members.empty')} action={<LinkButton href={href('/account/agency')}>{t('account.nav.agency')}</LinkButton>} />
          ) : (
            <ul className="card divide-y divide-line">
              {q.data.map((m) => {
                const avatar = assetUrl(m.avatarUrl);
                return (
                  <li key={m.userId} className="flex flex-wrap items-center gap-3 p-4">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand">{initials(m.name)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-muted">{[m.phone && formatPhone(m.phone), m.email].filter(Boolean).join(' · ')} · {t('members.joined', { date: date(m.joinedAt) })}</div>
                    </div>
                    <Badge tone={m.role === 'OWNER' ? 'brand' : 'gray'}>{t(`enums.memberRole.${m.role}`)}</Badge>
                    <span className="text-sm text-muted">{t('listing.activeListings', { n: m.activeListings })}</span>
                    {m.role !== 'OWNER' && m.userId !== user?.id && (
                      <Button size="sm" variant="ghost" aria-label={t('common.delete')} loading={remove.isPending && remove.variables === m.userId} onClick={() => remove.mutate(m.userId)}>
                        <TrashIcon size={16} />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
