'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { addDays, todayIso } from '@/lib/utils';
import { PageHeader } from '@/components/account/PageHeader';
import { useI18n } from '@/components/providers/I18nProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, LinkButton } from '@/components/ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { CalendarIcon } from '@/components/ui/icons';

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
  if (!daily.length)
    return <EmptyState icon={<CalendarIcon />} title={t('calendar.empty')} text={t('calendar.emptyText')} action={<LinkButton href={href('/listings/new')}>{t('nav.postAd')}</LinkButton>} />;

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
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label={t('calendar.listing')} wrapperClass="min-w-64 flex-1" value={selected} onChange={(e) => router.replace(`${pathname}?listing=${e.target.value}`, { scroll: false })}>
          {daily.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </Select>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
      {avail.isError ? (
        <ErrorState title={t('booking.availabilityError')} text={errorMessage(avail.error, t)} onRetry={() => void avail.refetch()} retryLabel={t('common.retry')} />
      ) : avail.isLoading ? (
        <PageSpinner />
      ) : (
        <>
          <Calendar
            months={2}
            onDayClick={toggle}
            dayState={(iso) => ({
              disabled: iso < from || booked.has(iso),
              marker: booked.has(iso) ? 'booked' : blocked.has(iso) ? 'blocked' : undefined,
            })}
          />
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-urgent-50 ring-1 ring-urgent/40" /> {t('calendar.blocked')}</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-premium-50 ring-1 ring-premium/40" /> {t('calendar.booked')}</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white ring-1 ring-line" /> {t('calendar.free')}</span>
          </div>
          <p className="mt-2 text-sm text-muted">{t('calendar.hint')}</p>
        </>
      )}
    </div>
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
