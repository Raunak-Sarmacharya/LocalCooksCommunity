import { describe, expect, it } from 'vitest';
import { bookingStartDateKey, calendarDateKey, formatCalendarDate } from './calendar-date';

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

describe('bookingStartDateKey', () => {
  it('labels an overnight slot with the calendar day it starts on', () => {
    // 139: window opens 06:00 on Wed Oct 14, slot 00:15 is Thu Oct 15.
    expect(bookingStartDateKey({ bookingDate: '2026-10-14T00:00:00.000Z', startTime: '00:15', operatingWindowStartTime: '06:00' })).toBe('2026-10-15');
    expect(formatCalendarDate(bookingStartDateKey({ bookingDate: '2026-10-14', startTime: '00:15', operatingWindowStartTime: '06:00' }), 'en-CA')).toBe('Thu, Oct 15');
  });
  it('keeps the operating day for ordinary daytime slots', () => {
    expect(bookingStartDateKey({ bookingDate: '2026-10-14', startTime: '10:00', operatingWindowStartTime: '06:00' })).toBe('2026-10-14');
    expect(bookingStartDateKey({ bookingDate: '2026-10-14', startTime: '10:00' })).toBe('2026-10-14');
    expect(bookingStartDateKey({ bookingDate: null, startTime: '10:00' })).toBeNull();
  });
});
