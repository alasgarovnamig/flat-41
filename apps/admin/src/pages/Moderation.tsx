import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ChevronDown, ChevronUp, ExternalLink, Flag, Keyboard, PartyPopper, X } from 'lucide-react';
import * as api from '../api/client';
import { useAction } from '../api/queries';
import { Gallery, ListingFacts, OwnerCard, PromoBadges, ReportsList, Thumb, listingPrice } from '../components/listing';
import { Modal } from '../components/Modal';
import { BLOCK_PRESETS, REJECT_PRESETS, ReasonDialog } from '../components/ReasonDialog';
import { Badge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, Kbd, PageHeader, Skeleton, SkeletonBlock, cx } from '../components/ui';
import { listingSiteUrl } from '../env';
import { useT } from '../i18n';
import { cityName, enumLabel, fmtDateTime, fmtRelative, shortId } from '../lib/format';
import { useHotkeys } from '../lib/hooks';

export default function ModerationPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const queue = useQuery({
    queryKey: ['admin', 'listings', { status: 'PENDING', pageSize: 100 }],
    queryFn: () => api.listAdminListings({ status: 'PENDING', pageSize: 100 }),
    refetchInterval: 60_000,
  });
  // ids handled in this session are hidden immediately (optimistic), before the refetch lands
  const [done, setDone] = useState<Set<string>>(new Set());
  const items = useMemo(
    () => (queue.data?.items ?? []).filter((l) => !done.has(l.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), // oldest first (FIFO)
    [queue.data, done],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idx = Math.max(0, items.findIndex((l) => l.id === selectedId));
  const current = items[idx] ?? null;
  useEffect(() => {
    if (items.length && (!selectedId || !items.some((l) => l.id === selectedId))) setSelectedId(items[Math.min(idx, items.length - 1)].id);
  }, [items, selectedId, idx]);

  const detail = useQuery({ queryKey: ['admin', 'listing', current?.id], queryFn: () => api.getAdminListing(current!.id), enabled: !!current });
  // prefetch the next listing for instant switching
  useEffect(() => {
    const next = items[idx + 1];
    if (next) void qc.prefetchQuery({ queryKey: ['admin', 'listing', next.id], queryFn: () => api.getAdminListing(next.id) });
  }, [items, idx, qc]);

  const [photo, setPhoto] = useState(0);
  useEffect(() => setPhoto(0), [current?.id]);
  const [dialog, setDialog] = useState<'reject' | 'block' | 'help' | null>(null);

  const advance = useCallback(
    (id: string) => {
      const pos = items.findIndex((l) => l.id === id);
      const next = items[pos + 1] ?? items[pos - 1] ?? null;
      setDone((s) => new Set(s).add(id));
      setSelectedId(next?.id ?? null);
      setDialog(null);
    },
    [items],
  );
  const invalidate = [['admin', 'listings'], ['admin', 'overview'], ['admin', 'listing']];
  const approve = useAction((id: string) => api.approveListing(id), { success: t('Listing approved'), invalidate, onSuccess: (_, id) => advance(id) });
  const reject = useAction((v: { id: string; reason: string }) => api.rejectListing(v.id, v.reason), { success: t('Listing rejected'), invalidate, onSuccess: (_, v) => advance(v.id) });
  const block = useAction((v: { id: string; reason: string }) => api.blockListing(v.id, v.reason), { success: t('Listing blocked'), invalidate, onSuccess: (_, v) => advance(v.id) });
  const busy = approve.isPending || reject.isPending || block.isPending;

  const images = useMemo(() => {
    const d = detail.data;
    if (!d) return [];
    if (d.images?.length) return [...d.images].sort((a, b) => a.order - b.order);
    return d.coverUrl ? [{ url: d.coverUrl, thumbUrl: d.coverUrl }] : [];
  }, [detail.data]);

  const hotkeys = useMemo(
    () => ({
      j: () => items[idx + 1] && setSelectedId(items[idx + 1].id),
      ArrowDown: () => items[idx + 1] && setSelectedId(items[idx + 1].id),
      k: () => idx > 0 && setSelectedId(items[idx - 1].id),
      ArrowUp: () => idx > 0 && setSelectedId(items[idx - 1].id),
      ArrowRight: () => images.length && setPhoto((p) => (p + 1) % images.length),
      ArrowLeft: () => images.length && setPhoto((p) => (p - 1 + images.length) % images.length),
      a: () => current && !busy && approve.mutate(current.id),
      r: () => current && setDialog('reject'),
      b: () => current && setDialog('block'),
      o: () => current && nav(`/listings/${current.id}`),
      v: () => current && window.open(listingSiteUrl(current.id), '_blank', 'noopener'),
      '?': () => setDialog('help'),
    }),
    [items, idx, images.length, current, busy, approve, nav],
  );
  useHotkeys(hotkeys, dialog === null);

  // only subtract handled items the (possibly stale) server page still contains, so a refetch doesn't double-count
  const total = queue.data ? Math.max(0, queue.data.total - queue.data.items.filter((l) => done.has(l.id)).length) : undefined;

  return (
    <div>
      <PageHeader
        title={t('Moderation queue')}
        subtitle={total != null ? t('{n} listings waiting for review · oldest first', { n: total }) : t('Pending listings')}
        actions={
          <Button size="sm" variant="ghost" icon={<Keyboard className="size-4" />} onClick={() => setDialog('help')}>
            {t('Shortcuts')} <Kbd>?</Kbd>
          </Button>
        }
      />

      {queue.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Card bodyClassName="p-2">
            <SkeletonBlock rows={8} />
          </Card>
          <Card>
            <Skeleton className="aspect-[16/9] w-full" />
            <SkeletonBlock rows={5} />
          </Card>
        </div>
      ) : queue.error ? (
        <Card>
          <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<PartyPopper className="size-6" />} title={t('Queue is empty')} hint={t('All listings have been reviewed. New submissions appear here automatically.')} />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr]">
          {/* queue list */}
          <aside className="rounded-xl border border-line bg-card lg:sticky lg:top-[72px]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
              <span>
                {idx + 1} / {items.length}
              </span>
              <span className="flex gap-1">
                <button className="rounded p-1 hover:bg-hover disabled:opacity-40" disabled={idx === 0} onClick={() => setSelectedId(items[idx - 1].id)} aria-label={t('Previous')}>
                  <ChevronUp className="size-4" />
                </button>
                <button className="rounded p-1 hover:bg-hover disabled:opacity-40" disabled={idx >= items.length - 1} onClick={() => setSelectedId(items[idx + 1].id)} aria-label={t('Next')}>
                  <ChevronDown className="size-4" />
                </button>
              </span>
            </div>
            <ul className="max-h-[260px] overflow-y-auto p-1.5 lg:max-h-[calc(100vh-150px)]" role="listbox" aria-label={t('Pending listings')}>
              {items.map((l) => (
                <li key={l.id}>
                  <button
                    role="option"
                    aria-selected={l.id === current?.id}
                    onClick={() => setSelectedId(l.id)}
                    className={cx('flex w-full gap-2.5 rounded-lg p-2 text-left', l.id === current?.id ? 'bg-brand-soft' : 'hover:bg-hover')}
                  >
                    <Thumb url={l.coverUrl} className="h-12 w-16" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{l.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {listingPrice(l)} · {cityName(l.cityId)}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                        {fmtRelative(l.createdAt)}
                        {l.reportsCount > 0 && (
                          <Badge tone="danger" className="!px-1.5 !py-0 !text-[10px]">
                            <Flag className="size-2.5" />
                            {l.reportsCount}
                          </Badge>
                        )}
                        {l.isBusiness && <Badge tone="brand" className="!px-1.5 !py-0 !text-[10px]">{t('Business')}</Badge>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* review panel */}
          <div className="min-w-0 space-y-4">
            {/* sticky action bar (top, always visible while scrolling the listing) */}
            {current && (
              <div className="sticky top-[64px] z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-elevated/95 p-2.5 shadow-sm backdrop-blur">
                <Button variant="success" loading={approve.isPending} disabled={busy} onClick={() => approve.mutate(current.id)} icon={<Check className="size-4" />}>
                  {t('Approve')} <kbd className="!border-white/40 !bg-transparent !text-white/90">A</kbd>
                </Button>
                <Button variant="danger-soft" disabled={busy} onClick={() => setDialog('reject')} icon={<X className="size-4" />}>
                  {t('Reject')} <Kbd>R</Kbd>
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setDialog('block')} icon={<Ban className="size-4" />}>
                  {t('Block')} <Kbd>B</Kbd>
                </Button>
                <span className="ml-auto hidden text-xs text-muted sm:inline">
                  <Kbd>J</Kbd>/<Kbd>K</Kbd> {t('next / previous')} · <Kbd>←</Kbd>
                  <Kbd>→</Kbd> {t('photos')}
                </span>
              </div>
            )}
            {detail.isLoading || !current ? (
              <Card>
                <Skeleton className="aspect-[16/9] w-full" />
                <div className="mt-4">
                  <SkeletonBlock rows={6} />
                </div>
              </Card>
            ) : detail.error ? (
              <Card>
                <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
              </Card>
            ) : detail.data ? (
              <>
                <Card bodyClassName="p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold">{detail.data.title}</h2>
                      <p className="mt-0.5 text-sm text-muted">
                        {enumLabel(detail.data.dealType)} · {enumLabel(detail.data.propertyType)} · {cityName(detail.data.cityId)} · {t('submitted {d}', { d: fmtDateTime(detail.data.createdAt) })} · #{shortId(detail.data.id)}
                      </p>
                      <div className="mt-1.5 empty:hidden">
                        <PromoBadges l={detail.data} />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-semibold tabular-nums">{listingPrice(detail.data)}</p>
                      <div className="mt-1 flex justify-end gap-3 text-sm">
                        <Link to={`/listings/${detail.data.id}`} className="text-brand-fg hover:underline">
                          {t('Edit')} <Kbd>O</Kbd>
                        </Link>
                        <a href={listingSiteUrl(detail.data.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-fg hover:underline">
                          {t('Site')} <ExternalLink className="size-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                  <Gallery images={images} index={photo} onIndex={setPhoto} />
                </Card>
                <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                  <Card title={t('Details')}>
                    <ListingFacts l={detail.data} />
                  </Card>
                  <div className="space-y-4">
                    <Card title={t('Owner')}>
                      <OwnerCard l={detail.data} />
                    </Card>
                    <Card title={`${t('Reports')} (${detail.data.reports?.length ?? 0})`}>
                      <ReportsList reports={detail.data.reports ?? []} />
                    </Card>
                  </div>
                </div>
              </>
            ) : null}

          </div>
        </div>
      )}

      {current && (
        <>
          <ReasonDialog
            open={dialog === 'reject'}
            title={t('Reject listing')}
            presets={REJECT_PRESETS}
            confirmLabel={t('Reject')}
            busy={reject.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(reason) => reject.mutate({ id: current.id, reason })}
          />
          <ReasonDialog
            open={dialog === 'block'}
            title={t('Block listing')}
            presets={BLOCK_PRESETS}
            confirmLabel={t('Block')}
            busy={block.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={(reason) => block.mutate({ id: current.id, reason })}
          />
        </>
      )}
      <Modal open={dialog === 'help'} onClose={() => setDialog(null)} title={t('Keyboard shortcuts')} size="sm">
        <ul className="space-y-2 text-sm">
          {[
            ['A', t('Approve')],
            ['R', t('Reject with reason')],
            ['B', t('Block')],
            ['J / ↓', t('Next listing')],
            ['K / ↑', t('Previous listing')],
            ['← / →', t('Previous / next photo')],
            ['O', t('Open full edit page')],
            ['V', t('View on site')],
            ['1–6', t('Pick a reason in the dialog')],
          ].map(([k, label]) => (
            <li key={k} className="flex justify-between">
              <span>{label}</span>
              <Kbd>{k}</Kbd>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
