import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import type { AuditLog } from '@evtap/shared';
import * as api from '../api/client';
import { PaginationBar } from '../components/DataTable';
import { FormField, Input, Select } from '../components/FormField';
import { Badge } from '../components/StatusBadge';
import { Button, EmptyState, ErrorState, FilterBar, PageHeader, Skeleton, cx } from '../components/ui';
import { useT } from '../i18n';
import { fmtDateTime, fmtNumber, shortId } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

const ENTITIES = ['listing', 'user', 'payment', 'booking', 'subscription', 'agency', 'report', 'banner', 'page', 'settings', 'service', 'plan', 'wallet', 'mortgage_lead', 'notification'];

const entityLink = (entity: string, id: string | null) => {
  if (!id) return null;
  const map: Record<string, string> = { listing: `/listings/${id}`, user: `/users/${id}`, payment: `/payments?id=${id}`, booking: `/bookings?id=${id}`, page: `/pages/${id}`, wallet: `/users/${id}` };
  return map[entity] ?? null;
};

export default function AuditPage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ entity: '', actorId: '', page: '1' });
  const [open, setOpen] = useState<string | null>(null);
  const query = { entity: f.entity || undefined, actorId: f.actorId || undefined, page: Number(f.page) || 1, pageSize: 30 };
  const list = useQuery({ queryKey: ['admin', 'audit', query], queryFn: () => api.listAuditLogs(query), placeholderData: keepPreviousData });

  return (
    <div>
      <PageHeader title={t('Audit log')} subtitle={list.data ? t('{n} recorded admin actions', { n: fmtNumber(list.data.total) }) : t('Every admin & system action')} />
      <FilterBar>
        <FormField label={t('Entity')} className="w-44">
          <Select value={f.entity} onChange={(e) => setF({ entity: e.target.value })} placeholder={t('All')} options={ENTITIES.map((e) => ({ value: e, label: e }))} />
        </FormField>
        <FormField label={t('Actor ID')} className="w-full sm:w-72">
          <Input value={f.actorId} onChange={(e) => setF({ actorId: e.target.value.trim() })} placeholder="uuid" />
        </FormField>
        {(f.entity || f.actorId) && (
          <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setF({ entity: '', actorId: '' })}>
            {t('Clear')}
          </Button>
        )}
      </FilterBar>
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-hover/60 text-left text-xs text-muted">
              <tr>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-medium">{t('Time')}</th>
                <th className="px-3 py-2.5 font-medium">{t('Actor')}</th>
                <th className="px-3 py-2.5 font-medium">{t('Action')}</th>
                <th className="px-3 py-2.5 font-medium">{t('Entity')}</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading &&
                Array.from({ length: 10 }, (_, i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={6} className="px-3 py-3">
                      <Skeleton />
                    </td>
                  </tr>
                ))}
              {list.data?.items.map((log: AuditLog) => {
                const link = entityLink(log.entity, log.entityId);
                const expanded = open === log.id;
                const hasData = log.data && Object.keys(log.data).length > 0;
                return (
                  <Fragment key={log.id}>
                    <tr className={cx('border-b border-line', hasData && 'cursor-pointer hover:bg-hover')} onClick={() => hasData && setOpen(expanded ? null : log.id)}>
                      <td className="px-3 py-2.5 text-muted">{hasData && <ChevronRight className={cx('size-4 transition-transform', expanded && 'rotate-90')} />}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmtDateTime(log.createdAt)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {log.actor ? (
                          <Link to={`/users/${log.actor.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                            {log.actor.name}
                          </Link>
                        ) : (
                          <span className="text-muted">{t('System')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <code className="rounded bg-hover px-1.5 py-0.5 text-xs">{log.action}</code>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Badge>{log.entity}</Badge>{' '}
                        {log.entityId &&
                          (link ? (
                            <Link to={link} onClick={(e) => e.stopPropagation()} className="text-xs hover:underline">
                              #{shortId(log.entityId)}
                            </Link>
                          ) : (
                            <code className="text-xs text-muted">#{shortId(log.entityId)}</code>
                          ))}
                      </td>
                      <td className="hidden px-3 py-2.5 text-xs text-muted md:table-cell">{log.ip ?? '—'}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-line bg-hover/40">
                        <td />
                        <td colSpan={5} className="px-3 py-2">
                          <pre className="max-h-72 overflow-auto rounded-lg bg-card p-3 text-xs">{JSON.stringify(log.data, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
        {list.data && list.data.items.length === 0 && <EmptyState title={t('No audit entries')} />}
        {list.data && <PaginationBar page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setF({ page: String(p) })} />}
      </div>
    </div>
  );
}
