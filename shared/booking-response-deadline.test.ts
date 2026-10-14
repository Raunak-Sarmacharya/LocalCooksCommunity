import { describe, expect, it } from 'vitest';
import { firstBookingVisitStart, resolveResponseDeadline, responseDeadlineForBooking } from './booking-response-deadline';

describe('R5 kitchen response deadline', () => {
  const createdAt = new Date('2026-10-14T12:00:00Z');
  it.each([[5 * 24 * 60, 24 * 60], [10 * 60, 9 * 60], [70, 70], [-1, 0], [90, 30]])
    ('start %i minutes after request gives %i minutes to respond', (startMinutes, deadlineMinutes) => {
      expect(resolveResponseDeadline({ createdAt, startAt: new Date(+createdAt + startMinutes * 60_000) }).getTime())
        .toBe(+createdAt + deadlineMinutes * 60_000);
    });
  it('uses the configured buffer and rejects invalid input', () => {
    expect(resolveResponseDeadline({ createdAt, startAt: new Date(+createdAt + 10 * 3_600_000), bufferHours: 2 }).getTime()).toBe(+createdAt + 8 * 3_600_000);
    expect(() => resolveResponseDeadline({ createdAt, startAt: 'invalid' })).toThrow();
    expect(() => resolveResponseDeadline({ createdAt, startAt: createdAt, bufferHours: -1 })).toThrow();
  });
  it('uses the kitchen zone and the first dated slot, regardless of array order', () => {
    const booking = { createdAt, status: 'pending', bookingDate: '2026-10-14', startTime: '09:00', endTime: '12:00',
      selectedSlots: [{ date: '2026-10-16', startTime: '09:00', endTime: '10:00' }, { date: '2026-10-14', startTime: '10:00', endTime: '11:00' }] };
    expect(firstBookingVisitStart(booking, 'America/St_Johns').toISOString()).toBe('2026-10-14T12:30:00.000Z');
    expect(responseDeadlineForBooking(booking, 'America/St_Johns').toISOString()).toBe('2026-10-14T12:30:00.000Z');
  });
  it('keeps overnight operating dates and DST fold semantics', () => {
    expect(firstBookingVisitStart({ status: 'pending', bookingDate: '2026-10-14', startTime: '00:00', endTime: '01:00',
      operatingWindowStartTime: '22:00', selectedSlots: ['00:00'] }, 'America/St_Johns').toISOString()).toBe('2026-10-15T02:30:00.000Z');
    expect(firstBookingVisitStart({ status: 'pending', bookingDate: '2026-11-01', startTime: '01:00', endTime: '02:00' }, 'America/St_Johns').toISOString()).toBe('2026-11-01T03:30:00.000Z');
  });
});
