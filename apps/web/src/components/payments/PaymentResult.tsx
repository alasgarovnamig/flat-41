'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatMoney, type Payment } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { LinkButton } from '@/components/ui/Button';
import { Alert, Spinner } from '@/components/ui/feedback';
import { CheckIcon, CloseIcon } from '@/components/ui/icons';

const FINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
const POLL_MS = 2000;
const MAX_WAIT_MS = 90_000;

function nextActions(p: Payment, ok: boolean, href: (p: string) => string, t: (k: string) => string) {
  const listing = p.listingId;
  switch (p.purpose) {
    case 'WALLET_TOPUP':
      return [{ href: href('/account/wallet'), label: t('result.toWallet'), primary: true }];
    case 'BOOKING':
      return [{ href: href('/account/bookings'), label: t('result.toBookings'), primary: true }, ...(listing ? [{ href: href(`/listings/${listing}`), label: t('result.toListing') }] : [])];
    case 'SUBSCRIPTION':
      return ok
        ? [{ href: href('/account/business'), label: t('result.toSubscription'), primary: true }, { href: href('/account/agency'), label: t('result.toAgency') }]
        : [{ href: href('/business'), label: t('result.tryAgain'), primary: true }];
    case 'LISTING_FEE':
      return ok
        ? [{ href: href('/account/listings'), label: t('result.toListings'), primary: true }, ...(listing ? [{ href: href(`/listings/${listing}/promote`), label: t('owner.promote') }] : [])]
        : [...(listing ? [{ href: href(`/listings/${listing}/pay`), label: t('result.tryAgain'), primary: true }] : []), { href: href('/account/listings'), label: t('result.toListings') }];
    default:
      return ok
        ? [...(listing ? [{ href: href(`/listings/${listing}`), label: t('result.toListing'), primary: true }] : []), { href: href('/account/listings'), label: t('result.toListings') }]
        : [...(listing ? [{ href: href(`/listings/${listing}/promote`), label: t('result.tryAgain'), primary: true }] : []), { href: href('/account/listings'), label: t('result.toListings') }];
  }
}

export function PaymentResult() {
  const { t, href, dateTime } = useI18n();
  const { status: authStatus, refresh } = useAuth();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const paymentId = sp.get('paymentId');
  const hinted = sp.get('status');
  const [started] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const q = useQuery({
    queryKey: qk.payment(paymentId ?? ''),
    queryFn: () => api.payments.get(paymentId!),
    enabled: !!paymentId && authStatus === 'authenticated',
    refetchInterval: (query) => {
      const p = query.state.data;
      if (p && FINAL.includes(p.status)) return false;
      if (Date.now() - started > MAX_WAIT_MS) return false;
      return POLL_MS;
    },
    retry: 2,
  });
  const p = q.data;
  const final = !!p && FINAL.includes(p.status);
  const ok = p?.status === 'SUCCEEDED';

  useEffect(() => {
    if (final) {
      refresh();
      void qc.invalidateQueries({ queryKey: qk.wallet });
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    }
  }, [final, refresh, qc]);
  useEffect(() => {
    if (final) return;
    const id = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => clearTimeout(id);
  }, [final]);

  if (!paymentId)
    return (
      <Card tone="error" title={t('result.missing')}>
        <LinkButton href={href('/account/payments')}>{t('result.toPayments')}</LinkButton>
      </Card>
    );

  if (authStatus === 'anonymous')
    return (
      <Card tone="pending" title={t('result.loginToSee')}>
        <LinkButton href={`${href('/login')}?next=${encodeURIComponent(`${href('/payment/result')}?${sp.toString()}`)}`}>{t('nav.login')}</LinkButton>
      </Card>
    );

  if (q.isError && !p)
    return (
      <Card tone="error" title={t('result.loadError')}>
        <p className="mb-4 text-sm text-muted">{errorMessage(q.error, t)}</p>
        <LinkButton href={href('/account/payments')}>{t('result.toPayments')}</LinkButton>
      </Card>
    );

  if (!final) {
    return (
      <Card tone="pending" title={timedOut ? t('result.stillPending') : t('result.processing')}>
        <p className="text-sm text-muted">{timedOut ? t('result.stillPendingText') : hinted === 'SUCCEEDED' ? t('result.confirming') : t('result.processingText')}</p>
        {timedOut && (
          <LinkButton href={href('/account/payments')} className="mt-5">
            {t('result.toPayments')}
          </LinkButton>
        )}
      </Card>
    );
  }

  const actions = nextActions(p, ok, href, t);
  return (
    <Card tone={ok ? 'success' : 'error'} title={ok ? t('result.success') : p.status === 'CANCELLED' ? t('result.cancelled') : t('result.failed')}>
      <dl className="mx-auto mt-2 w-full max-w-sm space-y-2 rounded-xl bg-surface p-4 text-left text-sm">
        <Row k={t('result.purpose')} v={t(`enums.paymentPurpose.${p.purpose}`)} />
        <Row k={t('result.description')} v={p.description} />
        <Row k={t('common.amount')} v={formatMoney(p.amount, p.currency)} />
        <Row k={t('payment.method')} v={p.method === 'WALLET' ? t('payment.wallet') : `${t('payment.card')}${p.cardMask ? ` · ${p.cardMask}` : ''}`} />
        <Row k={t('common.date')} v={dateTime(p.paidAt ?? p.createdAt)} />
      </dl>
      {!ok && p.failureReason && <Alert tone="error" className="mx-auto mt-4 max-w-sm text-left">{p.failureReason}</Alert>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {actions.map((a) => (
          <LinkButton key={a.href + a.label} href={a.href} variant={a.primary ? 'primary' : 'outline'}>
            {a.label}
          </LinkButton>
        ))}
      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function Card({ tone, title, children }: { tone: 'success' | 'error' | 'pending'; title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-card">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${tone === 'success' ? 'bg-brand-50 text-brand' : tone === 'error' ? 'bg-urgent-50 text-urgent' : 'bg-vip-50 text-amber-600'}`}>
        {tone === 'success' ? <CheckIcon size={32} strokeWidth={2.5} /> : tone === 'error' ? <CloseIcon size={30} strokeWidth={2.5} /> : <Spinner size={30} />}
      </div>
      <h1 className="mt-4 text-2xl font-bold" role="status">
        {title}
      </h1>
      <div className="mt-2">{children}</div>
    </div>
  );
}
