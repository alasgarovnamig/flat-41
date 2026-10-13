import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { formatPhone, type Agency } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, Input, Select, Toggle } from '../components/FormField';
import { Badge } from '../components/StatusBadge';
import { Avatar, FilterBar, PageHeader } from '../components/ui';
import { WEB_URL } from '../env';
import { useT } from '../i18n';
import { cityName, enumLabel, fmtDate, fmtNumber } from '../lib/format';
import { useDebounced, useUrlFilters } from '../lib/hooks';

export default function AgenciesPage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ q: '', verified: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = { q: f.q || undefined, verified: f.verified === '' ? undefined : f.verified === 'true', page: Number(f.page) || 1, pageSize: 20 };
  const list = useQuery({ queryKey: ['admin', 'agencies', query], queryFn: () => api.listAdminAgencies(query), placeholderData: keepPreviousData });
  const verify = useAction((v: { id: string; verified: boolean }) => api.updateAdminAgency(v.id, v.verified), {
    success: (a) => (a.verified ? t('{name} verified', { name: a.name }) : t('{name} unverified', { name: a.name })),
    invalidate: [['admin', 'agencies']],
  });

  const columns: Column<Agency>[] = [
    {
      key: 'name',
      header: t('Agency'),
      sortValue: (a) => a.name,
      render: (a) => (
        <div className="flex min-w-[200px] items-center gap-2.5">
          <Avatar name={a.name} url={a.logoUrl} />
          <div className="min-w-0">
            <a href={`${WEB_URL}/az/agencies/${a.slug}`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium hover:underline">
              {a.name}
            </a>
            <p className="truncate text-xs text-muted">/{a.slug}</p>
          </div>
        </div>
      ),
    },
    { key: 'type', header: t('Type'), sortValue: (a) => a.type, render: (a) => <Badge tone={a.type === 'DEVELOPER' ? 'violet' : 'brand'}>{enumLabel(a.type)}</Badge> },
    {
      key: 'contact',
      header: t('Contact'),
      hideBelow: 'xl',
      render: (a) => <span className="text-xs">{[a.phone && formatPhone(a.phone), a.email].filter(Boolean).join(' · ') || '—'}</span>,
    },
    { key: 'city', header: t('City'), hideBelow: 'md', render: (a) => cityName(a.cityId) },
    { key: 'listings', header: t('Active listings'), align: 'right', sortValue: (a) => a.activeListings, render: (a) => fmtNumber(a.activeListings) },
    { key: 'created', header: t('Created'), hideBelow: 'xl', sortValue: (a) => a.createdAt, render: (a) => fmtDate(a.createdAt) },
    {
      key: 'verified',
      header: t('Verified'),
      sortValue: (a) => (a.verified ? 1 : 0),
      render: (a) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Toggle checked={a.verified} disabled={verify.isPending && verify.variables?.id === a.id} onChange={(v) => verify.mutate({ id: a.id, verified: v })} />
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('Agencies')} subtitle={t('Agencies & developers. Verified ones get a badge on the site.')} />
      <FilterBar>
        <FormField label={t('Search')} className="w-full sm:w-64">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name…')} className="pl-8" />
          </div>
        </FormField>
        <FormField label={t('Verified')} className="w-36">
          <Select
            value={f.verified}
            onChange={(e) => setF({ verified: e.target.value })}
            placeholder={t('All')}
            options={[
              { value: 'true', label: t('Verified') },
              { value: 'false', label: t('Not verified') },
            ]}
          />
        </FormField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(a) => a.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
    </div>
  );
}
