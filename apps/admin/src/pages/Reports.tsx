import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, Check, X } from 'lucide-react';
import type { ListingReport, ReportStatus } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { DataTable, type Column } from '../components/DataTable';
import { useConfirm } from '../components/Modal';
import { BLOCK_PRESETS } from '../components/ReasonDialog';
import { Badge, StatusBadge } from '../components/StatusBadge';
import { Button, PageHeader, Tabs } from '../components/ui';
import { useT } from '../i18n';
import { enumLabel, fmtDateTime, fmtNumber, fmtRelative } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

export default function ReportsPage() {
  const { t } = useT();
  const { ask } = useConfirm();
  const [f, setF] = useUrlFilters({ status: 'OPEN', page: '1' });
  const query = { status: (f.status === 'ALL' ? undefined : f.status) as ReportStatus | undefined, page: Number(f.page) || 1, pageSize: 20 };
  const list = useQuery({ queryKey: ['admin', 'reports', query], queryFn: () => api.listReports(query), placeholderData: keepPreviousData });

  const invalidate = [['admin', 'reports'], ['admin', 'overview']];
  const update = useAction((v: { id: string; status: 'RESOLVED' | 'DISMISSED' }) => api.updateReport(v.id, v.status), {
    success: (_, v) => (v.status === 'RESOLVED' ? t('Report resolved') : t('Report dismissed')),
    invalidate,
  });
  const blockAndResolve = useAction(
    async (v: { report: ListingReport; reason: string }) => {
      await api.blockListing(v.report.listingId, v.reason);
      return api.updateReport(v.report.id, 'RESOLVED');
    },
    { success: t('Listing blocked and report resolved'), invalidate: [...invalidate, ['admin', 'listings']] },
  );

  const quickBlock = async (r: ListingReport) => {
    const reason = await ask({
      title: t('Block "{title}"?', { title: r.listingTitle }),
      message: t('The listing is hidden from the site and the owner is notified. The report will be marked resolved.'),
      confirmLabel: t('Block listing'),
      tone: 'danger',
      presets: BLOCK_PRESETS,
    });
    if (reason) blockAndResolve.mutate({ report: r, reason });
  };

  const busyId = (update.isPending && update.variables?.id) || (blockAndResolve.isPending && blockAndResolve.variables?.report.id) || null;

  const columns: Column<ListingReport>[] = [
    { key: 'date', header: t('Reported'), sortValue: (r) => r.createdAt, render: (r) => <span className="whitespace-nowrap" title={fmtDateTime(r.createdAt)}>{fmtRelative(r.createdAt)}</span> },
    {
      key: 'listing',
      header: t('Listing'),
      sortValue: (r) => r.listingTitle,
      render: (r) => (
        <Link to={`/listings/${r.listingId}`} className="block max-w-[260px] min-w-[160px] truncate font-medium hover:underline">
          {r.listingTitle}
        </Link>
      ),
    },
    { key: 'reason', header: t('Reason'), sortValue: (r) => r.reason, render: (r) => <Badge tone={r.reason === 'FRAUD' || r.reason === 'FAKE' ? 'danger' : 'warning'}>{enumLabel(r.reason)}</Badge> },
    { key: 'comment', header: t('Comment'), hideBelow: 'xl', render: (r) => <span className="line-clamp-2 max-w-[260px] text-muted">{r.comment ?? '—'}</span> },
    { key: 'reporter', header: t('Reporter'), hideBelow: '2xl', render: (r) => (r.reporter ? <Link to={`/users/${r.reporter.id}`} className="hover:underline">{r.reporter.name}</Link> : <span className="text-muted">{t('Anonymous')}</span>) },
    { key: 'status', header: t('Status'), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'OPEN' ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" title={t('Resolve')} disabled={busyId === r.id} onClick={() => update.mutate({ id: r.id, status: 'RESOLVED' })} icon={<Check className="size-3.5 text-success" />}>
              <span className="hidden xl:inline">{t('Resolve')}</span>
            </Button>
            <Button size="sm" variant="ghost" title={t('Dismiss')} disabled={busyId === r.id} onClick={() => update.mutate({ id: r.id, status: 'DISMISSED' })} icon={<X className="size-3.5" />}>
              <span className="hidden xl:inline">{t('Dismiss')}</span>
            </Button>
            <Button size="sm" variant="danger-soft" title={t('Block listing')} disabled={busyId === r.id} onClick={() => quickBlock(r)} icon={<Ban className="size-3.5" />}>
              <span className="hidden xl:inline">{t('Block')}</span>
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted">{fmtRelative(r.resolvedAt)}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('Reports')}
        subtitle={list.data ? t('{n} complaints', { n: fmtNumber(list.data.total) }) : t('Complaints about listings')}
        actions={
          <Tabs
            value={f.status}
            onChange={(v) => setF({ status: v })}
            tabs={[
              { value: 'OPEN', label: t('Open') },
              { value: 'RESOLVED', label: t('Resolved') },
              { value: 'DISMISSED', label: t('Dismissed') },
              { value: 'ALL', label: t('All') },
            ]}
          />
        }
      />
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
    </div>
  );
}
