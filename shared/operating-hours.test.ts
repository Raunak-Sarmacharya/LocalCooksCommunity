import { describe, expect, it } from 'vitest';
import { addHour, getHourlySlotStarts, isRangeWithinOperatingWindow, isSlotCoveredByRange, minutesInOperatingWindow } from './operating-hours';

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
});
