'use client';

import { useState } from 'react';
import { CAL_MONTHS, WEEKDAYS } from '@/lib/i18n';
import { cn, toIso, todayIso } from '@/lib/utils';
import { useI18n } from '@/components/providers/I18nProvider';
import { ChevronLeft, ChevronRight } from './icons';

export interface DayState { disabled?: boolean; selected?: boolean; inRange?: boolean; rangeStart?: boolean; rangeEnd?: boolean; marker?: 'blocked' | 'booked' }

function monthDays(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= days; d++) cells.push(toIso(new Date(year, month, d)));
  return cells;
}

/**
 * Month grid(s): selected = black circle, range = sunken pill band, blocked = hatched, booked = peach.
 * Used by the booking range picker and the host calendar.
 */
export function Calendar({ months = 1, dayState, onDayClick, initialMonth, onMonthChange }: { months?: number; dayState: (iso: string) => DayState; onDayClick: (iso: string) => void; initialMonth?: string; onMonthChange?: (firstIso: string) => void }) {
  const { locale, t } = useI18n();
  const init = initialMonth ? new Date(initialMonth + 'T00:00:00') : new Date();
  const [cursor, setCursor] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const weekdays = WEEKDAYS[locale];
  const monthTitle = (d: Date) => `${CAL_MONTHS[locale][d.getMonth()]} ${d.getFullYear()}`;
  const shift = (n: number) =>
    setCursor((c) => {
      const d = new Date(c.y, c.m + n, 1);
      onMonthChange?.(toIso(d));
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const today = todayIso();

  return (
    <div className="select-none">
      <div className={cn('grid gap-8', months > 1 && 'sm:grid-cols-2')}>
        {Array.from({ length: months }, (_, k) => {
          const d = new Date(cursor.y, cursor.m + k, 1);
          const cells = monthDays(d.getFullYear(), d.getMonth());
          return (
            <div key={k} className={cn(k > 0 && 'hidden sm:block')}>
              <div className="mb-3 flex h-11 items-center justify-between">
                {k === 0 ? (
                  <button type="button" onClick={() => shift(-1)} className="press flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken hover:bg-pill" aria-label={t('common.prev')}>
                    <ChevronLeft size={18} />
                  </button>
                ) : (
                  <span className="w-11" />
                )}
                <div className="font-display text-[17px] font-medium" aria-live="polite">
                  {monthTitle(d)}
                </div>
                {k === months - 1 || months === 1 ? (
                  <button type="button" onClick={() => shift(1)} className={cn('press flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken hover:bg-pill', months > 1 && k === 0 && 'sm:invisible')} aria-label={t('common.next')}>
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <button type="button" onClick={() => shift(1)} className="press flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken hover:bg-pill sm:invisible" aria-label={t('common.next')}>
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-7 text-center text-caption text-muted">
                {weekdays.map((w) => (
                  <div key={w} className="py-1.5">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1">
                {cells.map((iso, i) => {
                  if (!iso) return <div key={`b${i}`} />;
                  const s = dayState(iso);
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={s.disabled}
                      onClick={() => onDayClick(iso)}
                      aria-pressed={!!s.selected}
                      aria-label={iso}
                      className={cn(
                        'relative flex h-11 w-full items-center justify-center text-[14px]',
                        s.inRange && 'bg-surface-sunken',
                        s.rangeStart && 'rounded-l-pill',
                        s.rangeEnd && 'rounded-r-pill',
                        s.disabled && !s.marker && 'cursor-not-allowed text-subtle line-through',
                      )}
                    >
                      <span
                        className={cn(
                          'tabular flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                          !s.disabled && !s.selected && 'hover:bg-pill',
                          s.selected && 'bg-ink font-medium text-on-ink',
                          s.marker === 'booked' && 'bg-accent text-on-accent',
                          s.marker === 'blocked' && 'hatch bg-surface-sunken text-ink-secondary ring-1 ring-inset ring-subtle',
                          iso === today && !s.selected && 'font-semibold ring-1 ring-inset ring-ink',
                        )}
                      >
                        {Number(iso.slice(8))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Check-in / check-out range picker on top of <Calendar>. */
export function DateRangePicker({ checkIn, checkOut, onChange, isBlocked, months = 2, minNights = 1 }: { checkIn: string | null; checkOut: string | null; onChange: (ci: string | null, co: string | null) => void; isBlocked?: (iso: string) => boolean; months?: number; minNights?: number }) {
  const today = todayIso();
  const blocked = (iso: string) => iso < today || (isBlocked?.(iso) ?? false);
  const rangeHasBlocked = (a: string, b: string) => {
    const d = new Date(a + 'T00:00:00');
    const end = new Date(b + 'T00:00:00');
    while (d < end) {
      if (blocked(toIso(d))) return true;
      d.setDate(d.getDate() + 1);
    }
    return false;
  };
  const click = (iso: string) => {
    if (!checkIn || (checkIn && checkOut) || iso <= checkIn) {
      if (blocked(iso)) return;
      onChange(iso, null);
      return;
    }
    const nights = Math.round((Date.parse(iso) - Date.parse(checkIn)) / 86_400_000);
    if (rangeHasBlocked(checkIn, iso) || nights < minNights) {
      onChange(blocked(iso) ? null : iso, null);
      return;
    }
    onChange(checkIn, iso);
  };
  return (
    <Calendar
      months={months}
      initialMonth={checkIn ?? undefined}
      onDayClick={click}
      dayState={(iso) => {
        // check-out day may be a blocked night (guest leaves that morning)
        const disabled = iso < today || (blocked(iso) && !(checkIn && !checkOut && iso > checkIn && !rangeHasBlocked(checkIn, iso)));
        return {
          disabled,
          selected: iso === checkIn || iso === checkOut,
          inRange: !!(checkIn && checkOut && iso >= checkIn && iso <= checkOut),
          rangeStart: iso === checkIn,
          rangeEnd: iso === checkOut,
        };
      }}
    />
  );
}
