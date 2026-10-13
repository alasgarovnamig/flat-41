'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Payment } from '@evtap/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { Card, LinkButton, Money, Notice, Spinner } from '@/components/ds';
import { ArrowUpRightIcon, CheckIcon, CloseIcon } from '@/components/ds/icons';

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
      <ResultCard tone="error" title={t('result.missing')}>
        <LinkButton href={href('/account/payments')} className="mt-6">{t('result.toPayments')}</LinkButton>
      </ResultCard>
    );

  if (authStatus === 'anonymous')
    return (
      <ResultCard tone="pending" title={t('result.loginToSee')}>
        <LinkButton className="mt-6" href={`${href('/login')}?next=${encodeURIComponent(`${href('/payment/result')}?${sp.toString()}`)}`}>{t('nav.login')}</LinkButton>
      </ResultCard>
    );

  if (q.isError && !p)
    return (
      <ResultCard tone="error" title={t('result.loadError')}>
        <p className="mb-6 text-label font-normal text-ink-secondary">{errorMessage(q.error, t)}</p>
        <LinkButton href={href('/account/payments')}>{t('result.toPayments')}</LinkButton>
      </ResultCard>
    );

  if (!final) {
    return (
      <ResultCard tone="pending" title={timedOut ? t('result.stillPending') : t('result.processing')}>
        <p className="text-label font-normal text-ink-secondary">{timedOut ? t('result.stillPendingText') : hinted === 'SUCCEEDED' ? t('result.confirming') : t('result.processingText')}</p>
        {timedOut && (
          <LinkButton href={href('/account/payments')} className="mt-5">
            {t('result.toPayments')}
          </LinkButton>
        )}
      </ResultCard>
    );
  }

  const actions = nextActions(p, ok, href, t);
  return (
    <ResultCard tone={ok ? 'success' : 'error'} title={ok ? t('result.success') : p.status === 'CANCELLED' ? t('result.cancelled') : t('result.failed')}>
      <Money value={p.amount} currency={p.currency} minor className="mt-1 block font-display text-[44px] font-light leading-none tracking-[-1.4px]" />
      <dl className="mx-auto mt-6 w-full max-w-sm space-y-2.5 rounded-lg bg-surface-raised p-5 text-left text-[14px] shadow-pill">
        <Row k={t('result.purpose')} v={t(`enums.paymentPurpose.${p.purpose}`)} />
        <Row k={t('result.description')} v={p.description} />
        <Row k={t('payment.method')} v={p.method === 'WALLET' ? t('payment.wallet') : `${t('payment.card')}${p.cardMask ? ` · ${p.cardMask}` : ''}`} />
        <Row k={t('common.date')} v={dateTime(p.paidAt ?? p.createdAt)} />
      </dl>
      {!ok && p.failureReason && <Notice tone="error" className="mx-auto mt-4 max-w-sm text-left">{p.failureReason}</Notice>}
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {actions.map((a) => (
          <LinkButton key={a.href + a.label} href={a.href} variant={a.primary ? 'primary' : 'secondary'} trailing={a.primary ? <ArrowUpRightIcon size={16} /> : undefined}>
            {a.label}
          </LinkButton>
        ))}
      </div>
    </ResultCard>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-secondary">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function ResultCard({ tone, title, children }: { tone: 'success' | 'error' | 'pending'; title: string; children?: React.ReactNode }) {
  return (
    <Card pad="lg" className="mx-auto max-w-lg text-center">
      <div className={`mx-auto flex h-18 w-18 items-center justify-center rounded-full ${tone === 'success' ? 'bg-ink text-on-ink' : tone === 'error' ? 'bg-danger-bg text-danger' : 'bg-surface-sunken text-ink'}`}>
        {tone === 'success' ? <CheckIcon size={32} strokeWidth={2} /> : tone === 'error' ? <CloseIcon size={30} strokeWidth={2} /> : <Spinner size={30} />}
      </div>
      <h1 className="mt-5 text-h1" role="status">
        {title}
      </h1>
      <div className="mt-2">{children}</div>
    </Card>
  );
}
