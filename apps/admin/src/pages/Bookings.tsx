import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarX } from 'lucide-react';
import { BOOKING_STATUSES, formatPhone, formatPrice, type Booking } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { AdminOnly } from '../auth/guards';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, Select } from '../components/FormField';
import { useConfirm, Drawer } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { Avatar, Button, EmptyState, FilterBar, KeyValue, PageHeader } from '../components/ui';
import { useT } from '../i18n';
import { cityName, enumLabel, fmtDate, fmtDateTime, fmtNumber, money, shortId } from '../lib/format';
import { useUrlFilters } from '../lib/hooks';

const CANCELLABLE = new Set(['CONFIRMED', 'PENDING_PAYMENT']);

export default function BookingsPage() {
  const { t } = useT();
  const [f, setF] = useUrlFilters({ status: '', payoutStatus: '', page: '1', id: '' });
  const query = {
    page: Number(f.page) || 1,
    pageSize: 20,
    status: f.status || undefined,
    payoutStatus: (f.payoutStatus || undefined) as 'NOT_DUE' | 'PENDING' | 'PAID' | 'CANCELLED' | undefined,
  };
  const list = useQuery({ queryKey: ['admin', 'bookings', query], queryFn: () => api.listAdminBookings(query), placeholderData: keepPreviousData });
  const selected = list.data?.items.find((b) => b.id === f.id) ?? null;

  const columns: Column<Booking>[] = [
    {
      key: 'dates',
      header: t('Dates'),
      sortValue: (b) => b.checkIn,
      render: (b) => (
        <div className="whitespace-nowrap">
          <p className="font-medium">
            {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}
          </p>
          <p className="text-xs text-muted">{t('{n} nights · {g} guests', { n: b.nights, g: b.guests })}</p>
        </div>
      ),
    },
    {
      key: 'listing',
      header: t('Listing'),
      render: (b) => (
        <div className="min-w-[160px]">
          <Link to={`/listings/${b.listing.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[200px] truncate hover:underline">
            {b.listing.title}
          </Link>
          <p className="text-xs text-muted">{cityName(b.listing.cityId)}</p>
        </div>
      ),
    },
    { key: 'guest', header: t('Guest'), hideBelow: 'xl', sortValue: (b) => b.guest.name, render: (b) => <span className="whitespace-nowrap">{b.guest.name}</span> },
    { key: 'host', header: t('Host'), hideBelow: '2xl', sortValue: (b) => b.host.name, render: (b) => <span className="whitespace-nowrap">{b.host.name}</span> },
    { key: 'total', header: t('Total'), align: 'right', sortValue: (b) => b.total, render: (b) => <span className="font-medium whitespace-nowrap">{money(b.total, b.currency)}</span> },
    { key: 'status', header: t('Status'), sortValue: (b) => b.status, render: (b) => <StatusBadge status={b.status} /> },
    { key: 'payout', header: t('Payout'), hideBelow: 'lg', sortValue: (b) => b.payoutStatus, render: (b) => <StatusBadge status={b.payoutStatus} /> },
    { key: 'created', header: t('Booked'), hideBelow: '2xl', sortValue: (b) => b.createdAt, render: (b) => <span className="whitespace-nowrap">{fmtDateTime(b.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title={t('Bookings')} subtitle={list.data ? t('{n} daily-rent bookings', { n: fmtNumber(list.data.total) }) : undefined} />
      <FilterBar>
        <FormField label={t('Status')} className="w-44">
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('All')} options={BOOKING_STATUSES.map((s) => ({ value: s, label: enumLabel(s) }))} />
        </FormField>
        <FormField label={t('Payout status')} className="w-44">
          <Select
            value={f.payoutStatus}
            onChange={(e) => setF({ payoutStatus: e.target.value })}
            placeholder={t('All')}
            options={['NOT_DUE', 'PENDING', 'PAID', 'CANCELLED'].map((s) => ({ value: s, label: enumLabel(s) }))}
          />
        </FormField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(b) => b.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(b) => setF({ id: b.id, page: f.page })}
        selectedKey={f.id || null}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (p) => setF({ page: String(p) }) } : undefined}
      />
      <BookingDrawer open={!!f.id} booking={selected} loading={list.isLoading} onClose={() => setF({ id: '', page: f.page })} />
    </div>
  );
}

function BookingDrawer({ open, booking: b, loading, onClose }: { open: boolean; booking: Booking | null; loading: boolean; onClose: () => void }) {
  const { t } = useT();
  const { ask } = useConfirm();
  const cancel = useAction((reason: string) => api.cancelAdminBooking(b!.id, reason), {
    success: t('Booking cancelled with a full refund'),
    invalidate: [['admin', 'bookings'], ['admin', 'overview']],
  });
  const doCancel = async () => {
    if (!b) return;
    const reason = await ask({
      title: t('Cancel booking & refund {v}?', { v: money(b.total - b.refundedAmount, b.currency) }),
      message: t('The guest gets a full refund, the host payout is cancelled and both are notified.'),
      confirmLabel: t('Cancel booking'),
      tone: 'danger',
      presets: ['Ev sahibi əlçatan deyil', 'Elan saxta çıxdı', 'Texniki xəta', 'Qonaq şikayəti təsdiqləndi'],
    });
    if (reason) cancel.mutate(reason);
  };
  const row = (label: string, value: string, strong?: boolean, tone?: string) => (
    <tr className={strong ? 'font-semibold' : undefined}>
      <td className="py-1.5">{label}</td>
      <td className={`py-1.5 text-right tabular-nums ${tone ?? ''}`}>{value}</td>
    </tr>
  );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={b ? b.listing.title : t('Booking')}
      subtitle={b ? <span className="flex items-center gap-2"><code className="text-xs">{shortId(b.id)}</code><StatusBadge status={b.status} /><StatusBadge status={b.payoutStatus} /></span> : undefined}
      footer={
        b && CANCELLABLE.has(b.status) ? (
          <AdminOnly>
            <Button variant="danger" icon={<CalendarX className="size-4" />} loading={cancel.isPending} onClick={doCancel}>
              {t('Cancel with full refund')}
            </Button>
          </AdminOnly>
        ) : undefined
      }
    >
      {!b ? (
        <EmptyState title={loading ? t('Loading…') : t('Booking not on this page')} hint={t('Open it from the table (there is no single-booking admin endpoint).')} />
      ) : (
        <div className="space-y-5">
          <KeyValue
            items={[
              [t('Check-in'), fmtDate(b.checkIn)],
              [t('Check-out'), fmtDate(b.checkOut)],
              [t('Nights'), b.nights],
              [t('Guests'), b.guests],
              [t('Booked'), fmtDateTime(b.createdAt)],
              [t('Payment'), b.paymentId ? <Link key="p" to={`/payments?id=${b.paymentId}`} className="hover:underline">#{shortId(b.paymentId)}</Link> : '—'],
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {([['Guest', b.guest], ['Host', b.host]] as const).map(([label, p]) => (
              <div key={label} className="flex items-center gap-2.5 rounded-lg border border-line p-3">
                <Avatar name={p.name} url={p.avatarUrl} />
                <div className="min-w-0">
                  <p className="text-xs text-muted">{t(label)}</p>
                  <Link to={`/users/${p.id}`} className="block truncate font-medium hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-xs text-muted">{p.phone ? formatPhone(p.phone) : '—'}</p>
                </div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('Money breakdown')}</h3>
            <table className="w-full text-sm">
              <tbody className="[&_tr]:border-b [&_tr]:border-line">
                {row(`${formatPrice(b.nightlyPrice, b.currency)} × ${b.nights}`, money(b.subtotal, b.currency))}
                {row(t('Guest service fee'), '+' + money(b.guestFee, b.currency))}
                {row(t('Guest paid'), money(b.total, b.currency), true)}
                {row(t('Host commission'), '−' + money(b.hostFee, b.currency))}
                {row(t('Host payout'), money(b.hostPayout, b.currency), true)}
                {row(t('Platform take'), money(b.guestFee + b.hostFee, b.currency), false, 'text-brand-fg')}
                {b.refundedAmount > 0 && row(t('Refunded to guest'), '−' + money(b.refundedAmount, b.currency), false, 'text-info')}
              </tbody>
            </table>
          </div>
          {b.cancelledBy && (
            <div className="rounded-lg bg-hover px-3 py-2 text-sm">
              <span className="font-medium">{t('Cancelled by {who}', { who: enumLabel(b.cancelledBy) })}</span>
              {b.cancelReason && <p className="mt-0.5 text-muted">{b.cancelReason}</p>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
