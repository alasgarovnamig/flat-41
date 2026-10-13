import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, RotateCcw, X } from 'lucide-react';
import { PAYMENT_PURPOSES, PAYMENT_STATUSES, formatPhone, refundSchema, type Payment } from '@evtap/shared';
import * as api from '../api/client';
import type { AdminPaymentRow } from '../api/client';
import { useAction } from '../api/queries';
import { AdminOnly } from '../auth/guards';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer, Modal } from '../components/Modal';
import { FormField, Input, MoneyInput, Select, Textarea } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { Button, ErrorState, FilterBar, KeyValue, PageHeader, SkeletonBlock, cx } from '../components/ui';
import { useT } from '../i18n';
import { downloadCsv } from '../lib/csv';
import { enumLabel, fmtDateTime, fmtNumber, inputToMinor, minorToInput, money, shortId } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

const REFUNDABLE = new Set(['SUCCEEDED', 'PARTIALLY_REFUNDED']);

export default function PaymentsPage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ status: '', purpose: '', from: '', to: '', userId: '', page: '1', id: '' });
  const query = {
    page: Number(f.page) || 1,
    pageSize: 25,
    status: f.status || undefined,
    purpose: f.purpose || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    userId: f.userId || undefined,
  };
  const list = useQuery({ queryKey: ['admin', 'payments', query], queryFn: () => api.listAdminPayments(query), placeholderData: keepPreviousData });
  const open = (id: string) => setF({ id, page: f.page });

  const columns: Column<AdminPaymentRow>[] = [
    { key: 'date', header: t('Date'), sortValue: (p) => p.createdAt, render: (p) => <span className="whitespace-nowrap">{fmtDateTime(p.createdAt)}</span> },
    { key: 'id', header: 'ID', hideBelow: '2xl', render: (p) => <code className="text-xs text-muted">{shortId(p.id)}</code> },
    {
      key: 'user',
      header: t('User'),
      sortValue: (p) => p.userName ?? '',
      render: (p) => (
        <Link to={`/users/${p.userId}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap hover:underline">
          {p.userName ?? shortId(p.userId)}
        </Link>
      ),
    },
    { key: 'purpose', header: t('Purpose'), sortValue: (p) => p.purpose, render: (p) => <span className="whitespace-nowrap">{enumLabel(p.purpose)}</span> },
    { key: 'desc', header: t('Description'), hideBelow: '2xl', render: (p) => <span className="block max-w-[240px] truncate text-muted">{p.description}</span> },
    { key: 'method', header: t('Method'), hideBelow: 'xl', render: (p) => <span className="whitespace-nowrap">{enumLabel(p.method)}{p.cardMask ? <span className="ml-1 text-xs text-muted">{p.cardMask}</span> : null}</span> },
    { key: 'amount', header: t('Amount'), align: 'right', sortValue: (p) => p.amount, render: (p) => <span className="font-medium whitespace-nowrap">{money(p.amount, p.currency)}</span> },
    { key: 'refunded', header: t('Refunded'), align: 'right', hideBelow: 'xl', sortValue: (p) => p.refundedAmount, render: (p) => (p.refundedAmount ? money(p.refundedAmount, p.currency) : <span className="text-muted">—</span>) },
    { key: 'status', header: t('Status'), sortValue: (p) => p.status, render: (p) => <StatusBadge status={p.status} /> },
  ];

  const exportCsv = () => {
    const rows = list.data?.items ?? [];
    downloadCsv(
      `evtap-payments-page${query.page}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['id', 'createdAt', 'paidAt', 'userId', 'userName', 'purpose', 'method', 'status', 'amount_AZN', 'refunded_AZN', 'currency', 'cardMask', 'providerOrderId', 'description'],
      rows.map((p) => [p.id, p.createdAt, p.paidAt, p.userId, p.userName, p.purpose, p.method, p.status, (p.amount / 100).toFixed(2), (p.refundedAmount / 100).toFixed(2), p.currency, p.cardMask, p.providerOrderId, p.description]),
    );
  };

  const pageSum = (list.data?.items ?? []).filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED').reduce((a, p) => a + p.amount - p.refundedAmount, 0);

  return (
    <div>
      <PageHeader
        title={t('Payments')}
        subtitle={list.data ? t('{n} payments · net {v} on this page', { n: fmtNumber(list.data.total), v: money(pageSum) }) : undefined}
        actions={
          <Button icon={<Download className="size-4" />} disabled={!list.data?.items.length} onClick={exportCsv}>
            {t('Export CSV')}
          </Button>
        }
      />
      <FilterBar>
        <FormField label={t('Status')} className="w-40">
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('All')} options={PAYMENT_STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))} />
        </FormField>
        <FormField label={t('Purpose')} className="w-40">
          <Select value={f.purpose} onChange={(e) => setF({ purpose: e.target.value })} placeholder={t('All')} options={PAYMENT_PURPOSES.map((s) => ({ value: s, label: enumLabel(s) }))} />
        </FormField>
        <FormField label={t('From')} className="w-40">
          <Input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ from: e.target.value })} />
        </FormField>
        <FormField label={t('To')} className="w-40">
          <Input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ to: e.target.value })} />
        </FormField>
        <FormField label={t('User ID')} className="w-full sm:w-72">
          <Input value={f.userId} onChange={(e) => setF({ userId: e.target.value.trim() })} placeholder="uuid" />
        </FormField>
        {(f.status || f.purpose || f.from || f.to || f.userId) && (
          <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setF({ status: '', purpose: '', from: '', to: '', userId: '' })}>
            {t('Clear')}
          </Button>
        )}
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(p) => open(p.id)}
        selectedKey={f.id || null}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
      <PaymentDrawer id={f.id || null} onClose={() => setF({ id: '', page: f.page })} />
    </div>
  );
}

function PaymentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'payment', id], queryFn: () => api.getAdminPayment(id!), enabled: !!id });
  const [refundOpen, setRefundOpen] = useState(false);
  const p = q.data;
  const refundable = p ? p.amount - p.refundedAmount : 0;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p ? `${enumLabel(p.purpose)} · ${money(p.amount, p.currency)}` : t('Payment')}
      subtitle={p ? <span className="flex items-center gap-2"><code className="text-xs">{p.id}</code><StatusBadge status={p.status} /></span> : undefined}
      footer={
        p && REFUNDABLE.has(p.status) && refundable > 0 ? (
          <AdminOnly>
            <Button variant="danger" icon={<RotateCcw className="size-4" />} onClick={() => setRefundOpen(true)}>
              {t('Refund')}
            </Button>
          </AdminOnly>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <SkeletonBlock rows={8} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        <div className="space-y-5">
          <KeyValue
            items={[
              [t('User'), p.user ? <Link key="u" to={`/users/${p.user.id}`} className="hover:underline">{p.user.name}</Link> : <Link key="u" to={`/users/${p.userId}`} className="hover:underline">#{shortId(p.userId)}</Link>],
              [t('Contact'), p.user ? [p.user.email, p.user.phone && formatPhone(p.user.phone)].filter(Boolean).join(' · ') || '—' : '—'],
              [t('Method'), enumLabel(p.method)],
              [t('Card'), p.cardMask ?? '—'],
              [t('Created'), fmtDateTime(p.createdAt)],
              [t('Paid'), fmtDateTime(p.paidAt)],
              [t('Provider'), p.provider ?? '—'],
              [t('Provider order'), p.providerOrderId ? <code key="o" className="text-xs">{p.providerOrderId}</code> : '—'],
              [t('Listing'), p.listingId ? <Link key="l" to={`/listings/${p.listingId}`} className="hover:underline">#{shortId(p.listingId)}</Link> : '—'],
              [t('Booking'), p.bookingId ? <Link key="b" to={`/bookings?id=${p.bookingId}`} className="hover:underline">#{shortId(p.bookingId)}</Link> : '—'],
            ]}
          />
          {p.description && <p className="rounded-lg bg-hover px-3 py-2 text-sm">{p.description}</p>}
          {p.failureReason && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{p.failureReason}</p>}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('Items')}</h3>
            <table className="w-full text-sm">
              <tbody>
                {p.items.map((it, i) => (
                  <tr key={i} className="border-b border-line">
                    <td className="py-1.5">
                      {it.name} <code className="ml-1 text-xs text-muted">{it.code}</code>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{money(it.amount, p.currency)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5">{t('Total')}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(p.amount, p.currency)}</td>
                </tr>
                {p.refundedAmount > 0 && (
                  <tr className="text-info">
                    <td className="py-1.5">{t('Refunded')}</td>
                    <td className="py-1.5 text-right tabular-nums">−{money(p.refundedAmount, p.currency)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('Provider data')}</h3>
            {p.providerData && Object.keys(p.providerData).length ? (
              <pre className="max-h-64 overflow-auto rounded-lg bg-hover p-3 text-xs">{JSON.stringify(p.providerData, null, 2)}</pre>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
          <RefundModal open={refundOpen} onClose={() => setRefundOpen(false)} payment={p} />
        </div>
      ) : null}
    </Drawer>
  );
}

function RefundModal({ open, onClose, payment }: { open: boolean; onClose: () => void; payment: Payment }) {
  const { t } = useT();
  const max = payment.amount - payment.refundedAmount;
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState(minorToInput(max));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setMode('full');
      setAmount(minorToInput(max));
      setReason('');
      setError(null);
    }
  }, [open, max]);
  const refund = useAction((body: { amount?: number; reason?: string }) => api.refundPayment(payment.id, body), {
    success: (r) => t('Refund processed: {s}', { s: enumLabel(r.status) }),
    invalidate: [['admin', 'payment', payment.id], ['admin', 'payments'], ['admin', 'overview']],
    onSuccess: onClose,
  });
  const submit = () => {
    const minor = mode === 'full' ? undefined : inputToMinor(amount);
    if (mode === 'partial' && (minor == null || minor <= 0 || minor > max)) {
      setError(t('Amount must be between 0.01 and {m}.', { m: money(max, payment.currency) }));
      return;
    }
    const parsed = refundSchema.safeParse({ amount: minor ?? undefined, reason: reason.trim() || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('Invalid input'));
      return;
    }
    refund.mutate(parsed.data);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Refund payment')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="danger" loading={refund.isPending} onClick={submit}>
            {mode === 'full' ? t('Refund {v}', { v: money(max, payment.currency) }) : t('Refund partially')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {payment.method === 'CARD' ? t('Card payments are refunded through the bank to {c}.', { c: payment.cardMask ?? t('the card') }) : t('Wallet payments are credited back to the user wallet.')}{' '}
          {t('Refundable: {v}.', { v: money(max, payment.currency) })}
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-hover p-1">
          {(['full', 'partial'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx('rounded-md py-1.5 text-sm font-medium', mode === m ? 'bg-card shadow-sm' : 'text-muted')}>
              {m === 'full' ? t('Full refund') : t('Partial refund')}
            </button>
          ))}
        </div>
        {mode === 'partial' && (
          <FormField label={t('Amount')} error={error}>
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
        )}
        <FormField label={t('Reason')} error={mode === 'full' ? error : undefined}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t('Optional — visible in the audit log')} />
        </FormField>
      </div>
    </Modal>
  );
}

