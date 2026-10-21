import { describe, expect, it } from 'vitest';
import { managerDatedListDay, managerListDays, openAttendanceAnswers } from './booking-list-status';
import { openMinutes, spanMinutes, weekStartKey, weekStats } from './manager-week-stats';
import { revenueSummaryFromCurrent } from './manager-revenue-summary';

const twoDays = { status: 'confirmed', bookingDate: '2026-10-18', startTime: '20:00', endTime: '21:00', scheduleRevision: 2, locationTimezone: 'America/St_Johns',
  selectedSlots: [{ startTime: '20:00', endTime: '21:00' }, { startTime: '20:00', endTime: '21:00' }],
  visitStates: [{ id: 2, checkinStatus: 'not_checked_in', visitDate: '2026-10-19', startTime: '08:00', endTime: '09:00' },
    { id: 1, checkinStatus: 'checked_out', visitDate: '2026-10-18', startTime: '20:00', endTime: '21:00' }] };

describe('managerListDays', () => {
  it('splits a dated multi-day booking into one row per day, in date order, with only that day\'s times', () => {
    const days = managerListDays(twoDays);
    expect(days.map(day => [day.dayNumber, day.dayCount, day.visitId, day.row.bookingDate, day.row.startTime, day.row.selectedSlots])).toEqual([
      [1, 2, 1, '2026-10-18', '20:00', undefined], [2, 2, 2, '2026-10-19', '08:00', undefined]]);
  });
  it('keeps a single-day booking as one unchanged row', () => {
    const row = { ...twoDays, scheduleRevision: undefined };
    expect(managerListDays(row)).toEqual([{ row }]);
  });
  it('agrees with the agenda on the day that needs the kitchen', () => {
    expect(managerDatedListDay(twoDays, Date.parse('2026-10-18T12:00:00Z')).visitStates?.[0].id).toBe(2);
  });
});

describe('week numbers', () => {
  const hours = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, startTime: '22:00', endTime: '02:00', isAvailable: true }));
  it('measures spans past midnight and lets an exception replace the weekly hours', () => {
    expect(spanMinutes('22:00', '02:00')).toBe(240);
    expect(openMinutes(hours, [], '2026-10-18')).toBe(240);
    expect(openMinutes(hours, [{ specificDate: '2026-10-18T00:00:00.000Z', isAvailable: false }], '2026-10-18')).toBe(0);
    expect(openMinutes(hours, [{ specificDate: '2026-10-18', isAvailable: true, startTime: '10:00', endTime: '11:30' }], '2026-10-18')).toBe(90);
  });
  it('starts weeks on Sunday and counts distinct booked bookings, never requests or cancellations', () => {
    expect(weekStartKey('2026-10-21')).toBe('2026-10-18');
    const day = (bookingId: number, bookingDate: string, status = 'confirmed') => ({ bookingId, kitchenId: 1, status, bookingDate, startTime: '22:00', endTime: '01:00' });
    const stats = weekStats([day(1, '2026-10-18'), day(1, '2026-10-19'), day(2, '2026-10-20', 'pending'), day(3, '2026-10-20', 'cancelled'), day(4, '2026-10-25', 'completed')],
      '2026-10-18', new Map([[1, { weekly: hours, overrides: [] }]]));
    expect(stats).toEqual({ bookings: 1, bookedMinutes: 360, openMinutes: 7 * 240, utilisation: 21 });
    expect(weekStats([day(4, '2026-10-25', 'completed')], '2026-10-25', new Map()).utilisation).toBeNull();
  });
});

describe('revenueSummaryFromCurrent', () => {
  it('splits scheduled from held payouts and sums the earliest scheduled kitchen day', () => {
    const summary = revenueSummaryFromCurrent({ completedNetRevenue: 17571 }, { payouts: [
      { bookingId: 1, status: 'scheduled', amountCents: 1000, expectedAt: '2026-10-21T02:00:00Z', timezone: 'America/St_Johns' }, // Oct 20, 11:30 p.m. kitchen time
      { bookingId: 2, status: 'scheduled', amountCents: 500, expectedAt: '2026-10-20T15:00:00Z', timezone: 'America/St_Johns' },
      { bookingId: 3, status: 'scheduled', amountCents: 700, expectedAt: '2026-10-22T15:00:00Z', timezone: 'America/St_Johns' },
      { bookingId: 1, status: 'on_hold', amountCents: 300, expectedAt: null },
      { bookingId: 9, status: 'scheduled', amountCents: 9999, expectedAt: '2026-10-19T15:00:00Z' },
    ] }, new Set([1, 2, 3]));
    expect(summary).toEqual({ paidOut: 17571, upcoming: { total: 2200, next: { date: '2026-10-20', amount: 1500 } }, onHold: { count: 1, amount: 300 }, monthToDate: null });
  });
  it('reports unknown sources as unknown, not zero', () => {
    expect(revenueSummaryFromCurrent(undefined, undefined)).toEqual({ paidOut: null, upcoming: null, onHold: null, monthToDate: null });
  });
});

describe('openAttendanceAnswers', () => {
  const visit = (over: Record<string, unknown>) => ({ localDate: '2026-10-20', startTime: '17:00', endTime: '18:00', attendance: 'unknown',
    inspection: { canRespond: true, deadline: '2026-10-21T21:30:00.000Z' }, ...over });
  it('lists only unanswered visits whose window the server says is open, each with its own deadline (as dev booking 207)', () => {
    const answers = openAttendanceAnswers({ status: 'completed', bookingDate: '2026-10-18', startTime: '14:00', endTime: '16:00', closeout: { visits: [
      visit({ visitId: 156, localDate: '2026-10-18', attendance: 'recorded', inspection: { canRespond: false, deadline: '2026-10-19T18:30:00.000Z' } }),
      visit({ visitId: 157, inspection: { canRespond: true, deadline: '2026-10-22T18:30:00.000Z' } }),
      visit({ visitId: 158, localDate: '2026-10-16', inspection: { canRespond: false, deadline: '2026-10-17T18:30:00.000Z' } }),
      visit({ visitId: 159, attendance: 'no_show' }),
    ] } });
    expect(answers).toEqual([{ visitId: 157, localDate: '2026-10-20', startTime: '17:00', endTime: '18:00', deadline: '2026-10-22T18:30:00.000Z' }]);
  });
  it('answers blocks without their own visit row once, for the booking, by the latest deadline', () => {
    const answers = openAttendanceAnswers({ status: 'completed', bookingDate: '2026-10-21', startTime: '10:00', endTime: '15:00', closeout: { visits: [
      visit({ localDate: '2026-10-21', startTime: '10:00', endTime: '11:00', inspection: { canRespond: true, deadline: '2026-10-22T13:30:00.000Z' } }),
      visit({ localDate: '2026-10-21', startTime: '14:00', endTime: '15:00', inspection: { canRespond: true, deadline: '2026-10-22T17:30:00.000Z' } }),
    ] } });
    expect(answers).toEqual([{ visitId: undefined, localDate: '2026-10-21', startTime: '10:00', endTime: '15:00', deadline: '2026-10-22T17:30:00.000Z' }]);
  });
  it('asks nothing of a legacy closeout', () => {
    expect(openAttendanceAnswers({ status: 'completed', bookingDate: '2026-10-21', startTime: '10:00', endTime: '11:00', closeout: { legacy: true, visits: [visit({})] } })).toEqual([]);
  });
});
