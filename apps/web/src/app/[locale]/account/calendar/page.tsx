'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { addDays, todayIso } from '@/lib/utils';
import { Button, Calendar, Card, EmptyState, ErrorState, LinkButton, PageHeader, PageSpinner, Select } from '@/components/ds';
import { CalendarIcon, PlusIcon } from '@/components/ds/icons';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-pill bg-surface-raised px-3 text-label shadow-pill">
      <span className={`h-4 w-4 rounded-full ${swatch}`} aria-hidden /> {label}
    </span>
  );
}

function HostCalendar() {
  const { t, href } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const listings = useQuery({ queryKey: ['me', 'listings', 'daily'], queryFn: () => api.listings.mine({ page: 1, pageSize: 100 }) });
  const daily = useMemo(() => (listings.data?.items ?? []).filter((l) => l.dealType === 'RENT_DAILY' && !['ARCHIVED', 'SOLD'].includes(l.status)), [listings.data]);
  const selected = sp.get('listing') ?? daily[0]?.id ?? '';
  const from = todayIso();
  const to = addDays(from, 365);
  const avail = useQuery({ queryKey: qk.availability(selected, from, to), queryFn: () => api.listings.availability(selected, { from, to }), enabled: !!selected });
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setBlocked(new Set(avail.data?.blockedDates ?? []));
    setDirty(false);
  }, [avail.data]);
  const booked = useMemo(() => {
    const s = new Set<string>();
    for (const r of avail.data?.bookedRanges ?? []) for (let d = r.checkIn; d < r.checkOut; d = addDays(d, 1)) s.add(d);
    return s;
  }, [avail.data]);
  const save = useMutation({
    mutationFn: () => api.listings.setAvailability(selected, [...blocked].filter((d) => d >= from).sort()),
    onSuccess: (a) => {
      qc.setQueryData(qk.availability(selected, from, to), a);
      toast.success(t('calendar.saved'));
    },
  });

  if (listings.isLoading) return <PageSpinner />;
  if (listings.isError) return <ErrorState title={t('myListings.loadError')} text={errorMessage(listings.error, t)} onRetry={() => void listings.refetch()} retryLabel={t('common.retry')} />;
  if (!daily.length) return <EmptyState icon={<CalendarIcon />} title={t('calendar.empty')} text={t('calendar.emptyText')} action={<LinkButton href={href('/listings/new')} icon={<PlusIcon size={18} />}>{t('nav.postAd')}</LinkButton>} />;

  const toggle = (iso: string) => {
    if (booked.has(iso) || iso < from) return;
    setBlocked((s) => {
      const n = new Set(s);
      if (n.has(iso)) n.delete(iso);
      else n.add(iso);
      return n;
    });
    setDirty(true);
  };

  return (
    <Card>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Select label={t('calendar.listing')} wrapperClass="min-w-64 flex-1" value={selected} onChange={(e) => router.replace(`${pathname}?listing=${e.target.value}`, { scroll: false })}>
          {daily.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </Select>
        <Button size="lg" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
      {avail.isError ? (
        <ErrorState title={t('booking.availabilityError')} text={errorMessage(avail.error, t)} onRetry={() => void avail.refetch()} retryLabel={t('common.retry')} />
      ) : avail.isLoading ? (
        <PageSpinner />
      ) : (
        <>
          <div className="rounded-lg bg-surface-raised p-4 shadow-pill sm:p-6">
            <Calendar
              months={2}
              onDayClick={toggle}
              dayState={(iso) => ({
                disabled: iso < from || booked.has(iso),
                marker: booked.has(iso) ? 'booked' : blocked.has(iso) ? 'blocked' : undefined,
              })}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Legend swatch="hatch bg-surface-sunken ring-1 ring-subtle" label={t('calendar.blocked')} />
            <Legend swatch="bg-accent" label={t('calendar.booked')} />
            <Legend swatch="bg-surface-raised ring-1 ring-hairline" label={t('calendar.free')} />
          </div>
          <p className="mt-3 text-label font-normal text-ink-secondary">{t('calendar.hint')}</p>
        </>
      )}
    </Card>
  );
}

export default function CalendarPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t('account.nav.calendar')} sub={t('calendar.sub')} />
      <Suspense fallback={<PageSpinner />}>
        <HostCalendar />
      </Suspense>
    </div>
  );
}
