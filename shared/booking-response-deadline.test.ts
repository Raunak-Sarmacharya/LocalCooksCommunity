import { describe, expect, it } from 'vitest';
import { bookingFreeCancelHours, firstBookingVisitStart, freeCancelResponseCap, resolveResponseDeadline, responseDeadlineForBooking } from './booking-response-deadline';

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

describe('kitchen answers before free cancellation ends (owner decision 2026-10-15)', () => {
  const hour = 3_600_000;
  // Live #167: requested Thu 10:52 for Sat 10:00 with a 24-hour policy. Free cancel ends Fri 10:00 → answer by Fri 09:00.
  const createdAt = new Date('2026-10-15T13:22:00Z'), startAt = new Date('2026-10-17T12:30:00Z');
  it('caps the 24-hour window one hour before free cancellation ends', () => {
    expect(resolveResponseDeadline({ createdAt, startAt, freeCancelHours: 24 }).toISOString()).toBe('2026-10-16T11:30:00.000Z');
    expect(resolveResponseDeadline({ createdAt, startAt }).toISOString()).toBe('2026-10-16T13:22:00.000Z');
  });
  it('leaves earlier deadlines alone', () => {
    const far = new Date(+createdAt + 10 * 24 * hour);
    expect(resolveResponseDeadline({ createdAt, startAt: far, freeCancelHours: 48 }).getTime()).toBe(+createdAt + 24 * hour);
  });
  it('no cap when the request is too close to the free-cancellation deadline (disclosed at checkout instead)', () => {
    const start = new Date(+createdAt + 25 * hour + 10 * 60_000); // free cancel ends in 1h10m: < 1h gap + 30 min to respond
    expect(freeCancelResponseCap({ createdAt, startAt: start, freeCancelHours: 24 })).toBeNull();
    expect(resolveResponseDeadline({ createdAt, startAt: start, freeCancelHours: 24 }).getTime()).toBe(+createdAt + 24 * hour);
    const inside = new Date(+createdAt + 5 * hour);
    expect(freeCancelResponseCap({ createdAt, startAt: inside, freeCancelHours: 24 })).toBeNull();
  });
  it('keeps at least 30 minutes to respond at the boundary', () => {
    const start = new Date(+createdAt + 25.5 * hour);
    expect(freeCancelResponseCap({ createdAt, startAt: start, freeCancelHours: 24 })?.getTime()).toBe(+createdAt + 30 * 60_000);
  });
  it('reads the frozen policy (snapshot first, then the hours column)', () => {
    expect(bookingFreeCancelHours({ cancellationPolicySnapshot: { noticeHours: 48 }, cancellationPolicyHours: 24 })).toBe(48);
    expect(bookingFreeCancelHours({ cancellationPolicyHours: 72 })).toBe(72);
    expect(bookingFreeCancelHours({})).toBeNull();
    const booking = { createdAt, status: 'pending', bookingDate: '2026-10-17', startTime: '10:00', endTime: '11:00', cancellationPolicyHours: 24 };
    expect(responseDeadlineForBooking(booking, 'America/St_Johns').toISOString()).toBe('2026-10-16T11:30:00.000Z');
  });
});
