'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addMemberSchema, formatPhone, type AgencyMember } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage, zodFieldErrors } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { Avatar, Badge, Button, Card, DataTable, EmptyState, ErrorState, IconButton, Input, LinkButton, PageHeader, RowCard, type Column } from '@/components/ds';
import { BuildingIcon, PlusIcon, TrashIcon, UsersIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

export default function MembersPage() {
  const { t, href, date } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const hasAgency = !!user?.agencyId;
  const q = useQuery({ queryKey: qk.agencyMembers, queryFn: api.agencies.members, retry: false, enabled: hasAgency });
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
  const canRemove = (m: AgencyMember) => m.role !== 'OWNER' && m.userId !== user?.id;
  const removeBtn = (m: AgencyMember) =>
    canRemove(m) ? (
      <IconButton label={t('common.delete')} variant="raised" size="sm" disabled={remove.isPending && remove.variables === m.userId} onClick={() => remove.mutate(m.userId)}>
        <TrashIcon size={16} />
      </IconButton>
    ) : null;
  const columns: Column<AgencyMember>[] = [
    {
      key: 'name',
      header: t('members.member'),
      cell: (m) => (
        <span className="flex items-center gap-3">
          <Avatar name={m.name} url={m.avatarUrl} size={44} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.name}</span>
            <span className="block truncate text-caption text-muted">{[m.phone && formatPhone(m.phone), m.email].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      ),
    },
    { key: 'role', header: t('members.role'), cell: (m) => <Badge tone={m.role === 'OWNER' ? 'premium' : 'neutral'} size="md">{t(`enums.memberRole.${m.role}`)}</Badge> },
    { key: 'listings', header: t('stats.listings'), cell: (m) => <span className="tabular">{m.activeListings}</span>, minWidth: 'md' },
    { key: 'joined', header: t('members.joinedCol'), cell: (m) => date(m.joinedAt), minWidth: 'lg' },
    { key: 'action', header: <span className="sr-only">{t('common.actions')}</span>, align: 'right', cell: removeBtn },
  ];
  return (
    <div>
      <PageHeader title={t('account.nav.members')} sub={t('members.sub')} />
      {!hasAgency ? (
        <EmptyState icon={<BuildingIcon />} title={t('agency.noAgency')} text={t('agency.createIntro')} action={<LinkButton href={href('/account/agency')}>{t('agency.create')}</LinkButton>} />
      ) : q.isError ? (
        <ErrorState title={t('members.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <>
          <Card as="form" onSubmit={submit} className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
            <Input wrapperClass="flex-1" label={t('members.addLabel')} placeholder={t('members.addPlaceholder')} value={login} onChange={(e) => setLogin(e.target.value)} error={error} />
            <Button type="submit" size="lg" loading={add.isPending} icon={<PlusIcon size={18} />}>
              {t('members.add')}
            </Button>
          </Card>
          <DataTable
            caption={t('account.nav.members')}
            loading={q.isLoading}
            columns={columns}
            rows={q.data}
            rowKey={(m) => m.userId}
            empty={<EmptyState className="shadow-none" icon={<UsersIcon />} title={t('members.empty')} action={<LinkButton href={href('/account/agency')}>{t('account.nav.agency')}</LinkButton>} />}
            mobileRow={(m) => (
              <RowCard className="flex items-center gap-3">
                <Avatar name={m.name} url={m.avatarUrl} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-caption text-muted">{t(`enums.memberRole.${m.role}`)} · {t('listing.activeListings', { n: m.activeListings })}</span>
                </span>
                {removeBtn(m)}
              </RowCard>
            )}
          />
        </>
      )}
    </div>
  );
}
