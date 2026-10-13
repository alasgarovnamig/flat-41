import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatPhone, formatPrice, mortgageMonthly, type MortgageLead, type MortgageLeadStatus } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { DataTable, type Column } from '../components/DataTable';
import { Select } from '../components/FormField';
import { PageHeader, Tabs } from '../components/ui';
import { useT } from '../i18n';
import { enumLabel, fmtDateTime, fmtNumber, shortId } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

const STATUSES: MortgageLeadStatus[] = ['NEW', 'SENT_TO_BANK', 'CLOSED'];

export default function MortgagePage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ status: 'NEW', page: '1' });
  const query = { status: (f.status === 'ALL' ? undefined : f.status) as MortgageLeadStatus | undefined, page: Number(f.page) || 1, pageSize: 20 };
  const list = useQuery({ queryKey: ['admin', 'mortgage-leads', query], queryFn: () => api.listMortgageLeads(query), placeholderData: keepPreviousData });
  const update = useAction((v: { id: string; status: MortgageLeadStatus }) => api.updateMortgageLead(v.id, v.status), {
    success: (l) => t('Lead marked as {s}', { s: enumLabel(l.status) }),
    invalidate: [['admin', 'mortgage-leads']],
  });

  // MortgageLead.price/downPayment come from the calculator over listing prices → treated as MAJOR units (AZN)
  const columns: Column<MortgageLead>[] = [
    { key: 'date', header: t('Received'), sortValue: (l) => l.createdAt, render: (l) => <span className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</span> },
    {
      key: 'name',
      header: t('Applicant'),
      sortValue: (l) => l.name,
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="font-medium">{l.name}</p>
          <a href={`tel:${l.phone}`} className="text-xs text-muted hover:underline">
            {formatPhone(l.phone)}
          </a>
        </div>
      ),
    },
    { key: 'price', header: t('Property price'), align: 'right', sortValue: (l) => l.price, render: (l) => formatPrice(l.price, 'AZN') },
    { key: 'down', header: t('Down payment'), align: 'right', hideBelow: 'xl', sortValue: (l) => l.downPayment, render: (l) => <span>{formatPrice(l.downPayment, 'AZN')} <span className="text-xs text-muted">({l.price ? Math.round((l.downPayment / l.price) * 100) : 0}%)</span></span> },
    { key: 'term', header: t('Term'), align: 'right', hideBelow: 'xl', sortValue: (l) => l.termYears, render: (l) => t('{n} yrs', { n: l.termYears }) },
    {
      key: 'monthly',
      header: t('≈ Monthly'),
      align: 'right',
      hideBelow: '2xl',
      render: (l) => <span className="text-muted">{formatPrice(mortgageMonthly(l.price - l.downPayment, 8, l.termYears), 'AZN')}</span>,
    },
    { key: 'bank', header: t('Bank'), hideBelow: '2xl', render: (l) => l.bankCode ?? <span className="text-muted">{t('Any')}</span> },
    { key: 'listing', header: t('Listing'), hideBelow: 'lg', render: (l) => (l.listingId ? <Link to={`/listings/${l.listingId}`} className="hover:underline">#{shortId(l.listingId)}</Link> : '—') },
    {
      key: 'status',
      header: t('Status'),
      render: (l) => (
        <Select
          aria-label={t('Status')}
          className="min-w-36"
          value={l.status}
          disabled={update.isPending && update.variables?.id === l.id}
          onChange={(e) => update.mutate({ id: l.id, status: e.target.value as MortgageLeadStatus })}
          options={STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('Mortgage leads')}
        subtitle={list.data ? t('{n} leads · ≈ monthly payment shown at an indicative 8% rate', { n: fmtNumber(list.data.total) }) : t('Applications from the mortgage calculator')}
        actions={<Tabs value={f.status} onChange={(v) => setF({ status: v })} tabs={[...STATUSES.map((s) => ({ value: s, label: enumLabel(s) })), { value: 'ALL', label: t('All') }]} />}
      />
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(l) => l.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
    </div>
  );
}
