import { describe, expect, it } from 'vitest';
import { assertConsecutiveBookingSlots, validateKitchenSlotSelection } from './consecutive-booking-slots';
import { addHour, getHourlySlotStarts, normalizeBookingSlots, occupiedIntervals } from './operating-hours';
import { bookingVisitBlocks } from './booking-visit-blocks';

const slots = (times: string[]) => times.map(startTime => ({ startTime, endTime: addHour(startTime) }));
describe('fresh consecutive selection and historical compatibility', () => {
  it('allows ordered overnight adjacency and rejects gaps, duplicates and invalid hours', () => {
    expect(() => assertConsecutiveBookingSlots(slots(['00:00', '23:00']), '08:00')).not.toThrow();
    for (const times of [['09:00', '11:00'], ['09:00', '09:00'], ['25:00']]) {
      expect(() => assertConsecutiveBookingSlots(slots(times), '08:00')).toThrow();
    }
  });
  it('checks draft availability, minimum hours and limits without filling gaps', () => {
    const available = ['09:00', '10:00', '11:00'].map(time => ({ time, isFullyBooked: time === '10:00' }));
    expect(validateKitchenSlotSelection(['09:00', '11:00'], available)).toContain('consecutive');
    expect(validateKitchenSlotSelection(['09:00', '10:00'], available)).toContain('unavailable');
    expect(validateKitchenSlotSelection(['09:00'], available, 2)).toContain('at least 2');
    expect(validateKitchenSlotSelection(['09:00'], available, 1, 0)).toContain('no more than');
  });
  it('preserves split normalization, occupancy and visits for recorded commitments', () => {
    const split = normalizeBookingSlots(slots(['09:00', '14:00']), '09:00', '15:00', '08:00', '18:00', false);
    expect(occupiedIntervals({ startTime: '09:00', endTime: '15:00', selectedSlots: split })).toEqual(split);
    expect(bookingVisitBlocks(split)).toHaveLength(2);
  });
  it('accepts the complete daily operating window including midnight', () => {
    const daily = normalizeBookingSlots([], '22:00', '01:00', '22:00', '01:00', true);
    expect(() => assertConsecutiveBookingSlots(daily, '22:00')).not.toThrow();
    expect(daily).toEqual(slots(getHourlySlotStarts('22:00', '01:00')));
  });
});
