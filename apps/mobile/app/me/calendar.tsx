import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { radius, spacing, useTheme } from '@/theme';
import { Button, Card, EmptyState, ErrorState, Loading, Text } from '@/components/ui';
import { Calendar, type DayState } from '@/components/Calendar';
import { useToast } from '@/components/Toast';
import { addDays, isoDay } from '@/hooks/common';

const MONTHS = 6;

export default function HostCalendarScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <RequireAuth>{id ? <HostCalendar id={id} /> : <ChooseListing />}</RequireAuth>;
}

/** No listing given → pick one of the user's daily-rent listings. */
function ChooseListing() {
  const { c } = useTheme();
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.myListings('ACTIVE'), queryFn: () => api.myListings({ status: 'ACTIVE', pageSize: 100 }) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const daily = (q.data?.items ?? []).filter((l) => l.dealType === 'RENT_DAILY');
  if (!daily.length) return <EmptyState icon="calendar-outline" title={t('calendar.noDaily')} action={t('myListings.newListing')} onAction={() => router.push('/post')} />;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <Text muted>{t('calendar.chooseListing')}</Text>
      {daily.map((l) => (
        <Card key={l.id} onPress={() => router.push({ pathname: '/me/calendar', params: { id: l.id } })} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          {l.coverUrl && <Image source={{ uri: absUrl(l.coverUrl) }} style={{ width: 56, height: 56, borderRadius: radius.sm }} />}
          <Text style={{ flex: 1, fontWeight: '600' }} numberOfLines={2}>
            {l.title}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}

function HostCalendar({ id }: { id: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const today = isoDay(new Date());
  const until = addDays(today, MONTHS * 31);
  const q = useQuery({ queryKey: qk.availability(id), queryFn: () => api.availability(id, today, until) });
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data && !dirty) setBlocked(new Set(q.data.blockedDates));
  }, [q.data, dirty]);

  const booked = useMemo(() => {
    const s = new Set<string>();
    for (const r of q.data?.bookedRanges ?? []) for (let d = r.checkIn; d < r.checkOut; d = addDays(d, 1)) s.add(d);
    return s;
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.setAvailability(id, [...blocked].filter((d) => d >= today).sort()),
    onSuccess: (a) => {
      qc.setQueryData(qk.availability(id), a);
      setDirty(false);
      toast.success(t('common.saved'));
    },
    onError: toast.error,
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const dayState = (iso: string): DayState => (iso < today ? 'past' : booked.has(iso) ? 'booked' : blocked.has(iso) ? 'blocked' : 'normal');
  const toggle = (iso: string) => {
    if (booked.has(iso)) return;
    setDirty(true);
    setBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 }}>
        <Text muted>{t('calendar.hint')}</Text>
        <View style={styles.legend}>
          <Legend color={c.danger + '33'} label={t('calendar.blocked')} />
          <Legend color={c.surface} label={t('calendar.booked')} strike />
          <Legend color="transparent" label={t('calendar.free')} />
        </View>
        <Calendar months={MONTHS} dayState={dayState} onDayPress={toggle} />
      </ScrollView>
      <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.border }]}>
        <Button title={t('common.save')} disabled={!dirty} loading={save.isPending} onPress={() => save.mutate()} />
      </View>
    </View>
  );
}

function Legend({ color, label, strike }: { color: string; label: string; strike?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: color, borderWidth: 1, borderColor: c.border }} />
      <Text variant="small" style={strike ? { textDecorationLine: 'line-through' } : undefined}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
