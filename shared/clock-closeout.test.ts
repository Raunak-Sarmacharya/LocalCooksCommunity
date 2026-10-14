import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCloseoutSnapshot, reduceClockCloseout, closeoutTransition, lateCheckoutOpen, recordedDepartureAt, snapshotBookedHours, type ClockBooking } from './clock-closeout';

const timing = { serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 };
const booking: ClockBooking = { bookingDate: '2026-10-13', startTime: '10:00', endTime: '11:00', status: 'confirmed', checkinStatus: 'not_checked_in' };
const saved = () => makeCloseoutSnapshot(booking, 'America/St_Johns', timing);
const at = (time: string, row = booking, clock = saved(), visits: any[] = []) => {
  vi.setSystemTime(new Date(time));
  return reduceClockCloseout(row, visits, clock, new Date());
};
describe('clock closeout (fake clock, no providers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it.each([
    ['2026-10-13T12:00:00Z', 'upcoming'], ['2026-10-13T12:15:00Z', 'arrival_window'],
    ['2026-10-13T12:30:00Z', 'in_booked_time'], ['2026-10-13T13:30:00Z', 'booked_time_ended'],
    ['2026-10-13T13:45:00Z', 'ended'],
  ])('derives %s as %s without taps', (time, phase) => {
    const result = at(time); expect(result.phase).toBe(phase);
    expect(result.status).toBe(phase === 'ended' ? 'completed' : 'confirmed');
    expect(result.visits[0].attendance).toBe('unknown');
  });
  it('forgotten checkout ends service while retaining arrival and an inspection task', () => {
    const result = at('2026-10-13T14:00:00Z', { ...booking, checkinStatus: 'checked_in', checkedInAt: '2026-10-13T12:30:00Z' });
    expect(result.status).toBe('completed'); expect(result.visits[0].inspection.outcome).toBe('due');
    expect(result.visits[0].attendance).toBe('recorded');
  });
  it('early departure starts inspection without shortening booked time or its deadline', () => {
    const result = at('2026-10-13T13:00:00Z', { ...booking, checkinStatus: 'checkout_requested', checkoutRequestedAt: '2026-10-13T12:45:00Z' });
    expect(result.phase).toBe('in_booked_time'); expect(result.status).toBe('confirmed');
    expect(result.visits[0].inspection).toMatchObject({ dueAt: '2026-10-13T12:45:00.000Z', deadline: '2026-10-14T13:30:00.000Z' });
  });
  it('early manager clear records inspection without early completion', () => {
    const result = at('2026-10-13T13:00:00Z', { ...booking, checkinStatus: 'checked_out', checkoutApprovedBy: 7,
      checkoutApprovedAt: '2026-10-13T12:50:00Z' });
    expect(result.status).toBe('confirmed'); expect(result.visits[0].inspection.outcome).toBe('manager_cleared');
  });
  it('auto-closes exactly 24 hours after the later departure without fabricating approval', () => {
    const row = { ...booking, checkoutRequestedAt: '2026-10-13T14:00:00Z' };
    expect(at('2026-10-14T13:59:59Z', row).visits[0].inspection.outcome).toBe('due');
    expect(at('2026-10-14T14:00:00Z', row).visits[0].inspection).toMatchObject({ outcome: 'auto_closed_uninspected', closedAt: '2026-10-14T14:00:00.000Z', canRespond: false });
    expect(row).not.toHaveProperty('checkoutApprovedAt');
  });
  it('a timely issue keeps its own case open while service completes', () => {
    const result = at('2026-10-17T14:00:00Z', { ...booking, checkinStatus: 'checkout_claim_filed', checkoutApprovedAt: '2026-10-13T14:00:00Z' });
    expect(result.status).toBe('completed'); expect(result.visits[0].inspection.outcome).toBe('issue_filed'); expect(result.nextDueAt).toBeNull();
  });
  it('last visit governs, even with an earlier visit cleared', () => {
    const row = { ...booking, endTime: '16:00', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '15:00', endTime: '16:00' }] };
    const clock = makeCloseoutSnapshot(row, 'America/St_Johns', timing);
    const visits = [{ startTime: '10:00', endTime: '11:00', checkinStatus: 'checked_out', checkoutApprovedBy: 7 }];
    expect(at('2026-10-13T14:00:00Z', row, clock, visits).status).toBe('confirmed');
    expect(at('2026-10-13T18:45:00Z', row, clock, visits).status).toBe('completed');
  });
  it('overnight end belongs to the following calendar day', () => {
    const clock = makeCloseoutSnapshot({ ...booking, startTime: '23:00', endTime: '01:00', selectedSlots: [] }, 'America/St_Johns', timing);
    expect(clock.visits[0]).toMatchObject({ scheduledStartAt: '2026-10-14T01:30:00.000Z', scheduledEndAt: '2026-10-14T03:30:00.000Z' });
  });
  it('Newfoundland spring gap rejects a nonexistent legacy boundary', () => {
    expect(() => makeCloseoutSnapshot({ ...booking, bookingDate: '2026-03-08', startTime: '02:00', endTime: '03:00' }, 'America/St_Johns', timing)).toThrow('does not exist');
  });
  it('Newfoundland fold uses saved instants, including an explicitly chosen second occurrence', () => {
    const row = { ...booking, bookingDate: '2026-11-01', startTime: '01:00', endTime: '03:00' };
    const clock = makeCloseoutSnapshot(row, 'America/St_Johns', timing);
    expect(clock.visits[0].scheduledStartAt).toBe('2026-11-01T03:30:00.000Z');
    clock.visits[0].scheduledStartAt = '2026-11-01T04:30:00.000Z';
    expect(at('2026-11-01T04:00:00Z', row, clock).phase).toBe('upcoming');
    expect(at('2026-11-01T04:30:00Z', row, clock).phase).toBe('in_booked_time');
  });
  it('uses another location IANA zone and ignores later location/timing edits once saved', () => {
    const clock = makeCloseoutSnapshot(booking, 'Asia/Tokyo', { ...timing, serviceEndGraceMinutes: 30 });
    expect(clock.visits[0].scheduledEndAt).toBe('2026-10-13T02:00:00.000Z');
    expect(at('2026-10-13T02:30:00Z', booking, clock).status).toBe('completed');
  });
  it('delayed and duplicate transition retains the original deadline and is idempotent', () => {
    const original = saved(); const late = at('2026-10-20T12:00:00Z', booking, original);
    const once = closeoutTransition(original, late);
    expect(once.serviceEndedAt).toBe('2026-10-13T13:45:00.000Z');
    expect(Object.values(once.inspections!)[0].closedAt).toBe('2026-10-14T13:30:00.000Z');
    expect(closeoutTransition(once, at('2026-10-21T12:00:00Z', { ...booking, status: 'completed' }, once))).toEqual(once);
  });
  it('two visits on different dates with identical hours never collide and close independently', () => {
    const row = { ...booking, selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '10:00', endTime: '11:00', date: '2026-10-14' }] };
    const clock = makeCloseoutSnapshot(row, 'America/St_Johns', timing);
    expect(clock.visits.map(visit => visit.localDate)).toEqual(['2026-10-13', '2026-10-14']);
    expect(new Set(clock.visits.map(visit => visit.key)).size).toBe(2);
    expect(clock.visits[1].scheduledStartAt).toBe('2026-10-14T12:30:00.000Z');
    // Rows carry only a block index; same hours cannot be told apart by time.
    const rows = [{ id: 31, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'checked_out', checkoutApprovedBy: 7, checkedInAt: '2026-10-13T12:35:00Z' },
      { id: 32, blockIndex: 1, startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in' }];
    const first = at('2026-10-14T12:00:00Z', row, clock, rows);
    expect(first.visits.map(visit => visit.key)).toEqual(['31', '32']);
    expect(first.visits.map(visit => visit.visitId)).toEqual([31, 32]);
    expect(first.visits[0]).toMatchObject({ arrivalRecorded: true, inspection: { outcome: 'manager_cleared' } });
    expect(first.visits[1]).toMatchObject({ arrivalRecorded: false, phase: 'upcoming', inspection: { outcome: 'not_due' } });
    expect(first.status).toBe('confirmed');
    // Day two ends and auto-closes on its own deadline; day one's clearance is untouched.
    const later = at('2026-10-15T13:30:00Z', row, clock, rows);
    expect(later.visits[1].inspection).toMatchObject({ outcome: 'auto_closed_uninspected', closedAt: '2026-10-15T13:30:00.000Z' });
    expect(later.visits[0].inspection.outcome).toBe('manager_cleared');
    expect(later.status).toBe('completed');
    const persisted = closeoutTransition(clock, later);
    expect(Object.keys(persisted.inspections!)).toEqual(['32']);
    // Without rows yet, keys are deterministic and include the date.
    expect(at('2026-10-14T12:00:00Z', row, clock, []).visits.map(visit => visit.key)).toEqual(clock.visits.map(visit => visit.key));
  });
  it('a persisted auto-close under the deterministic key survives the visit row appearing later', () => {
    const row = { ...booking, selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '10:00', endTime: '11:00', date: '2026-10-14' }] };
    const clock = makeCloseoutSnapshot(row, 'America/St_Johns', timing);
    clock.inspections = { [clock.visits[0].key]: { outcome: 'auto_closed_uninspected', closedAt: '2026-10-14T13:30:00.000Z' } };
    const result = at('2026-10-14T20:00:00Z', row, clock, [{ id: 41, blockIndex: 0, startTime: '10:00', endTime: '11:00' }, { id: 42, blockIndex: 1, startTime: '10:00', endTime: '11:00' }]);
    expect(result.visits[0].inspection.outcome).toBe('auto_closed_uninspected');
    expect(result.visits[1].inspection.outcome).not.toBe('auto_closed_uninspected');
  });
  it('a visit row dated on another day does not attach to the wrong visit', () => {
    const row = { ...booking, selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '10:00', endTime: '11:00', date: '2026-10-14' }] };
    const clock = makeCloseoutSnapshot(row, 'America/St_Johns', timing);
    const result = at('2026-10-14T12:00:00Z', row, clock, [{ id: 51, blockIndex: 1, visitDate: '2026-10-13', startTime: '10:00', endTime: '11:00', checkedInAt: '2026-10-13T12:35:00Z' }]);
    expect(result.visits.every(visit => visit.visitId === undefined)).toBe(true);
  });
  it('legacy booking-level fields and already-finished records remain truthful', () => {
    const row = { ...booking, status: 'completed', checkinStatus: 'checked_out', checkoutApprovedAt: '2026-10-13T12:50:00Z' };
    expect(at('2026-10-20T12:00:00Z', row).visits[0].inspection.outcome).toBe('legacy_closed');
    expect(at('2026-10-20T12:00:00Z', row).visits[0].attendance).toBe('unknown');
  });
});

describe('late departure helpers', () => {
  const clock = (phase: string, outcome: string) => ({ phase, inspection: { outcome } }) as any;
  it('keeps checkout open after the end until the inspection window closes', () => {
    expect(lateCheckoutOpen(clock('booked_time_ended', 'due'))).toBe(true);
    expect(lateCheckoutOpen(clock('ended', 'due'))).toBe(true);
    expect(lateCheckoutOpen(clock('ended', 'auto_closed_uninspected'))).toBe(false);
    expect(lateCheckoutOpen(clock('in_booked_time', 'not_due'))).toBe(false);
    expect(lateCheckoutOpen(undefined)).toBe(false);
  });
  it('uses the recorded departure time, never the time the kitchen typed it in', () => {
    expect(recordedDepartureAt({ checkoutRequestedAt: '2026-10-14T21:00:00Z',
      assistanceHistory: [{ action: 'arrival', actualAt: '2026-10-14T16:30:00Z' }, { action: 'departure', actualAt: '2026-10-14T19:40:00Z' }] })?.toISOString())
      .toBe('2026-10-14T19:40:00.000Z');
    expect(recordedDepartureAt({ checkoutRequestedAt: '2026-10-14T19:10:00Z' })?.toISOString()).toBe('2026-10-14T19:10:00.000Z');
    expect(recordedDepartureAt({})).toBeNull();
  });
  it('derives booked hours from every saved visit span', () => {
    expect(snapshotBookedHours({ visits: [{ scheduledStartAt: '2026-10-14T16:00:00Z', scheduledEndAt: '2026-10-14T19:25:00Z' } as any,
      { scheduledStartAt: '2026-10-15T16:00:00Z', scheduledEndAt: '2026-10-15T17:00:00Z' } as any] })).toBe(4.42);
  });
});
