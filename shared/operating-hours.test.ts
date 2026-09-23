import { describe, expect, it } from 'vitest';
import { addHour, getHourlySlotStarts, intervalsOverlapOnOperatingDay, isRangeWithinOperatingWindow, isSlotCoveredByRange, minutesInOperatingWindow, sortTimesInOperatingWindow, normalizeBookingSlots, occupiedIntervals, calendarDateForOperatingTime, calendarDateForBookingTime, isValidOperatingWindow, operatingWindowsOverlapAcrossDays, operatingSlotsOverlapAcrossDates } from './operating-hours';

describe('overnight operating hours', () => {
  it('builds all 17 First Point slots from 08:00 through midnight', () => {
    expect(getHourlySlotStarts('08:00', '01:00')).toEqual([
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
      '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
      '00:00',
    ]);
  });

  it('builds hourly slots through midnight in operating-day order', () => {
    expect(getHourlySlotStarts('22:00', '01:00')).toEqual(['22:00', '23:00', '00:00']);
    expect(addHour('23:00')).toBe('00:00');
  });

  it('validates and compares overnight ranges on one operating-day timeline', () => {
    expect(isRangeWithinOperatingWindow('08:00', '01:00', '08:00', '01:00')).toBe(true);
    expect(isRangeWithinOperatingWindow('00:00', '01:00', '08:00', '01:00')).toBe(true);
    expect(isRangeWithinOperatingWindow('01:00', '02:00', '08:00', '01:00')).toBe(false);
    expect(isSlotCoveredByRange('00:00', '23:00', '01:00', '08:00')).toBe(true);
    expect(minutesInOperatingWindow('00:00', '08:00')).toBe(24 * 60);
  });

  it('detects overnight booking overlap including the post-midnight tail', () => {
    const overnight = { startTime: '08:00', endTime: '01:00' };
    expect(intervalsOverlapOnOperatingDay(overnight, { startTime: '10:00', endTime: '11:00' }, '08:00')).toBe(true);
    expect(intervalsOverlapOnOperatingDay(overnight, { startTime: '00:00', endTime: '01:00' }, '08:00')).toBe(true);
    expect(intervalsOverlapOnOperatingDay(overnight, { startTime: '01:00', endTime: '02:00' }, '08:00')).toBe(false);
    expect(sortTimesInOperatingWindow(['00:00', '23:00'], '08:00')).toEqual(['23:00', '00:00']);
  });
});

describe('booking slot contract', () => {
  const slot = (startTime: string) => ({ startTime, endTime: addHour(startTime) });

  it('keeps separate hourly slots and releases the gap', () => {
    expect(normalizeBookingSlots([slot('09:00'), slot('14:00')], '09:00', '15:00', '08:00', '01:00', false))
      .toEqual([slot('09:00'), slot('14:00')]);
    expect(occupiedIntervals({ startTime: '09:00', endTime: '15:00', selectedSlots: [slot('09:00'), slot('14:00')] }))
      .toEqual([slot('09:00'), slot('14:00')]);
  });

  it('detects a saved overnight tail against a later operating day after schedule changes', () => {
    const tail = { startTime: '00:00', endTime: '01:00' };
    expect(operatingSlotsOverlapAcrossDates('2026-09-25', tail, '08:00', '2026-09-26', tail, '00:00')).toBe(true);
    expect(operatingSlotsOverlapAcrossDates('2026-09-25', tail, '08:00', '2026-09-26', { startTime: '01:00', endTime: '02:00' }, '00:00')).toBe(false);
  });

  it('requires the entire overnight operating day for daily pricing', () => {
    expect(() => normalizeBookingSlots([slot('08:00')], '08:00', '09:00', '08:00', '01:00', true))
      .toThrow('full operating day');
    expect(normalizeBookingSlots([], '08:00', '01:00', '08:00', '01:00', true)).toHaveLength(17);
  });

  it('rejects duplicates, partial hours, and a mismatched envelope', () => {
    expect(() => normalizeBookingSlots([slot('09:00'), slot('09:00')], '09:00', '10:00', '08:00', '17:00', false)).toThrow();
    expect(() => normalizeBookingSlots([{ startTime: '09:00', endTime: '09:30' }], '09:00', '09:30', '08:00', '17:00', false)).toThrow();
    expect(() => normalizeBookingSlots([slot('09:00')], '09:00', '11:00', '08:00', '17:00', false)).toThrow();
  });

  it('maps the after-midnight tail to the following calendar date', () => {
    expect(calendarDateForOperatingTime('2026-09-25', '00:00', '08:00')).toBe('2026-09-26');
    expect(calendarDateForOperatingTime('2026-09-25', '23:00', '08:00')).toBe('2026-09-25');
    expect(calendarDateForBookingTime('2026-09-25', '00:00', '08:00')).toBe('2026-09-26');
    expect(calendarDateForBookingTime('2026-09-25', '01:00', null, '23:00')).toBe('2026-09-26');
  });

  it('rejects overlapping neighboring operating days', () => {
    expect(operatingWindowsOverlapAcrossDays(
      { isAvailable: true, startTime: '08:00', endTime: '01:00' },
      { isAvailable: true, startTime: '00:00', endTime: '08:00' },
    )).toBe(true);
    expect(operatingWindowsOverlapAcrossDays(
      { isAvailable: true, startTime: '08:00', endTime: '01:00' },
      { isAvailable: true, startTime: '08:00', endTime: '01:00' },
    )).toBe(false);
  });

  it('accepts overnight whole-hour windows and rejects partial or zero-length windows', () => {
    expect(isValidOperatingWindow('08:00', '01:00')).toBe(true);
    expect(isValidOperatingWindow('08:30', '01:30')).toBe(true);
    expect(isValidOperatingWindow('08:30', '01:00')).toBe(false);
    expect(isValidOperatingWindow('08:00', '08:00')).toBe(false);
  });
});
