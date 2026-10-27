import { TZDate } from '@date-fns/tz';
import { addDays, addWeeks, endOfISOWeek, getISOWeek, getISOWeekYear, setISOWeek, setISOWeekYear, startOfISOWeek } from 'date-fns';

export const TIME_ZONE = 'Europe/Copenhagen';

/** ISO week key such as `2026-W44`, evaluated in Danish local time. */
export function isoWeekKey(date: Date): string {
  const local = new TZDate(date, TIME_ZONE);
  return `${getISOWeekYear(local)}-W${String(getISOWeek(local)).padStart(2, '0')}`;
}

/** Monday 00:00 to Sunday 23:59:59.999 Danish time for the week containing `date`. */
export function isoWeekRange(date: Date): { key: string; start: Date; end: Date } {
  const local = new TZDate(date, TIME_ZONE);
  return {
    key: isoWeekKey(date),
    start: new Date(startOfISOWeek(local).getTime()),
    end: new Date(endOfISOWeek(local).getTime()),
  };
}

/** The current and the following ISO week. */
export function currentAndNextWeek(now: Date) {
  return [isoWeekRange(now), isoWeekRange(addWeeks(new TZDate(now, TIME_ZONE), 1))];
}

export function overlaps(fromIso: string, toIso: string, range: { start: Date; end: Date }): boolean {
  return new Date(fromIso) <= range.end && new Date(toIso) >= range.start;
}

/** Resolves "current", "next" or an ISO week key like `2026-W45` to a key, relative to `now`. */
export function resolveWeekKey(week: string | undefined, now: Date): string {
  if (!week || week === 'current') return isoWeekKey(now);
  if (week === 'next') return isoWeekKey(addWeeks(new TZDate(now, TIME_ZONE), 1));
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error(`Invalid week: ${week}`);
  return week;
}

/** The seven dates (YYYY-MM-DD, Monday first) of an ISO week key such as `2026-W45`. */
export function isoWeekDates(weekKey: string): string[] {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`Invalid ISO week: ${weekKey}`);
  // Noon avoids any DST edge when stepping through days.
  const anchor = setISOWeek(setISOWeekYear(new Date(Date.UTC(Number(match[1]), 0, 4, 12)), Number(match[1])), Number(match[2]));
  const monday = startOfISOWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}
