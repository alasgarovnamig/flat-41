'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BUNDLES, SERVICE_CATALOG, formatMoney, type BundleDef, type PaymentMethod, type ServiceDef } from '@evtap/shared';
import { api, type CreditKind } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { followCheckout, paymentReturnUrl } from '@/lib/payments';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { usePriceLabel } from '@/components/listings/ListingCard';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, ErrorState, PageSpinner } from '@/components/ui/feedback';
import { ArrowUpIcon, BoltIcon, CheckIcon, CrownIcon, ShieldCheckIcon, StarIcon } from '@/components/ui/icons';
import { Img } from '@/components/ui/Img';
import { PayMethodPicker } from './PayMethod';

const ICON: Record<string, React.ReactNode> = {
  BUMP: <ArrowUpIcon />,
  AUTO_BUMP: <ArrowUpIcon />,
  VIP: <CrownIcon className="text-vip" />,
  PREMIUM: <CrownIcon className="text-premium" />,
  HIGHLIGHT: <StarIcon className="text-vip" />,
  URGENT: <BoltIcon className="text-urgent" />,
};

export function PromoteView({ id }: { id: string }) {
  const { t, locale, href } = useI18n();
  const { user, refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const price = usePriceLabel();
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
    mutationFn: () =>
      api.payments.checkout({
        purpose: 'PROMOTION',
        listingId: id,
        ...(bundle ? { bundleCode: bundle } : { serviceCodes: selected }),
        method,
        returnUrl: paymentReturnUrl(locale),
      }),
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
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('promote.title')}</h1>
      <p className="mt-1 text-muted">{t('promote.subtitle')}</p>

      <div className="mt-5 flex items-center gap-4 rounded-card border border-line bg-white p-3">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg">
          <Img src={l.coverUrl} alt={l.title} fill sizes="96px" className="object-cover" />
        </div>
        <div className="min-w-0">
          <div className="font-bold">{price(l)}</div>
          <div className="truncate text-sm text-muted">{l.title}</div>
        </div>
        {l.status !== 'ACTIVE' && <Badge tone="gray" className="ml-auto">{t(`enums.listingStatus.${l.status}`)}</Badge>}
      </div>
      {l.status !== 'ACTIVE' && <Alert tone="warning" className="mt-3">{t('promote.notActive')}</Alert>}
      {catalog.isError && <Alert tone="warning" className="mt-3">{t('promote.catalogFallback')}</Alert>}

      {usage && (usage.bumpsLeft > 0 || usage.vipCreditsLeft > 0 || usage.premiumCreditsLeft > 0) && (
        <section className="mt-6 rounded-card border border-brand/30 bg-brand-50 p-4">
          <h2 className="font-semibold text-brand-dark">{t('promote.credits')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ['BUMP', usage.bumpsLeft, t('promote.creditBump')],
                ['VIP_7', usage.vipCreditsLeft, t('promote.creditVip')],
                ['PREMIUM_7', usage.premiumCreditsLeft, t('promote.creditPremium')],
              ] as [CreditKind, number, string][]
            )
              .filter(([, n]) => n > 0)
              .map(([k, n, label]) => (
                <Button key={k} variant="white" loading={credit.isPending && credit.variables === k} onClick={() => credit.mutate(k)}>
                  {label} <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{n}</span>
                </Button>
              ))}
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          {bundles.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">{t('promote.bundles')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {bundles.map((b) => {
                  const regular = b.serviceCodes.reduce((s, c) => s + (services.find((x) => x.code === c)?.price ?? 0), 0);
                  const on = bundle === b.code;
                  return (
                    <button
                      key={b.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSelected([]);
                        setBundle(on ? null : b.code);
                      }}
                      className={cn('relative rounded-card border p-4 text-left transition', on ? 'border-premium bg-premium-50 ring-1 ring-premium' : 'border-line bg-white hover:border-ink/30')}
                    >
                      {regular > b.price && <span className="absolute right-3 top-3 rounded-full bg-urgent px-2 py-0.5 text-xs font-bold text-white">−{Math.round((1 - b.price / regular) * 100)}%</span>}
                      <div className="font-semibold">{name(b)}</div>
                      <ul className="mt-2 space-y-1 text-sm text-muted">
                        {b.serviceCodes.map((c) => {
                          const s = services.find((x) => x.code === c);
                          return (
                            <li key={c} className="flex items-center gap-1.5">
                              <CheckIcon size={14} className="text-brand" /> {s ? name(s) : c}
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-xl font-bold">{formatMoney(b.price)}</span>
                        {regular > b.price && <span className="text-sm text-muted line-through">{formatMoney(regular)}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('promote.services')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {promoServices.map((s) => {
                const on = selected.includes(s.code);
                return (
                  <button key={s.code} type="button" aria-pressed={on} onClick={() => toggle(s.code)} className={cn('flex items-start gap-3 rounded-card border p-4 text-left transition', on ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line bg-white hover:border-ink/30')}>
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface">{ICON[s.promotionType ?? ''] ?? <ArrowUpIcon />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{name(s)}</span>
                      <span className="block text-xs text-muted">{s.description[locale] ?? s.description.az}</span>
                    </span>
                    <span className="shrink-0 font-bold">{formatMoney(s.price)}</span>
                  </button>
                );
              })}
            </div>
          </section>
          {verification && !l.isVerified && (
            <section className="rounded-card border border-line bg-white p-4">
              <div className="flex items-start gap-3">
                <ShieldCheckIcon className="mt-0.5 shrink-0 text-brand" />
                <div className="flex-1">
                  <div className="font-semibold">{name(verification)}</div>
                  <p className="text-sm text-muted">{verification.description[locale] ?? verification.description.az}</p>
                </div>
                <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
                  {formatMoney(verification.price)}
                </Button>
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <h2 className="font-semibold">{t('promote.summary')}</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {bundle ? (
                <li className="flex justify-between gap-2">
                  <span>{name(bundles.find((b) => b.code === bundle)!)}</span>
                  <span className="font-semibold">{formatMoney(total)}</span>
                </li>
              ) : selected.length ? (
                selected.map((c) => {
                  const s = services.find((x) => x.code === c)!;
                  return (
                    <li key={c} className="flex justify-between gap-2">
                      <span>{name(s)}</span>
                      <span className="font-semibold">{formatMoney(s.price)}</span>
                    </li>
                  );
                })
              ) : (
                <li className="text-muted">{t('promote.nothingSelected')}</li>
              )}
            </ul>
            <div className="mt-4 flex justify-between border-t border-line pt-3 text-lg font-bold">
              <span>{t('booking.total')}</span>
              <span>{formatMoney(total)}</span>
            </div>
            <div className="mt-4">
              <PayMethodPicker value={method} onChange={setMethod} amount={total} stacked />
            </div>
            <Button size="lg" className="mt-4 w-full" disabled={total === 0} loading={pay.isPending} onClick={() => pay.mutate()}>
              {t('promote.pay', { amount: formatMoney(total) })}
            </Button>
            <a href={href(`/listings/${id}`)} className="mt-3 block text-center text-sm font-semibold text-muted hover:text-ink">
              {t('common.back')}
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
