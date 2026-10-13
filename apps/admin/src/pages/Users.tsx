import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { USER_ROLES, USER_STATUSES, formatPhone, type AdminUser } from '@evtap/shared';
import * as api from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, Input, Select } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { Avatar, FilterBar, PageHeader } from '../components/ui';
import { useT } from '../i18n';
import { enumLabel, fmtDate, fmtNumber, fmtRelative, money } from '../lib/format';
import { useDebounced, useUrlFilters } from '../lib/hooks';

export default function UsersPage() {
  const { t } = useT();
  const nav = useNavigate();
  const [f, setF] = useUrlFilters({ q: '', role: '', status: '', accountType: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = { page: Number(f.page) || 1, pageSize: 20, q: f.q || undefined, role: f.role || undefined, status: f.status || undefined, accountType: (f.accountType || undefined) as 'INDIVIDUAL' | 'BUSINESS' | undefined };
  const list = useQuery({ queryKey: ['admin', 'users', query], queryFn: () => api.listAdminUsers(query), placeholderData: keepPreviousData });

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: t('User'),
      sortValue: (u) => u.name,
      render: (u) => (
        <div className="flex min-w-[200px] items-center gap-2.5">
          <Avatar name={u.name} url={u.avatarUrl} />
          <div className="min-w-0">
            <Link to={`/users/${u.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">
              {u.name}
            </Link>
            <p className="truncate text-xs text-muted">{[u.email, u.phone && formatPhone(u.phone)].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: t('Role'), sortValue: (u) => u.role, render: (u) => <StatusBadge status={u.role} /> },
    { key: 'type', header: t('Account'), hideBelow: 'lg', sortValue: (u) => u.accountType, render: (u) => <StatusBadge status={u.accountType} /> },
    { key: 'status', header: t('Status'), sortValue: (u) => u.status, render: (u) => <StatusBadge status={u.status} /> },
    { key: 'wallet', header: t('Wallet'), align: 'right', sortValue: (u) => u.walletBalance, render: (u) => money(u.walletBalance) },
    { key: 'listings', header: t('Listings'), align: 'right', hideBelow: 'xl', sortValue: (u) => u.activeListings, render: (u) => fmtNumber(u.activeListings) },
    { key: 'spent', header: t('Spent'), align: 'right', hideBelow: '2xl', sortValue: (u) => u.totalSpent, render: (u) => money(u.totalSpent) },
    { key: 'login', header: t('Last login'), hideBelow: '2xl', sortValue: (u) => u.lastLoginAt, render: (u) => <span className="whitespace-nowrap">{fmtRelative(u.lastLoginAt)}</span> },
    { key: 'created', header: t('Joined'), hideBelow: '2xl', sortValue: (u) => u.createdAt, render: (u) => fmtDate(u.createdAt) },
  ];

  return (
    <div>
      <PageHeader title={t('Users')} subtitle={list.data ? t('{n} users', { n: fmtNumber(list.data.total) }) : undefined} />
      <FilterBar>
        <FormField label={t('Search')} className="w-full sm:w-64">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name, email, phone…')} className="pl-8" />
          </div>
        </FormField>
        <FormField label={t('Role')} className="w-36">
          <Select value={f.role} onChange={(e) => setF({ role: e.target.value })} placeholder={t('All')} options={USER_ROLES.map((r) => ({ value: r, label: enumLabel(r) }))} />
        </FormField>
        <FormField label={t('Status')} className="w-36">
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('All')} options={USER_STATUSES.map((r) => ({ value: r, label: enumLabel(r) }))} />
        </FormField>
        <FormField label={t('Account type')} className="w-36">
          <Select value={f.accountType} onChange={(e) => setF({ accountType: e.target.value })} placeholder={t('All')} options={['INDIVIDUAL', 'BUSINESS'].map((r) => ({ value: r, label: enumLabel(r) }))} />
        </FormField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(u) => u.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(u) => nav(`/users/${u.id}`)}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
    </div>
  );
}
