import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Ban, Lock, ShieldCheck, Unlock, Wallet } from 'lucide-react';
import { USER_ROLES, formatPhone, walletAdjustSchema, type AdminListing, type Payment, type UserRole, type WalletTransaction } from '@evtap/shared';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { AdminOnly } from '../auth/guards';
import { DataTable, type Column } from '../components/DataTable';
import { FormField, MoneyInput, Select, Textarea } from '../components/FormField';
import { useCrumb } from '../components/Layout';
import { listingPrice } from '../components/listing';
import { Modal, useConfirm } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { Avatar, Button, Card, ErrorState, KeyValue, PageHeader, SkeletonBlock, Tabs, cx } from '../components/ui';
import { useT } from '../i18n';
import { enumLabel, fmtDate, fmtDateTime, fmtNumber, fmtRelative, inputToMinor, money, shortId } from '../lib/format';

export default function UserDetailPage() {
  const { id = '' } = useParams();
  const { t } = useT();
  const { user: me } = useAuth();
  const { confirm } = useConfirm();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.getAdminUser(id) });
  useCrumb(q.data?.name ?? `#${shortId(id)}`);
  const [tab, setTab] = useState<'listings' | 'payments' | 'wallet'>('listings');
  const [walletOpen, setWalletOpen] = useState(false);
  const [role, setRole] = useState<UserRole | ''>('');

  const update = useAction((body: { role?: UserRole; status?: 'ACTIVE' | 'BLOCKED' }) => api.updateAdminUser(id, body), {
    success: t('User updated'),
    invalidate: [['admin', 'user', id], ['admin', 'users']],
    onSuccess: () => setRole(''),
  });

  if (q.isLoading)
    return (
      <Card>
        <SkeletonBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  const u = q.data;
  const isSelf = me?.id === u.id;

  const toggleBlock = async () => {
    const blocking = u.status !== 'BLOCKED';
    const ok = await confirm({
      title: blocking ? t('Block {name}?', { name: u.name }) : t('Unblock {name}?', { name: u.name }),
      message: blocking ? t('The user will be signed out and cannot log in or post listings.') : t('The user will be able to sign in again.'),
      confirmLabel: blocking ? t('Block') : t('Unblock'),
      tone: blocking ? 'danger' : 'primary',
    });
    if (ok) update.mutate({ status: blocking ? 'BLOCKED' : 'ACTIVE' });
  };

  const listingCols: Column<AdminListing>[] = [
    { key: 't', header: t('Title'), render: (l) => <Link to={`/listings/${l.id}`} className="block max-w-[320px] truncate font-medium hover:underline">{l.title}</Link>, sortValue: (l) => l.title },
    { key: 'p', header: t('Price'), align: 'right', render: (l) => listingPrice(l), sortValue: (l) => l.price },
    { key: 's', header: t('Status'), render: (l) => <StatusBadge status={l.status} />, sortValue: (l) => l.status },
    { key: 'c', header: t('Created'), hideBelow: 'md', render: (l) => fmtDate(l.createdAt), sortValue: (l) => l.createdAt },
  ];
  const paymentCols: Column<Payment>[] = [
    { key: 'd', header: t('Date'), render: (p) => <span className="whitespace-nowrap">{fmtDateTime(p.createdAt)}</span>, sortValue: (p) => p.createdAt },
    { key: 'pu', header: t('Purpose'), render: (p) => enumLabel(p.purpose) },
    { key: 'm', header: t('Method'), hideBelow: 'md', render: (p) => enumLabel(p.method) },
    { key: 'a', header: t('Amount'), align: 'right', render: (p) => money(p.amount, p.currency), sortValue: (p) => p.amount },
    { key: 's', header: t('Status'), render: (p) => <StatusBadge status={p.status} /> },
  ];
  const txCols: Column<WalletTransaction>[] = [
    { key: 'd', header: t('Date'), render: (x) => <span className="whitespace-nowrap">{fmtDateTime(x.createdAt)}</span>, sortValue: (x) => x.createdAt },
    { key: 'ty', header: t('Type'), render: (x) => <StatusBadge status={x.type} /> },
    { key: 'de', header: t('Description'), render: (x) => <span className="block max-w-[280px] truncate">{x.description}</span> },
    { key: 'a', header: t('Amount'), align: 'right', render: (x) => <span className={x.amount < 0 ? 'text-danger' : 'text-success'}>{x.amount > 0 ? '+' : ''}{money(x.amount)}</span>, sortValue: (x) => x.amount },
    { key: 'b', header: t('Balance'), align: 'right', hideBelow: 'md', render: (x) => money(x.balanceAfter) },
  ];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={u.name} url={u.avatarUrl} size={40} />
            {u.name}
            <StatusBadge status={u.role} />
            <StatusBadge status={u.status} />
          </span>
        }
        actions={
          <AdminOnly fallback={<span className="inline-flex items-center gap-1 text-xs text-muted"><Lock className="size-3.5" /> {t('Read-only for moderators')}</span>}>
            <Button icon={<Wallet className="size-4" />} onClick={() => setWalletOpen(true)}>
              {t('Adjust wallet')}
            </Button>
            {!isSelf && u.status !== 'DELETED' && (
              <Button variant={u.status === 'BLOCKED' ? 'secondary' : 'danger-soft'} icon={u.status === 'BLOCKED' ? <Unlock className="size-4" /> : <Ban className="size-4" />} loading={update.isPending} onClick={toggleBlock}>
                {u.status === 'BLOCKED' ? t('Unblock') : t('Block')}
              </Button>
            )}
          </AdminOnly>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card title={t('Profile')}>
            <KeyValue
              cols={1}
              items={[
                [t('Email'), u.email ? <span key="e">{u.email} {u.isEmailVerified && <ShieldCheck className="inline size-3.5 text-success" />}</span> : '—'],
                [t('Phone'), u.phone ? <span key="p">{formatPhone(u.phone)} {u.isPhoneVerified && <ShieldCheck className="inline size-3.5 text-success" />}</span> : '—'],
                [t('Account type'), <StatusBadge key="a" status={u.accountType} />],
                [t('Agency'), u.agencyId ? <code key="ag" className="text-xs">#{shortId(u.agencyId)}</code> : '—'],
                [t('Language'), u.locale.toUpperCase()],
                [t('Joined'), fmtDateTime(u.createdAt)],
                [t('Last login'), fmtRelative(u.lastLoginAt)],
                ['ID', <code key="id" className="text-xs">{u.id}</code>],
              ]}
            />
          </Card>
          <Card title={t('Money')}>
            <KeyValue
              cols={2}
              items={[
                [t('Wallet balance'), <span key="w" className="text-lg">{money(u.walletBalance)}</span>],
                [t('Total spent'), <span key="s" className="text-lg">{money(u.totalSpent)}</span>],
                [t('Active listings'), fmtNumber(u.activeListings)],
                [t('Payments'), fmtNumber(u.payments?.length)],
              ]}
            />
          </Card>
          <AdminOnly>
            <Card title={t('Role')}>
              <div className="flex gap-2">
                <Select className="flex-1" value={role || u.role} onChange={(e) => setRole(e.target.value as UserRole)} options={USER_ROLES.map((r) => ({ value: r, label: enumLabel(r) }))} disabled={isSelf} />
                <Button
                  variant="primary"
                  disabled={!role || role === u.role}
                  loading={update.isPending}
                  onClick={async () => {
                    if (!role) return;
                    const ok = await confirm({ title: t('Change role to {r}?', { r: enumLabel(role) }), message: role !== 'USER' ? t('This grants back-office access.') : t('This removes back-office access.'), confirmLabel: t('Change role') });
                    if (ok) update.mutate({ role });
                  }}
                >
                  {t('Save')}
                </Button>
              </div>
              {isSelf && <p className="mt-2 text-xs text-muted">{t('You cannot change your own role.')}</p>}
            </Card>
          </AdminOnly>
        </div>

        <div className="min-w-0 space-y-3">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'listings', label: t('Listings'), count: u.listings?.length ?? 0 },
              { value: 'payments', label: t('Payments'), count: u.payments?.length ?? 0 },
              { value: 'wallet', label: t('Wallet transactions'), count: u.walletTransactions?.length ?? 0 },
            ]}
          />
          {tab === 'listings' && <DataTable columns={listingCols} rows={u.listings ?? []} rowKey={(l) => l.id} dense />}
          {tab === 'payments' && <DataTable columns={paymentCols} rows={u.payments ?? []} rowKey={(p) => p.id} dense onRowClick={(p) => nav(`/payments?id=${p.id}`)} />}
          {tab === 'wallet' && <DataTable columns={txCols} rows={u.walletTransactions ?? []} rowKey={(x) => x.id} dense />}
          {tab === 'listings' && (u.listings?.length ?? 0) > 0 && (
            <Link to={`/listings?ownerId=${u.id}`} className="inline-block text-sm text-brand-fg hover:underline">
              {t('Open all listings of this user')} →
            </Link>
          )}
        </div>
      </div>

      <WalletAdjustModal open={walletOpen} onClose={() => setWalletOpen(false)} userId={u.id} balance={u.walletBalance} />
    </div>
  );
}

function WalletAdjustModal({ open, onClose, userId, balance }: { open: boolean; onClose: () => void; userId: string; balance: number }) {
  const { t } = useT();
  const [dir, setDir] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const adjust = useAction((body: { amount: number; reason: string }) => api.adjustWallet(userId, body), {
    success: (w) => t('Wallet adjusted. New balance: {b}', { b: money(w.balance) }),
    invalidate: [['admin', 'user', userId], ['admin', 'users']],
    onSuccess: () => {
      setAmount('');
      setReason('');
      onClose();
    },
  });
  const minor = inputToMinor(amount);
  const signed = minor == null ? null : dir === 'credit' ? minor : -minor;
  const submit = () => {
    const parsed = walletAdjustSchema.safeParse({ amount: signed, reason });
    if (!parsed.success || !minor || minor < 0) {
      setError(t('Enter a positive amount and a reason (3+ characters).'));
      return;
    }
    if (dir === 'debit' && minor > balance) {
      setError(t('Debit exceeds the current balance ({b}).', { b: money(balance) }));
      return;
    }
    setError(null);
    adjust.mutate(parsed.data);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Wallet adjustment')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant={dir === 'debit' ? 'danger' : 'primary'} loading={adjust.isPending} onClick={submit}>
            {dir === 'credit' ? t('Credit wallet') : t('Debit wallet')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('Current balance: {b}. Adjustments are recorded as ADJUSTMENT transactions and in the audit log.', { b: money(balance) })}</p>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-hover p-1">
          {(['credit', 'debit'] as const).map((d) => (
            <button key={d} onClick={() => setDir(d)} className={cx('rounded-md py-1.5 text-sm font-medium', dir === d ? 'bg-card shadow-sm' : 'text-muted')}>
              {d === 'credit' ? t('+ Credit') : t('− Debit')}
            </button>
          ))}
        </div>
        <FormField label={t('Amount')} error={error}>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </FormField>
        <FormField label={t('Reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t('e.g. Compensation for failed promotion')} />
        </FormField>
      </div>
    </Modal>
  );
}
