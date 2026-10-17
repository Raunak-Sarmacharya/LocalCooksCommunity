import { describe, expect, it } from 'vitest';
import { datedOccupiedSlots, occupiedOperatingDates, pairBufferMinutes, slotBlock } from './booking-occupancy';
import { tourBookingOverlaps } from './tour-booking-overlap';
import { activeBookingIdsOnOperatingDate, bookingsAffectedByWeeklyChange } from './operating-schedule';
import { earlyStartOptions, sessionExtensionOptions } from './session-extension';
import { matchingLocalInstants } from './booking-dst';

const TZ = 'America/St_Johns';
const at = (date: string, startTime: string, endTime: string, windowStartTime = '08:00') => ({ date, windowStartTime, startTime, endTime });

describe('pair buffer: the larger of the two saved buffers, never their sum', () => {
  it('uses max, and the current setting for rows saved before snapshots', () => {
    expect(pairBufferMinutes(60, 120, 0)).toBe(120);
    expect(pairBufferMinutes(120, 60, 0)).toBe(120);
    expect(pairBufferMinutes(0, 0, 120)).toBe(0); // both snapshotted Off: today's setting does not apply
    expect(pairBufferMinutes(null, 0, 60)).toBe(60); // legacy row: today's behavior
    expect(pairBufferMinutes(null, null, 0)).toBe(0);
  });

  it.each([[0, '12:00', null], [60, '13:00', null], [60, '12:59', 'buffer'], [120, '14:00', null], [120, '13:59', 'buffer']] as const)(
    'with %s minutes after a 12:00 end, a %s start is %s', (buffer, start, expected) => {
      const [h, m] = start.split(':').map(Number);
      const end = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      expect(slotBlock(at('2099-10-04', '11:00', '12:00'), at('2099-10-04', start, end), buffer, TZ)).toBe(expected);
    });

  it('is symmetric: the gap is also kept before a later booking', () => {
    expect(slotBlock(at('2099-10-04', '14:00', '15:00'), at('2099-10-04', '12:00', '13:00'), 60, TZ)).toBeNull();
    expect(slotBlock(at('2099-10-04', '14:00', '15:00'), at('2099-10-04', '12:30', '13:30'), 60, TZ)).toBe('buffer');
  });

  it('reports actual overlap before spacing, even with no buffer', () => {
    expect(slotBlock(at('2099-10-04', '10:00', '11:00'), at('2099-10-04', '10:00', '11:00'), 0, TZ)).toBe('overlap');
  });

  it('spaces an overnight tail from the next operating date', () => {
    const tail = at('2099-10-03', '01:00', '02:00', '22:00'); // 02:00 on Oct 4
    expect(slotBlock(tail, at('2099-10-04', '02:00', '03:00', '02:00'), 60, TZ)).toBe('buffer');
    expect(slotBlock(tail, at('2099-10-04', '03:00', '04:00', '02:00'), 60, TZ)).toBeNull();
  });

  it('measures the gap in real time across the spring-forward night', () => {
    // 01:00 → 03:00 on 2026-03-08 is one real hour in St. John's (02:00 does not exist).
    expect(slotBlock(at('2026-03-07', '00:00', '01:00', '20:00'), at('2026-03-08', '03:00', '04:00', '03:00'), 60, TZ)).toBeNull();
    expect(slotBlock(at('2026-03-07', '00:00', '01:00', '20:00'), at('2026-03-08', '03:00', '04:00', '03:00'), 120, TZ)).toBe('buffer');
  });
});

describe('dated occupancy reaches later days', () => {
  const dated = { bookingDate: new Date('2099-10-01T12:00:00Z'), startTime: '10:00', endTime: '12:00', operatingWindowStartTime: '08:00',
    selectedSlots: [{ date: '2099-10-01', windowStartTime: '08:00', startTime: '10:00', endTime: '12:00' },
      { date: '2099-10-08', windowStartTime: '22:00', startTime: '23:00', endTime: '00:00' }] };
  it('keeps each day\'s own date and anchor', () => {
    expect(datedOccupiedSlots(dated)).toEqual([at('2099-10-01', '10:00', '12:00'), at('2099-10-08', '23:00', '00:00', '22:00')]);
    expect(Array.from(occupiedOperatingDates(dated)).sort()).toEqual(['2099-10-01', '2099-10-08']);
  });
  it('legacy rows still read the parent date and anchor', () => {
    expect(datedOccupiedSlots({ bookingDate: '2099-10-01', startTime: '10:00', endTime: '12:00' })).toEqual([at('2099-10-01', '10:00', '12:00', '10:00')]);
  });
  it('tours see a later day of a dated booking (context only)', () => {
    const start = new Date(matchingLocalInstants('2099-10-08', '23:15', TZ)[0]);
    const overlaps = tourBookingOverlaps([{ ...dated, id: 7, kitchenId: 4, referenceCode: 'KB-7', status: 'confirmed' }], 4, start, 30, TZ);
    expect(overlaps.map(item => item.bookingId)).toEqual([7]);
    expect(tourBookingOverlaps([{ ...dated, id: 7, kitchenId: 4, referenceCode: 'KB-7', status: 'confirmed' }], 4,
      new Date(matchingLocalInstants('2099-10-05', '11:00', TZ)[0]), 30, TZ)).toEqual([]);
  });
  it('schedule edits find bookings by every dated day, not only the first', () => {
    const rows = [{ id: 7, bookingDate: dated.bookingDate, status: 'confirmed', selectedSlots: dated.selectedSlots }];
    expect(activeBookingIdsOnOperatingDate(rows, '2099-10-08')).toEqual([7]);
    expect(activeBookingIdsOnOperatingDate(rows, '2099-10-05')).toEqual([]);
    const thursday = new Date('2099-10-08T12:00:00Z').getUTCDay();
    const week = (open: boolean) => [{ dayOfWeek: thursday, isAvailable: open, startTime: '08:00', endTime: '20:00' }];
    expect(bookingsAffectedByWeeklyChange(week(true), week(false), [], rows, '2099-10-02')).toEqual([7]);
  });
});

describe('added time keeps each neighbour\'s pair buffer', () => {
  const base = { operatingDate: '2099-10-04', windowStartTime: '08:00', windowEndTime: '20:00', timezone: TZ, durationMinutes: 120,
    maxMinutes: null, occupied: [], hourlyRateCents: 6000, ratios: { subtotalCents: 12000, taxCents: 0, commissionCents: 0 } };
  const instant = (time: string) => matchingLocalInstants('2099-10-04', time, TZ)[0];
  const next = (bufferMinutes?: number) => [{ start: instant('14:00'), end: instant('15:00'), ...(bufferMinutes === undefined ? {} : { bufferMinutes }) }];
  const endAt = new Date(instant('12:00')).toISOString();
  const last = (bufferMinutes?: number) => sessionExtensionOptions({ ...base, endTime: '12:00', endAt, turnoverOccupied: next(bufferMinutes) }).at(-1)?.endTime;
  it('a 2 h pair buffer stops added time at the next booking minus 2 h; 1 h at minus 1 h; legacy callers 60', () => {
    expect(last(120)).toBeUndefined();
    expect(last(60)).toBe('13:00');
    expect(last(undefined)).toBe('13:00');
    expect(last(0)).toBe('14:00');
  });
  it('an earlier start keeps the gap after the previous booking', () => {
    const before = [{ start: instant('09:00'), end: instant('10:00'), bufferMinutes: 60 }];
    const options = earlyStartOptions({ ...base, startTime: '12:00', startAt: new Date(instant('12:00')).toISOString(), turnoverOccupied: before });
    expect(options.map(option => option.startTime)).toContain('11:00');
    expect(options.map(option => option.startTime)).not.toContain('10:45');
  });
});
