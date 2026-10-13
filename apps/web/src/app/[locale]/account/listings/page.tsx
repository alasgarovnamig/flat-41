'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { formatMoney, type ListingStatus, type MyListing } from '@evtap/shared';
import { api, type CreditKind, type ListingAction } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { listingStatusTone } from '@/lib/status';
import { cn, locationLabel } from '@/lib/utils';
import {
  Badge, Button, DataTable, EmptyState, ErrorState, LinkButton, MenuItem, Modal, PageHeader, PageSpinner, Pagination, PillTabs, Popover, Price, RowCard,
  StatusPill, TableThumb, iconButtonClass, type Column,
} from '@/components/ds';
import {
  ArchiveIcon, ArrowUpIcon, ArrowUpRightIcon, ChartIcon, CheckIcon, EditIcon, EyeIcon, FilterIcon, HeartIcon, HomeIcon, PhoneIcon, PlusIcon, RefreshIcon, SparklesIcon, WalletIcon,
} from '@/components/ds/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

const TABS: ('ALL' | ListingStatus)[] = ['ALL', 'ACTIVE', 'PENDING', 'DRAFT', 'REJECTED', 'EXPIRED', 'SOLD', 'ARCHIVED'];

/** Trailing action button (sliders icon, like the reference "Action" column) → menu with every listing action. */
function RowActions({ l }: { l: MyListing }) {
  const { t, href } = useI18n();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
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
    <>
      <Popover
        align="right"
        width="w-64"
        trigger={({ open, toggle, id }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="menu" aria-label={t('common.actions')} title={t('common.actions')} className={iconButtonClass('raised', 'sm')}>
            <FilterIcon size={17} />
          </button>
        )}
      >
        {(close) => (
          <div role="menu" aria-label={t('common.actions')}>
            <MenuItem href={href(`/listings/${l.id}`)} icon={<ArrowUpRightIcon size={18} />} onClick={close}>
              {t('myListings.open')}
            </MenuItem>
            {s === 'DRAFT' && (
              <MenuItem href={href(`/listings/${l.id}/pay`)} icon={<WalletIcon size={18} />} onClick={close}>
                {t('owner.payFee')}
              </MenuItem>
            )}
            {s === 'ACTIVE' && (
              <MenuItem href={href(`/listings/${l.id}/promote`)} icon={<ArrowUpIcon size={18} />} onClick={close}>
                {t('owner.promote')}
              </MenuItem>
            )}
            {s === 'ACTIVE' && hasCredits && (
              <MenuItem icon={<SparklesIcon size={18} />} onClick={() => { close(); setCredits(true); }}>
                {t('myListings.useCredit')}
              </MenuItem>
            )}
            {['ACTIVE', 'PENDING', 'REJECTED', 'DRAFT', 'EXPIRED'].includes(s) && (
              <MenuItem href={href(`/listings/${l.id}/edit`)} icon={<EditIcon size={18} />} onClick={close}>
                {t('common.edit')}
              </MenuItem>
            )}
            {s === 'ACTIVE' && (
              <MenuItem href={href(`/listings/${l.id}/stats`)} icon={<ChartIcon size={18} />} onClick={close}>
                {t('owner.stats')}
              </MenuItem>
            )}
            {s === 'EXPIRED' && (
              <MenuItem icon={<RefreshIcon size={18} />} onClick={() => { close(); action.mutate('RENEW'); }}>
                {t('myListings.renew')}
              </MenuItem>
            )}
            {s === 'ACTIVE' && (
              <MenuItem icon={<CheckIcon size={18} />} onClick={() => { close(); setConfirm('MARK_SOLD'); }}>
                {l.dealType === 'SALE' ? t('myListings.markSold') : t('myListings.markRented')}
              </MenuItem>
            )}
            {(s === 'ARCHIVED' || s === 'SOLD') && (
              <MenuItem icon={<RefreshIcon size={18} />} onClick={() => { close(); action.mutate('RESTORE'); }}>
                {t('myListings.restore')}
              </MenuItem>
            )}
            {['ACTIVE', 'PENDING', 'REJECTED', 'EXPIRED', 'DRAFT'].includes(s) && (
              <MenuItem danger icon={<ArchiveIcon size={18} />} onClick={() => { close(); setConfirm('ARCHIVE'); }}>
                {t('myListings.archive')}
              </MenuItem>
            )}
          </div>
        )}
      </Popover>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm ? t(`myListings.confirm.${confirm}`) : ''}
        sub={l.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant={confirm === 'ARCHIVE' ? 'destructive' : 'primary'} loading={action.isPending} onClick={() => confirm && action.mutate(confirm)}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-label text-ink-secondary">{confirm === 'ARCHIVE' ? t('myListings.archiveHint') : t('myListings.soldHint')}</p>
      </Modal>
      <Modal open={credits} onClose={() => setCredits(false)} size="sm" title={t('promote.credits')} sub={l.title}>
        <div className="flex flex-col gap-2">
          {usage &&
            (
              [
                ['BUMP', usage.bumpsLeft, t('promote.creditBump')],
                ['VIP_7', usage.vipCreditsLeft, t('promote.creditVip')],
                ['PREMIUM_7', usage.premiumCreditsLeft, t('promote.creditPremium')],
              ] as [CreditKind, number, string][]
            ).map(([k, n, label]) => (
              <Button key={k} variant="outline" size="lg" disabled={n <= 0} loading={credit.isPending && credit.variables === k} onClick={() => credit.mutate(k)} className="justify-between">
                <span>{label}</span>
                <span className="text-label text-muted">{t('myListings.creditsLeft', { n })}</span>
              </Button>
            ))}
        </div>
      </Modal>
    </>
  );
}

function Metrics({ l }: { l: MyListing }) {
  const { number } = useI18n();
  return (
    <span className="tabular flex items-center gap-3 text-label text-ink-secondary">
      <span className="flex items-center gap-1"><EyeIcon size={15} /> {number(l.views)}</span>
      <span className="flex items-center gap-1"><PhoneIcon size={15} /> {number(l.phoneViews)}</span>
      <span className="flex items-center gap-1"><HeartIcon size={15} /> {number(l.favoritesCount)}</span>
    </span>
  );
}

function MyListings() {
  const { t, href, number, locale, date } = useI18n();
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

  const sub = (l: MyListing) => (
    <>
      {l.status === 'REJECTED' && l.rejectionReason ? (
        <span className="text-danger">{t('owner.rejected')}: {l.rejectionReason}</span>
      ) : l.status === 'DRAFT' ? (
        <span className="text-warning">{t('owner.draft')}</span>
      ) : l.expiresAt && l.status === 'ACTIVE' ? (
        t('owner.expires', { date: date(l.expiresAt) })
      ) : (
        locationLabel(l, locale)
      )}
    </>
  );

  const columns: Column<MyListing>[] = [
    { key: 'name', header: t('overview.colListing'), cell: (l) => <TableThumb src={l.coverUrl} title={l.title} sub={sub(l)} href={href(`/listings/${l.id}`)} /> },
    { key: 'deal', header: t('listing.facts.dealType'), cell: (l) => t(`enums.dealType.${l.dealType}`), minWidth: 'xl' },
    { key: 'price', header: t('search.price'), cell: (l) => <Price l={l} className="font-medium" /> },
    { key: 'metrics', header: t('stats.title'), cell: (l) => <Metrics l={l} />, minWidth: 'lg' },
    {
      key: 'promo',
      header: t('myListings.promotions'),
      minWidth: 'xl',
      cell: (l) =>
        l.promotions.length ? (
          <span className="flex flex-wrap gap-1">
            {l.promotions.map((p) => (
              <Badge key={p.id} tone={p.type === 'VIP' ? 'vip' : p.type === 'PREMIUM' ? 'premium' : 'neutral'}>
                {t(`enums.promotionType.${p.type}`)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: 'status', header: t('common.status'), cell: (l) => <StatusPill tone={listingStatusTone(l.status)}>{t(`enums.listingStatus.${l.status}`)}</StatusPill> },
    { key: 'action', header: <span className="sr-only">{t('common.actions')}</span>, align: 'right', cell: (l) => <RowActions l={l} /> },
  ];

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
      <PillTabs
        className="mb-4"
        size="sm"
        ariaLabel={t('common.status')}
        value={tab}
        onChange={(v) => {
          setPage(1);
          router.replace(`${href('/account/listings')}${v === 'ALL' ? '' : `?status=${v}`}`, { scroll: false });
        }}
        tabs={TABS.map((s) => ({ value: s, label: s === 'ALL' ? t('common.all') : t(`enums.listingStatus.${s}`) }))}
      />
      {q.isError ? (
        <ErrorState title={t('myListings.loadError')} text={errorMessage(q.error, t)} onRetry={() => void q.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <DataTable
            caption={t('account.nav.listings')}
            loading={q.isLoading}
            columns={columns}
            rows={q.data?.items}
            rowKey={(l) => l.id}
            toolbar={q.data ? <p className="px-2 text-label font-normal text-muted">{t('myListings.total', { n: number(q.data.total) })}</p> : undefined}
            empty={
              <EmptyState className="shadow-none" icon={<HomeIcon />} title={t('myListings.empty')} text={t('myListings.emptyText')} action={<LinkButton href={href('/listings/new')} icon={<PlusIcon size={18} />}>{t('nav.postAd')}</LinkButton>} />
            }
            mobileRow={(l) => (
              <RowCard>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <TableThumb src={l.coverUrl} title={l.title} sub={<Price l={l} />} href={href(`/listings/${l.id}`)} />
                  </div>
                  <RowActions l={l} />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Metrics l={l} />
                  <StatusPill tone={listingStatusTone(l.status)}>{t(`enums.listingStatus.${l.status}`)}</StatusPill>
                </div>
                {l.status === 'REJECTED' && l.rejectionReason && <p className="mt-2 text-caption text-danger">{l.rejectionReason}</p>}
              </RowCard>
            )}
            footer={q.data && <Pagination className="mt-4" page={page} total={q.data.total} pageSize={10} onChange={setPage} labels={{ prev: t('common.prev'), next: t('common.next'), nav: t('common.pagination') }} />}
          />
        </div>
      )}
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
