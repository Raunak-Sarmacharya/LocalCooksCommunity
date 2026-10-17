import { describe, expect, it } from 'vitest';
import { activeDayEnds, hasUpcomingDay, latestEndedDay } from '@shared/dated-visits';

// CP6 fix round L6: the kitchen's Today board and the claims "recent bookings" read a dated booking's active days.
const booking = { scheduleRevision: 1 };
const visit = (id: number, visitDate: string, scheduleState = 'active') => ({ id, visitDate, scheduleRevision: 1, scheduleState,
  startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00' });
const visits = [visit(1, '2099-11-02'), visit(2, '2099-11-04', 'cancelled'), visit(3, '2099-11-06')];

describe('dated days on the Today board and for claims', () => {
  it('keeps a booking on the Today board after day 1 has passed while a later active day remains', () => {
    expect(hasUpcomingDay(booking, visits, 'UTC', new Date('2099-11-03T12:00:00Z'))).toBe(true);
    expect(hasUpcomingDay(booking, visits, 'UTC', new Date('2099-11-06T17:00:01Z'))).toBe(false);
  });
  it('never lists a cancelled day', () => {
    expect(activeDayEnds(booking, visits, 'UTC').map(day => day.visit.id)).toEqual([1, 3]);
    // Wednesday was cancelled: on Thursday the latest finished day is still Monday.
    expect(latestEndedDay(booking, visits, 'UTC', new Date('2099-11-05T12:00:00Z'))?.date).toBe('2099-11-02');
  });
  it('keys claims on the latest active day that has ended, in the kitchen’s zone', () => {
    expect(latestEndedDay(booking, visits, 'America/St_Johns', new Date('2099-11-06T20:31:00Z'))?.date).toBe('2099-11-06');
    expect(latestEndedDay(booking, visits, 'America/St_Johns', new Date('2099-11-06T20:29:00Z'))?.date).toBe('2099-11-02');
  });
  it('ignores one-day bookings (their own date and time apply)', () => {
    expect(activeDayEnds({ scheduleRevision: 0 }, visits, 'UTC')).toEqual([]);
  });
});
