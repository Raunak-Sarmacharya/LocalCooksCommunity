import { describe, expect, it } from 'vitest';
import { minutesByWeek, weekStartDate, weeklyQuotaMessage, weeklyQuotaShortfalls } from './kitchen-booking-quota';

const slot = (date: string, startTime: string, endTime: string, windowStartTime = '08:00') => ({ date, windowStartTime, startTime, endTime });
const hours = (date: string, from: number, to: number, windowStartTime = '08:00') =>
  Array.from({ length: to - from }, (_, index) => {
    const start = (from + index) % 24, end = (from + index + 1) % 24;
    return slot(date, `${String(start).padStart(2, '0')}:00`, `${String(end).padStart(2, '0')}:00`, windowStartTime);
  });

describe('weekly hours: Monday 00:00 to next Monday 00:00, kitchen wall clock', () => {
  it('starts every week on Monday', () => {
    expect(weekStartDate('2026-10-19')).toBe('2026-10-19'); // Monday
    expect(weekStartDate('2026-10-25')).toBe('2026-10-19'); // Sunday
    expect(weekStartDate('2026-10-26')).toBe('2026-10-26');
    expect(weekStartDate('2027-01-01')).toBe('2026-12-28'); // across a year end
  });

  it('splits an overnight Sunday visit at Monday 00:00', () => {
    const weeks = minutesByWeek(hours('2026-10-25', 22, 26, '22:00'));
    expect(weeks.get('2026-10-19')).toBe(120);
    expect(weeks.get('2026-10-26')).toBe(120);
  });

  it('counts scheduled wall-clock hours across a DST change, never a fixed 168 elapsed hours', () => {
    // St. John's springs forward on Sunday 2026-03-08 and falls back on Sunday 2026-11-01.
    expect(minutesByWeek(hours('2026-03-08', 9, 17)).get('2026-03-02')).toBe(480);
    expect(minutesByWeek(hours('2026-11-01', 9, 17)).get('2026-10-26')).toBe(480);
    // Sunday night into the DST Monday still splits at the wall-clock Monday 00:00.
    expect(Object.fromEntries(minutesByWeek(hours('2026-03-08', 23, 25, '22:00')))).toEqual({ '2026-03-02': 60, '2026-03-09': 60 });
  });

  it('counts a full day as that day\'s opening hours (its whole-window slots)', () => {
    expect(minutesByWeek(hours('2026-10-20', 8, 16)).get('2026-10-19')).toBe(480);
  });

  it('keeps legacy envelopes and partial-hour extension slots exact', () => {
    expect(minutesByWeek([slot('2026-10-20', '10:00', '12:30')]).get('2026-10-19')).toBe(150);
  });
});

describe('weekly shortfalls', () => {
  const counted = new Map([['2026-10-19', 6 * 60]]);
  it('rejects 6 used + 3 new against 8, accepts +2 and an exact fill', () => {
    expect(weeklyQuotaShortfalls(8, counted, new Map([['2026-10-19', 180]]))).toEqual([{ weekStart: '2026-10-19', weekEnd: '2026-10-25',
      limitMinutes: 480, countedMinutes: 360, requestedMinutes: 180, remainingMinutes: 120 }]);
    expect(weeklyQuotaShortfalls(8, counted, new Map([['2026-10-19', 120]]))).toEqual([]);
  });
  it('treats each week on its own and returns every failing week', () => {
    const requested = new Map([['2026-10-19', 180], ['2026-10-26', 180], ['2026-11-02', 600]]);
    expect(weeklyQuotaShortfalls(8, counted, requested).map(week => week.weekStart)).toEqual(['2026-10-19', '2026-11-02']);
  });
  it('null limit is unlimited', () => {
    expect(weeklyQuotaShortfalls(null, counted, new Map([['2026-10-19', 10_000]]))).toEqual([]);
  });
  it('explains the week, what is counted and what the request adds', () => {
    const [week] = weeklyQuotaShortfalls(8, counted, new Map([['2026-10-19', 180]]));
    expect(weeklyQuotaMessage(week)).toBe('You have used or booked 6 of 8 hours at this kitchen for Oct 19–25. These days add 3 hours. '
      + 'Choose fewer hours or ask the kitchen to override.');
    const [crossing] = weeklyQuotaShortfalls(1, new Map(), new Map([['2026-10-26', 120]]));
    expect(weeklyQuotaMessage(crossing)).toContain('for Oct 26–Nov 1.');
  });
});
