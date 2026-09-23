import { describe, expect, it } from 'vitest';
import { activeBookingIdsOnOperatingDate, bookingsAffectedByWeeklyChange, hasOverlappingOperatingDays } from './operating-schedule';

describe('operating schedule neighbors', () => {
  const weekly = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek, isAvailable: true, startTime: '08:00', endTime: '01:00',
  }));

  it('allows the same 08:00-01:00 window every day', () => {
    expect(hasOverlappingOperatingDays(weekly, [])).toBe(false);
  });

  it('rejects an override that opens inside the previous day tail', () => {
    expect(hasOverlappingOperatingDays(weekly, [{
      specificDate: '2026-10-04', isAvailable: true, startTime: '00:00', endTime: '07:00',
    }])).toBe(true);
  });

  it('respects a closed previous operating day', () => {
    expect(hasOverlappingOperatingDays(weekly, [
      { specificDate: '2026-10-03', isAvailable: false, startTime: '00:00', endTime: '00:00' },
      { specificDate: '2026-10-04', isAvailable: true, startTime: '00:00', endTime: '07:00' },
    ])).toBe(false);
  });
});

describe('weekly schedule booking review', () => {
  const before = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek, isAvailable: true, startTime: '08:00', endTime: '01:00',
  }));

  it('warns for bookings on a changed operating day, including its overnight tail', () => {
    const after = before.map(day => day.dayOfWeek === 2 ? { ...day, isAvailable: false } : day);
    expect(bookingsAffectedByWeeklyChange(before, after, [], [
      { id: 1, bookingDate: '2026-10-05', status: 'confirmed' }, // Monday 23:00–Tuesday 01:00
      { id: 2, bookingDate: '2026-10-06', status: 'confirmed' }, // Tuesday operating day
      { id: 3, bookingDate: '2026-10-06', status: 'cancelled' },
    ], '2026-10-01')).toEqual([2]);
  });

  it('does not warn when a date override already controls the booking day', () => {
    const after = before.map(day => day.dayOfWeek === 2 ? { ...day, endTime: '22:00' } : day);
    expect(bookingsAffectedByWeeklyChange(before, after, [{ specificDate: '2026-10-07' }], [
      { id: 4, bookingDate: '2026-10-07', status: 'pending' },
    ], '2026-10-01')).toEqual([]);
  });
});

it('a date closure reviews its operating-day bookings and leaves the previous overnight tail intact', () => {
  const bookings = [
    { id: 1, bookingDate: '2026-10-05', status: 'confirmed' }, // Ends early Tuesday
    { id: 2, bookingDate: '2026-10-06', status: 'pending' },
    { id: 3, bookingDate: '2026-10-06', status: 'cancelled' },
  ];
  expect(activeBookingIdsOnOperatingDate(bookings, '2026-10-06')).toEqual([2]);
});
