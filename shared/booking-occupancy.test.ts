import { describe, expect, it } from 'vitest';
import { bookingIntervalsConflict, operatingSlotInstants } from './booking-occupancy';
const zone = 'America/St_Johns';
describe('turnover occupancy in real instants', () => {
  it('pads on both sides and allows adjacent bookings when disabled', () => {
    const interval = { start: 10 * 3600000, end: 11 * 3600000 };
    expect(bookingIntervalsConflict(interval, { start: interval.end, end: interval.end + 3600000 }, 60)).toBe(true);
    expect(bookingIntervalsConflict(interval, { start: interval.end, end: interval.end + 3600000 }, 0)).toBe(false);
    // Exactly an hour free on either side is allowed; one minute less is not.
    expect(bookingIntervalsConflict(interval, { start: 12 * 3600000, end: 13 * 3600000 }, 60)).toBe(false);
    expect(bookingIntervalsConflict(interval, { start: 8 * 3600000, end: 9 * 3600000 }, 60)).toBe(false);
    expect(bookingIntervalsConflict(interval, { start: 12 * 3600000 - 60000, end: 13 * 3600000 }, 60)).toBe(true);
    expect(bookingIntervalsConflict(interval, { start: 8 * 3600000, end: 9 * 3600000 + 60000 }, 60)).toBe(true);
  });
  it('measures a DST spring-forward gap in elapsed minutes rather than wall-clock hours', () => {
    const previous = operatingSlotInstants('2026-03-08', { startTime: '00:30', endTime: '01:30' }, '00:00', zone);
    const next = (startTime: string) => operatingSlotInstants('2026-03-08', { startTime, endTime: '04:30' }, '00:00', zone);
    expect(next('03:30').start - previous.end).toBe(60 * 60000);
    expect(bookingIntervalsConflict(previous, next('03:29'), 60)).toBe(true);
    expect(bookingIntervalsConflict(previous, next('03:30'), 60)).toBe(false);
  });
  it('resolves an overnight tail onto the following calendar day', () => {
    const previous = operatingSlotInstants('2026-10-14', { startTime: '23:00', endTime: '01:00' }, '18:00', zone);
    const next = operatingSlotInstants('2026-10-15', { startTime: '02:00', endTime: '03:00' }, '00:00', zone);
    expect(next.start - previous.end).toBe(60 * 60000);
    expect(bookingIntervalsConflict(previous, next, 60)).toBe(false);
    expect(bookingIntervalsConflict(previous, { ...next, start: next.start - 60000 }, 60)).toBe(true);
  });
});
