import { TZDate } from '@date-fns/tz';
import { addWeeks, endOfISOWeek, getISOWeek, getISOWeekYear, startOfISOWeek } from 'date-fns';

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
