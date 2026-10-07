import { describe, expect, it } from 'vitest';
import { tourHistory } from './tour-history';
const time = (hour: number) => `2026-10-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
const row = (id: number, kind: string, after = {}, before = {}) => ({ id, createdAt: time(id), payload: { kind, before, after, actorRole: 'manager', actorId: 123, chef: { email: 'private@test' }, admins: [{ email: 'admin@test' }], managerNotes: 'PRIVATE' } });
describe('public recorded tour history', () => {
  it('distinguishes safe cancellation outcomes without leaking arbitrary reasons', () => {
    const result = tourHistory({}, [row(1, 'status', { status: 'cancelled', disruptionReason: 'weather' }), row(2, 'status', { status: 'cancelled', cancelledBy: 'manager_declined' }), row(3, 'status', { status: 'cancelled', disruptionReason: 'PRIVATE', cancellationReason: 'PRIVATE' })]);
    expect(result.events.map(event => event.outcome)).toEqual(['disrupted', 'declined', 'cancelled']);
    expect(result.events[0].disruptionReason).toBe('weather');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('deduplicates outcome snapshots when transaction creation precedes application record time', () => {
    const outcome = { from: 'confirmed', to: 'completed', recordedAt: '2026-10-01T03:00:00.400Z', actorRole: 'manager' };
    const result = tourHistory({ outcomeHistory: [outcome] }, [row(3, 'status', { status: 'completed', outcomeHistory: [outcome] }, { status: 'confirmed', outcomeHistory: [] })]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].recordedAt).toBe(time(3));
  });
  it('distinguishes assisted arrival using normalized timestamps and keeps departure separate', () => {
    const before = { checkedOutAt: new Date(time(2)) };
    const after = { checkedOutAt: new Date(time(2)), checkedInAt: time(1) };
    expect(tourHistory({}, [row(3, 'attendance_assisted', after, before)]).events[0]).toMatchObject({ action: 'check_in', actualAt: time(1) });
    expect(tourHistory({}, [row(3, 'attendance_assisted', { checkedOutAt: time(3) }, { checkedOutAt: null })]).events[0]).toMatchObject({ action: 'check_out', actualAt: time(3) });
  });
  it('preserves assisted arrival and departure fallback at the same actual instant', () => {
    const entry = { actorId: 2, source: 'manager_assisted', actualAt: time(2), recordedAt: time(3), scheduledAt: time(2), reason: 'Recorded with visitor confirmation' };
    const result = tourHistory({ attendanceHistory: [{ ...entry, action: 'check_in' }, { ...entry, action: 'check_out' }] }, [row(3, 'attendance_assisted', { checkedInAt: time(2) }, {})]);
    expect(result.events.map(event => event.action)).toEqual(['check_in', 'check_out']);
  });
  it('preserves ordered repeated proposals and withdrawals without recipient or note data', () => {
    const result = tourHistory({}, [row(5, 'reschedule_proposal_withdrawn'), row(2, 'reschedule_proposed', { rescheduleProposedSlots: [time(9)] }), row(1, 'requested', { status: 'pending_local_cooks', scheduledAt: time(8), managerNotes: 'PRIVATE' }), row(3, 'reschedule_proposal_withdrawn'), row(4, 'reschedule_proposed', { rescheduleProposedSlots: [time(10), 'bad'] })]);
    expect(result.complete).toBe(true);
    expect(result.events.map(event => event.key)).toEqual(['event-1', 'event-2', 'event-3', 'event-4', 'event-5']);
    expect(result.events[0].status).toBe('pending');
    expect(result.events[3].proposedSlots).toEqual([time(10)]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|email|actorId|admins|pending_local_cooks/);
  });
  it('excludes internal review and delivery activity and whitelists every lifecycle kind', () => {
    const kinds = ['requested', 'request_updated', 'reschedule_requested', 'reschedule_accepted', 'reschedule_declined', 'reschedule_proposed', 'reschedule_proposal_accepted', 'reschedule_proposal_declined', 'reschedule_proposal_withdrawn', 'status', 'expired', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted'];
    const events = kinds.map((kind, index) => row(index + 1, kind, { status: 'confirmed', scheduledAt: time(20), requestedRescheduleAt: time(21), checkedInAt: time(18), checkedOutAt: time(19) }, { status: 'pending', scheduledAt: time(17) }));
    events.push(...['review_approved', 'review_denied', 'reminder', 'request_escalation', 'unknown'].map(kind => row(15, kind)));
    expect(tourHistory({}, events).events.map(event => event.kind)).toEqual(kinds);
    expect(tourHistory({}, [row(1, 'status', { status: 'secret' })]).events[0]).not.toHaveProperty('status');
  });
  it('returns reliable partial legacy evidence without inventing transitions from updatedAt or scheduledAt', () => {
    const tour = { createdAt: time(1), updatedAt: time(23), scheduledAt: time(22), outcomeHistory: [{ from: 'confirmed', to: 'completed', recordedAt: time(3), actorRole: 'admin', notes: 'PRIVATE' }, { to: 'cancelled', recordedAt: 'bad' }], attendanceHistory: [{ action: 'check_out', source: 'visitor', actorId: 3, actualAt: time(2), recordedAt: time(3), scheduledAt: time(2) }] };
    const result = tourHistory(tour, [row(3, 'status', { status: 'completed' }, { status: 'confirmed' })]);
    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(3);
    expect(result.events.filter(event => event.kind === 'status')).toHaveLength(1);
    expect(result.events.some(event => event.recordedAt === time(23))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});
