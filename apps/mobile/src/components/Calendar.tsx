import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, useTheme } from '../theme';
import { Text } from './ui';
import { isoDay } from '../hooks/common';

export type DayState = 'normal' | 'disabled' | 'past' | 'booked' | 'blocked' | 'start' | 'end' | 'inRange' | 'single';

/** Month grid calendar (Monday first). The parent decides each day's state. */
function CalendarBase({ months = 6, from, dayState, onDayPress }: { months?: number; from?: Date; dayState: (iso: string) => DayState; onDayPress: (iso: string) => void }) {
  const { c } = useTheme();
  const i18n = useI18n();
  const start = from ?? new Date();
  const grid = useMemo(() => {
    const out: { key: string; title: string; cells: (string | null)[] }[] = [];
    for (let m = 0; m < months; m++) {
      const first = new Date(start.getFullYear(), start.getMonth() + m, 1);
      const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const lead = (first.getDay() + 6) % 7; // Monday = 0
      const cells: (string | null)[] = Array(lead).fill(null);
      for (let d = 1; d <= daysInMonth; d++) cells.push(isoDay(new Date(first.getFullYear(), first.getMonth(), d)));
      while (cells.length % 7) cells.push(null);
      out.push({ key: `${first.getFullYear()}-${first.getMonth()}`, title: `${i18n.months[first.getMonth()]} ${first.getFullYear()}`, cells });
    }
    return out;
  }, [months, start.getFullYear(), start.getMonth(), i18n.months]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.week}>
        {i18n.weekdays.map((w) => (
          <Text key={w} variant="caption" muted style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      {grid.map((month) => (
        <View key={month.key} style={{ gap: spacing.xs }}>
          <Text variant="h3" style={{ marginBottom: spacing.xs }}>
            {month.title}
          </Text>
          <View style={styles.grid}>
            {month.cells.map((iso, i) => {
              if (!iso) return <View key={`e${i}`} style={styles.cell} />;
              const st = dayState(iso);
              const inactive = st === 'disabled' || st === 'past' || st === 'booked';
              const isEdge = st === 'start' || st === 'end' || st === 'single';
              const bg =
                isEdge ? c.primary : st === 'inRange' ? c.primarySoft : st === 'blocked' ? c.danger + '22' : st === 'booked' ? c.surface : 'transparent';
              const color = isEdge ? c.onPrimary : inactive ? c.muted : st === 'blocked' ? c.danger : c.text;
              return (
                <Pressable
                  key={iso}
                  disabled={st === 'past' || st === 'disabled'}
                  onPress={() => onDayPress(iso)}
                  accessibilityRole="button"
                  accessibilityLabel={iso}
                  accessibilityState={{ disabled: inactive, selected: isEdge || st === 'inRange' }}
                  style={styles.cell}
                >
                  <View style={[styles.day, { backgroundColor: bg }, st === 'inRange' && { borderRadius: 0 }]}>
                    <Text
                      style={[
                        { color, fontWeight: isEdge ? '700' : '500' },
                        (st === 'booked' || st === 'disabled') && { textDecorationLine: 'line-through' },
                      ]}
                    >
                      {Number(iso.slice(8))}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

export const Calendar = memo(CalendarBase);

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  day: { flex: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
});
