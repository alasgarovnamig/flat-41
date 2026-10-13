import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Flag, Search } from 'lucide-react';
import { DEAL_TYPES, LISTING_STATUSES, type AdminListing } from '@evtap/shared';
import * as api from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Checkbox, FormField, Input, Select } from '../components/FormField';
import { PromoBadges, Thumb, listingPrice } from '../components/listing';
import { Badge, StatusBadge } from '../components/StatusBadge';
import { FilterBar, PageHeader } from '../components/ui';
import { useT } from '../i18n';
import { cityName, enumLabel, fmtDate, fmtNumber, shortId } from '../lib/format';
import { useDebounced, useUrlFilters } from '../lib/hooks';

const PAGE_SIZE = 20;

export default function ListingsPage() {
  const { t } = useT();
  const nav = useNavigate();
  const [f, setF] = useUrlFilters({ status: '', dealType: '', q: '', reported: '', ownerId: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = {
    page: Number(f.page) || 1,
    pageSize: PAGE_SIZE,
    status: f.status || undefined,
    dealType: f.dealType || undefined,
    q: f.q || undefined,
    reported: f.reported === '1' ? true : undefined,
    ownerId: f.ownerId || undefined,
  };
  const list = useQuery({ queryKey: ['admin', 'listings', query], queryFn: () => api.listAdminListings(query), placeholderData: keepPreviousData });

  const columns: Column<AdminListing>[] = [
    {
      key: 'title',
      header: t('Listing'),
      sortValue: (l) => l.title,
      render: (l) => (
        <div className="flex min-w-[240px] items-center gap-3">
          <Thumb url={l.coverUrl} className="h-10 w-14" />
          <div className="min-w-0">
            <Link to={`/listings/${l.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[300px] truncate font-medium hover:underline">
              {l.title}
            </Link>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              #{shortId(l.id)} <PromoBadges l={l} />
            </div>
          </div>
        </div>
      ),
    },
    { key: 'price', header: t('Price'), align: 'right', sortValue: (l) => l.price, render: (l) => <span className="whitespace-nowrap">{listingPrice(l)}</span> },
    { key: 'deal', header: t('Deal'), hideBelow: '2xl', render: (l) => <span className="whitespace-nowrap">{enumLabel(l.dealType)}</span> },
    { key: 'city', header: t('City'), hideBelow: 'xl', sortValue: (l) => cityName(l.cityId), render: (l) => cityName(l.cityId) },
    {
      key: 'owner',
      header: t('Owner'),
      hideBelow: 'md',
      sortValue: (l) => l.ownerName,
      render: (l) => (
        <Link to={`/users/${l.ownerId}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap hover:underline">
          {l.ownerName}
        </Link>
      ),
    },
    { key: 'status', header: t('Status'), sortValue: (l) => l.status, render: (l) => <StatusBadge status={l.status} /> },
    {
      key: 'reports',
      header: <Flag className="size-3.5" aria-label={t('Reports')} />,
      align: 'center',
      sortValue: (l) => l.reportsCount,
      render: (l) => (l.reportsCount ? <Badge tone="danger">{l.reportsCount}</Badge> : <span className="text-muted">0</span>),
    },
    { key: 'views', header: t('Views'), align: 'right', hideBelow: '2xl', sortValue: (l) => l.views, render: (l) => fmtNumber(l.views) },
    { key: 'created', header: t('Created'), hideBelow: 'xl', sortValue: (l) => l.createdAt, render: (l) => <span className="whitespace-nowrap">{fmtDate(l.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title={t('Listings')} subtitle={list.data ? t('{n} listings match', { n: fmtNumber(list.data.total) }) : undefined} />
      <FilterBar>
        <FormField label={t('Search')} className="w-full sm:w-64">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Title, ID, owner…')} className="pl-8" />
          </div>
        </FormField>
        <FormField label={t('Status')} className="w-40">
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('All')} options={LISTING_STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))} />
        </FormField>
        <FormField label={t('Deal type')} className="w-40">
          <Select value={f.dealType} onChange={(e) => setF({ dealType: e.target.value })} placeholder={t('All')} options={DEAL_TYPES.map((s) => ({ value: s, label: enumLabel(s) }))} />
        </FormField>
        <div className="flex h-9 items-center">
          <Checkbox checked={f.reported === '1'} onChange={(v) => setF({ reported: v ? '1' : '' })} label={t('Reported only')} />
        </div>
        {f.ownerId && (
          <button onClick={() => setF({ ownerId: '' })} className="h-9 rounded-lg bg-brand-soft px-3 text-xs text-brand-fg">
            {t('Owner')}: #{shortId(f.ownerId)} ✕
          </button>
        )}
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(l) => l.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(l) => nav(`/listings/${l.id}`)}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
    </div>
  );
}
