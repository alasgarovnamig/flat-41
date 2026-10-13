'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { formatMoney, type ListingStatus, type MyListing } from '@evtap/shared';
import { api, type CreditKind, type ListingAction } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/account/PageHeader';
import { ListingBadges, usePriceLabel } from '@/components/listings/ListingCard';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, ErrorState, PageSpinner, Skeleton } from '@/components/ui/feedback';
import { ArrowUpIcon, ChartIcon, ChatIcon, EyeIcon, HeartIcon, HomeIcon, PhoneIcon, PlusIcon, SettingsIcon } from '@/components/ui/icons';
import { Img } from '@/components/ui/Img';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Tabs } from '@/components/ui/Tabs';

const TABS: ('ALL' | ListingStatus)[] = ['ALL', 'ACTIVE', 'PENDING', 'DRAFT', 'REJECTED', 'EXPIRED', 'SOLD', 'ARCHIVED'];
const STATUS_TONE: Record<ListingStatus, 'green' | 'gray' | 'urgent' | 'vip' | 'blue'> = {
  ACTIVE: 'green', PENDING: 'blue', DRAFT: 'vip', REJECTED: 'urgent', EXPIRED: 'gray', ARCHIVED: 'gray', SOLD: 'gray', BLOCKED: 'urgent',
};

function Row({ l }: { l: MyListing }) {
  const { t, href, date, number } = useI18n();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const price = usePriceLabel();
  const [confirm, setConfirm] = useState<ListingAction | null>(null);
  const [credits, setCredits] = useState(false);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['me', 'listings'] });
    refresh();
  };
  const action = useMutation({
    mutationFn: (a: ListingAction) => api.listings.action(l.id, a),
    onSuccess: (_r, a) => {
      toast.success(t(`myListings.done.${a}`));
      setConfirm(null);
      done();
    },
  });
  const credit = useMutation({
    mutationFn: (k: CreditKind) => api.listings.applyCredit(l.id, k),
    onSuccess: () => {
      toast.success(t('promote.creditApplied'));
      setCredits(false);
      done();
    },
  });
  const usage = user?.subscription?.usage;
  const hasCredits = !!usage && (usage.bumpsLeft > 0 || usage.vipCreditsLeft > 0 || usage.premiumCreditsLeft > 0);
  const s = l.status;

  return (
    <li className={cn('card overflow-hidden', l.isHighlighted && 'bg-highlight')}>
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <Link href={href(`/listings/${l.id}`)} className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-surface sm:w-48">
          <Img src={l.coverUrl} alt={l.title} fill sizes="200px" className="object-cover" />
          <ListingBadges l={l} className="absolute left-2 top-2" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-lg font-bold">{price(l)}</div>
              <Link href={href(`/listings/${l.id}`)} className="line-clamp-1 font-medium hover:text-brand">
                {l.title}
              </Link>
            </div>
            <Badge tone={STATUS_TONE[s]}>{t(`enums.listingStatus.${s}`)}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="flex items-center gap-1"><EyeIcon size={15} /> {number(l.views)}</span>
            <span className="flex items-center gap-1"><PhoneIcon size={15} /> {number(l.phoneViews)}</span>
            <span className="flex items-center gap-1"><HeartIcon size={15} /> {number(l.favoritesCount)}</span>
            {l.expiresAt && s === 'ACTIVE' && <span>{t('owner.expires', { date: date(l.expiresAt) })}</span>}
          </div>
          {l.promotions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {l.promotions.map((p) => (
                <Badge key={p.id} tone="brand">
                  {t(`enums.promotionType.${p.type}`)}
                  {p.endsAt ? ` · ${date(p.endsAt, { day: 'numeric', month: 'short' })}` : ''}
                </Badge>
              ))}
            </div>
          )}
          {s === 'REJECTED' && l.rejectionReason && <Alert tone="error" className="mt-3">{t('owner.rejected')}: {l.rejectionReason}</Alert>}
          {s === 'DRAFT' && <Alert tone="warning" className="mt-3">{t('owner.draft')}</Alert>}

          <div className="mt-3 flex flex-wrap gap-2">
            {s === 'DRAFT' && (
              <LinkButton size="sm" variant="vip" href={href(`/listings/${l.id}/pay`)}>
                {t('owner.payFee')}
              </LinkButton>
            )}
            {s === 'ACTIVE' && (
              <LinkButton size="sm" variant="premium" href={href(`/listings/${l.id}/promote`)} icon={<ArrowUpIcon size={14} />}>
                {t('owner.promote')}
              </LinkButton>
            )}
            {s === 'ACTIVE' && hasCredits && (
              <Button size="sm" variant="secondary" onClick={() => setCredits(true)}>
                {t('myListings.useCredit')}
              </Button>
            )}
            {['ACTIVE', 'PENDING', 'REJECTED', 'DRAFT', 'EXPIRED'].includes(s) && (
              <LinkButton size="sm" variant="outline" href={href(`/listings/${l.id}/edit`)} icon={<SettingsIcon size={14} />}>
                {t('common.edit')}
              </LinkButton>
            )}
            {s === 'ACTIVE' && (
              <LinkButton size="sm" variant="outline" href={href(`/listings/${l.id}/stats`)} icon={<ChartIcon size={14} />}>
                {t('owner.stats')}
              </LinkButton>
            )}
            {s === 'EXPIRED' && (
              <Button size="sm" variant="secondary" loading={action.isPending && action.variables === 'RENEW'} onClick={() => action.mutate('RENEW')}>
                {t('myListings.renew')}
              </Button>
            )}
            {s === 'ACTIVE' && (
              <Button size="sm" variant="ghost" onClick={() => setConfirm('MARK_SOLD')}>
                {l.dealType === 'SALE' ? t('myListings.markSold') : t('myListings.markRented')}
              </Button>
            )}
            {['ACTIVE', 'PENDING', 'REJECTED', 'EXPIRED', 'DRAFT'].includes(s) && (
              <Button size="sm" variant="ghost" className="text-urgent" onClick={() => setConfirm('ARCHIVE')}>
                {t('myListings.archive')}
              </Button>
            )}
            {(s === 'ARCHIVED' || s === 'SOLD') && (
              <Button size="sm" variant="secondary" loading={action.isPending} onClick={() => action.mutate('RESTORE')}>
                {t('myListings.restore')}
              </Button>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm ? t(`myListings.confirm.${confirm}`) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant={confirm === 'ARCHIVE' ? 'danger' : 'primary'} loading={action.isPending} onClick={() => confirm && action.mutate(confirm)}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{l.title}</p>
      </Modal>
      <Modal open={credits} onClose={() => setCredits(false)} size="sm" title={t('promote.credits')}>
        <div className="flex flex-col gap-2">
          {usage &&
            (
              [
                ['BUMP', usage.bumpsLeft, t('promote.creditBump')],
                ['VIP_7', usage.vipCreditsLeft, t('promote.creditVip')],
                ['PREMIUM_7', usage.premiumCreditsLeft, t('promote.creditPremium')],
              ] as [CreditKind, number, string][]
            ).map(([k, n, label]) => (
              <Button key={k} variant="outline" disabled={n <= 0} loading={credit.isPending && credit.variables === k} onClick={() => credit.mutate(k)} className="justify-between">
                <span>{label}</span>
                <span className="text-muted">{t('myListings.creditsLeft', { n })}</span>
              </Button>
            ))}
        </div>
      </Modal>
    </li>
  );
}

function MyListings() {
  const { t, href, number } = useI18n();
  const { user } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS.includes(sp.get('status') as ListingStatus) ? sp.get('status') : 'ALL') as (typeof TABS)[number];
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: qk.myListings(tab, page),
    queryFn: () => api.listings.mine({ status: tab === 'ALL' ? undefined : tab, page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  const quota = user?.quota;
  return (
    <div>
      <PageHeader
        title={t('account.nav.listings')}
        sub={
          quota && quota.remaining !== -1
            ? t('myListings.quota', { used: quota.used, total: quota.freeLimit, fee: formatMoney(quota.listingFee) })
            : quota
              ? t('myListings.unlimited')
              : undefined
        }
        actions={
          <LinkButton href={href('/listings/new')} icon={<PlusIcon size={18} />}>
            {t('nav.postAd')}
          </LinkButton>
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(v) => {
          setPage(1);
          router.replace(`${href('/account/listings')}${v === 'ALL' ? '' : `?status=${v}`}`, { scroll: false });
        }}
        tabs={TABS.map((s) => ({ value: s, label: s === 'ALL' ? t('common.all') : t(`enums.listingStatus.${s}`) }))}
      />
      {q.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState title={t('myListings.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<HomeIcon />} title={t('myListings.empty')} text={t('myListings.emptyText')} action={<LinkButton href={href('/listings/new')}>{t('nav.postAd')}</LinkButton>} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{t('myListings.total', { n: number(q.data.total) })}</p>
          <ul className="flex flex-col gap-3">
            {q.data.items.map((l) => (
              <Row key={l.id} l={l} />
            ))}
          </ul>
          <Pagination className="mt-6" page={page} total={q.data.total} pageSize={10} onChange={setPage} />
        </>
      )}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted">
        <ChatIcon size={14} /> {t('myListings.tip')}
      </p>
    </div>
  );
}

export default function MyListingsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <MyListings />
    </Suspense>
  );
}
