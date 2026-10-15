import { describe, expect, it } from 'vitest';
import { formatBookedDuration } from './booked-duration';
import { bookedMinutes } from './booking-header-state';

describe('formatBookedDuration', () => {
  it.each([
    [20, '20 min'], [60, '1 hr'], [90, '1 hr 30 min'], [120, '2 hrs'], [150, '2 hrs 30 min'], [0, '0 min'],
  ])('en-CA: %i minutes reads "%s"', (minutes, text) => expect(formatBookedDuration(minutes, 'en-CA')).toBe(text));
  it('fr-CA and uk use their own short units', () => {
    expect(formatBookedDuration(90, 'fr-CA')).toBe('1 h 30 min');
    expect(formatBookedDuration(120, 'fr-CA')).toBe('2 h');
    expect(formatBookedDuration(90, 'uk')).toBe('1 год 30 хв');
    expect(formatBookedDuration(20, 'uk')).toBe('20 хв');
  });
  it('never prints a fraction of an hour (the old "0.33 hrs")', () => {
    const minutes = bookedMinutes({ startTime: '10:00', endTime: '10:20' });
    expect(minutes).toBe(20);
    expect(formatBookedDuration(minutes, 'en-CA')).toBe('20 min');
  });
  it('counts every visit and overnight spans', () => {
    expect(bookedMinutes({ visits: [{ startTime: '09:00', endTime: '10:30' }, { startTime: '13:00', endTime: '14:15' }] })).toBe(165);
    expect(bookedMinutes({ startTime: '22:00', endTime: '01:30' })).toBe(210);
    expect(bookedMinutes({ closeoutVisits: [{ scheduledStartAt: '2026-10-14T21:00:00Z', scheduledEndAt: '2026-10-14T21:20:00Z' }] })).toBe(20);
  });
});
