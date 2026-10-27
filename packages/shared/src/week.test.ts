import { describe, expect, it } from 'vitest';
import { currentAndNextWeek, isoWeekKey, isoWeekRange, overlaps } from './week.js';

describe('week', () => {
  it('uses Danish local time at the Sunday/Monday boundary', () => {
    // Sunday 23:30 UTC is already Monday 00:30 in Copenhagen (winter time).
    expect(isoWeekKey(new Date('2026-11-01T23:30:00Z'))).toBe('2026-W45');
    expect(isoWeekKey(new Date('2026-11-01T22:30:00Z'))).toBe('2026-W44');
  });

  it('returns Monday to Sunday in Copenhagen', () => {
    const range = isoWeekRange(new Date('2026-10-28T12:00:00Z'));
    expect(range.key).toBe('2026-W44');
    // 26 Oct 2026 is after the DST switch, so Copenhagen is UTC+1.
    expect(range.start.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-01T22:59:59.999Z');
  });

  it('handles the year boundary', () => {
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    const [, next] = currentAndNextWeek(new Date('2026-12-30T12:00:00Z'));
    expect(next?.key).toBe('2027-W01');
  });

  it('detects overlap with a week', () => {
    const range = isoWeekRange(new Date('2026-10-28T12:00:00Z'));
    expect(overlaps('2026-10-22T22:00:00+0000', '2026-10-29T22:59:59+0000', range)).toBe(true);
    expect(overlaps('2026-10-15T22:00:00+0000', '2026-10-22T22:59:59+0000', range)).toBe(false);
  });
});
