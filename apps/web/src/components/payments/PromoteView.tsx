'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BUNDLES, SERVICE_CATALOG, formatMoney, type BundleDef, type PaymentMethod, type ServiceDef } from '@evtap/shared';
import { api, type CreditKind } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { listingStatusTone } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, ErrorState, Img, Money, Notice, PageHeader, PageSpinner, Price, StatusPill } from '@/components/ds';
import { ArrowLeftIcon, ArrowUpIcon, BoltIcon, CheckIcon, CrownIcon, ShieldCheckIcon, SparklesIcon, StarIcon } from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { PayMethodPicker } from './PayMethod';

const ICON: Record<string, React.ReactNode> = {
  BUMP: <ArrowUpIcon size={20} />,
  AUTO_BUMP: <ArrowUpIcon size={20} />,
  VIP: <StarIcon size={20} />,
  PREMIUM: <CrownIcon size={20} />,
  HIGHLIGHT: <SparklesIcon size={20} />,
  URGENT: <BoltIcon size={20} />,
};

export function PromoteView({ id }: { id: string }) {
  const { t, locale, href } = useI18n();
  const { user, refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const listing = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listings.get(id), retry: false });
  const catalog = useQuery({ queryKey: qk.catalog, queryFn: api.ref.catalog, staleTime: 5 * 60_000, retry: false });
  const services: ServiceDef[] = (catalog.data?.services ?? SERVICE_CATALOG).filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const bundles: BundleDef[] = catalog.data?.bundles ?? BUNDLES;
  const promoServices = services.filter((s) => s.promotionType);
  const verification = services.find((s) => s.code === 'VERIFICATION');

  const [selected, setSelected] = useState<string[]>([]);
  const [bundle, setBundle] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('CARD');

  const total = useMemo(() => {
    if (bundle) return bundles.find((b) => b.code === bundle)?.price ?? 0;
    return selected.reduce((s, c) => s + (services.find((x) => x.code === c)?.price ?? 0), 0);
  }, [bundle, selected, bundles, services]);

  const toggle = (code: string) => {
    setBundle(null);
    setSelected((l) => (l.includes(code) ? l.filter((c) => c !== code) : [...l, code]));
  };

  const pay = useMutation({
    mutationFn: () => api.payments.checkout({ purpose: 'PROMOTION', listingId: id, ...(bundle ? { bundleCode: bundle } : { serviceCodes: selected }), method, returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (c) => followCheckout(c, locale, router.push),
  });
  const verify = useMutation({
    mutationFn: () => api.payments.checkout({ purpose: 'VERIFICATION', listingId: id, method, returnUrl: paymentReturnUrl(locale) }),
    onSuccess: (c) => followCheckout(c, locale, router.push),
  });
  const credit = useMutation({
    mutationFn: (k: CreditKind) => api.listings.applyCredit(id, k),
    onSuccess: () => {
      toast.success(t('promote.creditApplied'));
      refresh();
      void qc.invalidateQueries({ queryKey: qk.listing(id) });
    },
  });

  if (listing.isLoading) return <PageSpinner />;
  if (listing.isError || !listing.data) return <ErrorState title={t('listing.loadError')} text={errorMessage(listing.error, t)} onRetry={() => void listing.refetch()} retryLabel={t('common.retry')} />;
  const l = listing.data;
  const sub = user?.subscription;
  const usage = sub && (sub.status === 'ACTIVE' || sub.status === 'CANCELLED') ? sub.usage : null;
  const name = (s: { name: Record<string, string> }) => s.name[locale] ?? s.name.az;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('promote.title')} sub={t('promote.subtitle')} />

      <Card pad="sm" className="mb-5 flex items-center gap-4">
        <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md">
          <Img src={l.coverUrl} alt="" fill sizes="96px" className="object-cover" />
        </span>
        <span className="min-w-0 flex-1">
          <Price l={l} className="block font-display text-[22px] leading-tight" />
          <span className="block truncate text-label text-ink-secondary">{l.title}</span>
        </span>
        <StatusPill tone={listingStatusTone(l.status)} className="hidden sm:inline-flex">{t(`enums.listingStatus.${l.status}`)}</StatusPill>
      </Card>
      {l.status !== 'ACTIVE' && <Notice tone="warning" className="mb-4">{t('promote.notActive')}</Notice>}
      {catalog.isError && <Notice tone="warning" className="mb-4">{t('promote.catalogFallback')}</Notice>}

      {usage && (usage.bumpsLeft > 0 || usage.vipCreditsLeft > 0 || usage.premiumCreditsLeft > 0) && (
        <Card tone="ink" className="mb-5">
          <h2 className="text-h3">{t('promote.credits')}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ['BUMP', usage.bumpsLeft, t('promote.creditBump')],
                ['VIP_7', usage.vipCreditsLeft, t('promote.creditVip')],
                ['PREMIUM_7', usage.premiumCreditsLeft, t('promote.creditPremium')],
              ] as [CreditKind, number, string][]
            )
              .filter(([, n]) => n > 0)
              .map(([k, n, label]) => (
                <Button key={k} variant="glass" loading={credit.isPending && credit.variables === k} onClick={() => credit.mutate(k)} trailing={<span className="tabular rounded-pill bg-ink px-2 text-[11px] text-on-ink">{n}</span>}>
                  {label}
                </Button>
              ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          {bundles.length > 0 && (
            <section aria-labelledby="bundles-h">
              <h2 id="bundles-h" className="mb-3 text-h2">
                {t('promote.bundles')}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {bundles.map((b, bi) => {
                  const regular = b.serviceCodes.reduce((s, c) => s + (services.find((x) => x.code === c)?.price ?? 0), 0);
                  const on = bundle === b.code;
                  const featured = bi === bundles.length - 1;
                  return (
                    <button
                      key={b.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSelected([]);
                        setBundle(on ? null : b.code);
                      }}
                      className={cn('press relative flex flex-col rounded-xl p-6 text-left', featured ? 'bg-ink text-on-ink' : 'bg-surface shadow-card', on && 'ring-[3px] ring-accent-strong ring-offset-2 ring-offset-frame')}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-h3">{name(b)}</span>
                        {regular > b.price && <Badge tone="accent">−{Math.round((1 - b.price / regular) * 100)}%</Badge>}
                      </span>
                      <span className="mt-5 flex items-baseline gap-2">
                        <Money value={b.price} minor className="font-display text-[40px] font-light leading-none tracking-[-1.2px]" symbolClassName={featured ? 'text-subtle' : undefined} />
                        {regular > b.price && <span className={cn('text-label line-through', featured ? 'opacity-60' : 'text-muted')}>{formatMoney(regular)}</span>}
                      </span>
                      <ul className="mt-5 space-y-2.5 text-[14px]">
                        {b.serviceCodes.map((c) => {
                          const s = services.find((x) => x.code === c);
                          return (
                            <li key={c} className="flex items-center gap-2.5">
                              <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', featured ? 'bg-on-ink text-ink' : 'bg-ink text-on-ink')}>
                                <CheckIcon size={13} strokeWidth={2.4} />
                              </span>
                              {s ? name(s) : c}
                            </li>
                          );
                        })}
                      </ul>
                      <span className={cn('mt-6 flex h-11 items-center justify-center rounded-pill text-[14px] font-medium', featured ? 'bg-accent text-on-accent' : 'bg-ink text-on-ink')}>{on ? t('promote.selected') : t('promote.choose')}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <section aria-labelledby="services-h">
            <h2 id="services-h" className="mb-3 text-h2">
              {t('promote.services')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {promoServices.map((s) => {
                const on = selected.includes(s.code);
                return (
                  <button key={s.code} type="button" aria-pressed={on} onClick={() => toggle(s.code)} className={cn('press flex items-start gap-3 rounded-lg bg-surface-raised p-4 text-left shadow-pill', on ? 'ring-[1.5px] ring-inset ring-ink' : 'hover:bg-surface-sunken')}>
                    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', on ? 'bg-ink text-on-ink' : 'bg-surface-sunken')}>{ICON[s.promotionType ?? ''] ?? <ArrowUpIcon size={20} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{name(s)}</span>
                      <span className="block text-caption text-muted">{s.description[locale] ?? s.description.az}</span>
                    </span>
                    <Money value={s.price} minor className="shrink-0 font-medium" />
                  </button>
                );
              })}
            </div>
          </section>
          {verification && !l.isVerified && (
            <Card className="flex flex-wrap items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
                <ShieldCheckIcon size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{name(verification)}</div>
                <p className="text-label font-normal text-ink-secondary">{verification.description[locale] ?? verification.description.az}</p>
              </div>
              <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
                <Money value={verification.price} minor />
              </Button>
            </Card>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <section className="glass rounded-xl p-6 shadow-raised" aria-labelledby="summary-h">
            <CardHeader id="summary-h" title={t('promote.summary')} />
            <ul className="space-y-2 text-[14px]">
              {bundle ? (
                <li className="flex justify-between gap-2">
                  <span>{name(bundles.find((b) => b.code === bundle)!)}</span>
                  <Money value={total} minor className="font-medium" />
                </li>
              ) : selected.length ? (
                selected.map((c) => {
                  const s = services.find((x) => x.code === c)!;
                  return (
                    <li key={c} className="flex justify-between gap-2">
                      <span>{name(s)}</span>
                      <Money value={s.price} minor className="font-medium" />
                    </li>
                  );
                })
              ) : (
                <li className="text-muted">{t('promote.nothingSelected')}</li>
              )}
            </ul>
            <div className="mt-4 flex items-end justify-between border-t border-hairline pt-4">
              <span className="font-medium">{t('booking.total')}</span>
              <Money value={total} minor className="font-display text-[30px] leading-none tracking-[-0.8px]" />
            </div>
            <div className="mt-5">
              <PayMethodPicker value={method} onChange={setMethod} amount={total} stacked />
            </div>
            <Button size="lg" className="mt-5 w-full" disabled={total === 0} loading={pay.isPending} onClick={() => pay.mutate()}>
              {t('promote.pay', { amount: formatMoney(total) })}
            </Button>
            <Link href={href(`/listings/${id}`)} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-pill text-[14px] font-medium text-ink-secondary hover:bg-pill">
              <ArrowLeftIcon size={16} /> {t('common.back')}
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
