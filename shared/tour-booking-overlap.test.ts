import { describe, expect, it } from 'vitest';
import { tourBookingOverlaps } from './tour-booking-overlap';

const booking = { id: 7, kitchenId: 40, referenceCode: 'KB-7', status: 'confirmed', bookingDate: '2026-10-08', startTime: '10:00', endTime: '12:00' };
const during = new Date('2026-10-08T13:00:00Z'); // 10:30 Newfoundland.
describe('tour booking decision context', () => {
  it('shows only active bookings in the target kitchen without private details', () => {
    const rows = [booking, { ...booking, id: 8, status: 'pending' }, { ...booking, id: 9, status: 'cancellation_requested' },
      { ...booking, id: 10, status: 'cancelled' }, { ...booking, id: 11, kitchenId: 41 }];
    expect(tourBookingOverlaps(rows, 40, during, 30).map(row => row.bookingId)).toEqual([7, 8, 9]);
    expect(Object.keys(tourBookingOverlaps(rows, 40, during, 30)[0]).sort()).toEqual(['bookingId', 'end', 'reference', 'start', 'status', 'timeUncertain']);
  });
  it('does not treat touching endpoints as an overlap', () => {
    expect(tourBookingOverlaps([booking], 40, new Date('2026-10-08T14:30:00Z'), 30)).toEqual([]);
    expect(tourBookingOverlaps([booking], 40, new Date('2026-10-08T12:00:00Z'), 30)).toEqual([]);
  });
  it('preserves gaps between selected booking slots', () => {
    const split = { ...booking, endTime: '14:00', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '13:00', endTime: '14:00' }] };
    expect(tourBookingOverlaps([split], 40, new Date('2026-10-08T14:00:00Z'), 30)).toEqual([]);
  });
  it('resolves after-midnight slots using the saved operating window', () => {
    const overnight = { ...booking, startTime: '23:00', endTime: '02:00', operatingWindowStartTime: '20:00',
      selectedSlots: [{ startTime: '00:00', endTime: '01:00' }] };
    expect(tourBookingOverlaps([overnight], 40, new Date('2026-10-09T03:00:00Z'), 30)[0]).toMatchObject({ start: '2026-10-09T02:30:00.000Z', end: '2026-10-09T03:30:00.000Z' });
  });
  it('supports legacy overnight bookings without a window snapshot', () => {
    expect(tourBookingOverlaps([{ ...booking, startTime: '23:00', endTime: '02:00' }], 40, new Date('2026-10-09T03:00:00Z'), 30)).toHaveLength(1);
  });
  it('marks the full possible interval for historical repeated wall times', () => {
    const repeated = { ...booking, bookingDate: '2026-11-01', startTime: '01:00', endTime: '01:30' };
    expect(tourBookingOverlaps([repeated], 40, new Date('2026-11-01T04:30:00Z'), 15)[0]).toMatchObject({ timeUncertain: true, start: '2026-11-01T03:30:00.000Z', end: '2026-11-01T05:00:00.000Z' });
  });
  it('requires review rather than silently omitting a nonexistent spring time', () => {
    expect(() => tourBookingOverlaps([{ ...booking, bookingDate: '2026-03-08', startTime: '02:00', endTime: '03:00' }], 40, during, 30)).toThrow('invalid local time');
  });
});
