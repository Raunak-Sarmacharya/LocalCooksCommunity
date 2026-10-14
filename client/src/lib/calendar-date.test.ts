import { describe, expect, it } from 'vitest';
import { calendarDateKey, formatCalendarDate } from './calendar-date';

describe('calendar dates', () => {
  it('keeps the calendar day for UTC midnight, noon and plain dates', () => {
    for (const value of ['2026-10-14', '2026-10-14T00:00:00.000Z', '2026-10-14T12:00:00.000Z']) {
      expect(formatCalendarDate(value, 'en-CA')).toBe('Wed, Oct 14');
    }
  });
  it('formats UTC midnight as that day, not the day before', () => {
    expect(formatCalendarDate('2026-10-16T00:00:00.000Z', 'en-CA')).toBe('Fri, Oct 16');
  });
  it('accepts Date values and rejects junk', () => {
    expect(calendarDateKey(new Date('2026-10-14T00:00:00Z'))).toBe('2026-10-14');
    expect(calendarDateKey('not a date')).toBeNull();
    expect(formatCalendarDate('')).toBe('');
    expect(formatCalendarDate(undefined)).toBe('');
  });
  it('supports custom formats and locales', () => {
    expect(formatCalendarDate('2026-10-14', 'en-CA', { month: 'long', day: 'numeric', year: 'numeric' })).toBe('October 14, 2026');
    expect(formatCalendarDate('2026-10-14', 'fr-CA')).toMatch(/14/);
  });
});
