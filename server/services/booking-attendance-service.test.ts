import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][], updates: [] as any[], events: [] as any[], locks: [] as any[], notify: vi.fn() }));
vi.mock('../db', () => {
  const connection: any = {
    execute: async (query: any) => { state.locks.push(query); },
    select: () => { const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
      limit: async () => state.rows.shift() || [], orderBy: async () => state.rows.shift() || [],
      then: (resolve: any) => resolve(state.rows.shift() || []) }; return chain; },
    update: () => ({ set: (value: any) => { state.updates.push(value); return { where: async () => [] }; } }),
    insert: () => ({ values: async (value: any) => { state.events.push(value); } }),
  };
  connection.transaction = async (work: any) => work(connection);
  return { db: connection };
});
vi.mock('./notification.service', () => ({ notificationService: { create: (...args: any[]) => state.notify(...args) } }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: (...args: any[]) => state.notify(...args) }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Sam Chef' }));
import { readBookingAttendance, readBookingHistory, recordBookingAttendance } from './booking-attendance-service';
const timestamp = '2026-10-02T10:00:00.000Z';
const actor = { id: 2, role: 'manager' as const };
const booking = { id: 10, chefId: 3, kitchenId: 4, status: 'confirmed', bookingDate: new Date('2026-10-02'), startTime: '09:00', endTime: '17:00', checkinStatus: 'not_checked_in', updatedAt: new Date(timestamp) };
const input = { action: 'report_no_show' as const, expectedUpdatedAt: timestamp, expectedBookingUpdatedAt: timestamp, sharedMessage: 'Chef did not attend', confirmsChefAbsent: true };
function context(overrides = {}) { return { booking: { ...booking, ...overrides }, managerId: 2 }; }
function prepare(overrides = {}, visits: any[] = [], events: any[] = []) {
  state.rows.push([context(overrides)], visits, events);
}
function response() { state.rows.push([context()], [], []); }
describe('explicit booking attendance statements (mocked database only)', () => {
  beforeEach(() => { state.rows = []; state.updates = []; state.events = []; state.locks = []; state.notify.mockReset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T20:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it.each([{ id: 99, role: 'chef' as const }, { id: 99, role: 'manager' as const }])('protects booking history from a foreign $role before reading events', async foreign => {
    state.rows.push([context()], [{ id: 1, kind: 'requested', createdAt: new Date(timestamp) }]);
    await expect(readBookingHistory(10, foreign)).rejects.toMatchObject({ status: 404 });
    expect(state.rows).toHaveLength(1);
  });
  it('returns public booking history to its chef without delivery or audit details', async () => {
    state.rows.push([context({ createdAt: new Date(timestamp) })], [
      { id: 1, kind: 'requested', createdAt: new Date(timestamp), title: 'Internal title', message: 'Private workflow',
        metadata: { intentId: 'private', visitId: 4 }, emails: ['private@example.test'] },
    ], []);
    const result = await readBookingHistory(10, { id: 3, role: 'chef' });
    expect(result.events).toEqual([{ key: 'event-1', kind: 'requested', recordedAt: timestamp, visitId: 4 }]);
    expect(JSON.stringify(result)).not.toMatch(/Private|private|emails|title|message/);
    expect(state.updates).toEqual([]);
    expect(state.notify).not.toHaveBeenCalled();
  });
  it('adds Local Cooks goodwill from verified payment history, with the amount and no provider identifiers', async () => {
    state.rows.push([context({ createdAt: new Date(timestamp) })], [], [], [
      { id: 12, createdAt: new Date('2026-10-14T12:00:00.000Z'), metadata: { amountCents: 2600, refundId: 're_private', operationKey: 'private-key' } }]);
    const result = await readBookingHistory(10, { id: 3, role: 'chef' });
    expect(result.events.find(event => event.kind === 'goodwill_refunded')).toEqual({ key: 'payment-12', kind: 'goodwill_refunded', recordedAt: '2026-10-14T12:00:00.000Z', amountCents: 2600 });
    expect(JSON.stringify(result)).not.toMatch(/re_private|private-key/);
  });
  it('reports after end without completing, cancelling, clearing inspection or changing money', async () => {
    prepare(); response(); await recordBookingAttendance(10, actor, input);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0]).sort()).toEqual(['checkinStatus', 'noShowDetectedAt', 'updatedAt']);
    expect(state.events[0]).toMatchObject({ action: 'report_no_show', previousStatus: 'not_checked_in', actorId: 2 });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify.mock.calls[0].slice(1, 4)).toEqual([10, 'report_no_show', 'No-show reported']);
  });
  it('does not require optional tracking to be enabled', async () => {
    prepare({ checkinStatus: null }); response(); await recordBookingAttendance(10, actor, input);
    expect(state.updates[0].checkinStatus).toBe('no_show');
  });
  it('rejects reporting before the whole booking end', async () => {
    vi.setSystemTime(new Date('2026-10-02T19:29:59Z')); prepare();
    await expect(recordBookingAttendance(10, actor, input)).rejects.toThrow(/scheduled visit or booking end/);
    expect(state.events).toEqual([]);
  });
  it.each(['pending', 'cancelled', 'cancellation_requested'])('rejects a %s reservation', async status => {
    prepare({ status }); await expect(recordBookingAttendance(10, actor, input)).rejects.toThrow(/confirmed reservations/);
    expect(state.updates).toEqual([]);
  });
  it('rejects another kitchen manager and chef writers', async () => {
    state.rows.push([{ ...context(), managerId: 99 }]);
    await expect(recordBookingAttendance(10, actor, input)).rejects.toThrow(/not found/);
    await expect(recordBookingAttendance(10, { id: 3, role: 'chef' }, input)).rejects.toThrow(/Access denied/);
    expect(state.updates).toEqual([]);
  });
  it('rejects a manipulated visit ID', async () => {
    prepare(); await expect(recordBookingAttendance(10, actor, { ...input, visitId: 999 })).rejects.toThrow(/belonging/);
  });
  it('reports an earlier visit after its own end with tracking off, without completing later visits', async () => {
    vi.setSystemTime(new Date('2026-10-02T14:00:00Z'));
    const visit = { id: 5, blockIndex: 0, startTime: '09:00', endTime: '10:00', checkinStatus: 'not_checked_in', updatedAt: new Date(timestamp) };
    state.rows.push([context()], [visit], [visit], []); response();
    await recordBookingAttendance(10, actor, { ...input, visitId: 5 });
    expect(state.events[0]).toMatchObject({ visitId: 5, action: 'report_no_show' });
    expect(state.updates[0]).not.toHaveProperty('status');
    expect(state.updates[0]).not.toHaveProperty('checkoutApprovedAt');
  });
  it.each([{ checkinStatus: 'checked_in' }, { checkedInAt: new Date() }, { checkoutPhotoUrls: ['photo'] }, { checkoutApprovedAt: new Date() }])('rejects contradictory attendance/inspection evidence %o', async evidence => {
    prepare(evidence); await expect(recordBookingAttendance(10, actor, input)).rejects.toThrow(/contradicts/);
    expect(state.updates).toEqual([]);
  });
  it('requires explicit absence confirmation and rejects manager private notes', async () => {
    await expect(recordBookingAttendance(10, actor, { ...input, confirmsChefAbsent: false })).rejects.toThrow(/Explicitly confirm/);
    await expect(recordBookingAttendance(10, actor, { ...input, internalNotes: 'private' })).rejects.toThrow(/Local Cooks/);
  });
  it('rejects stale reservation versions, including cancellation or extension races', async () => {
    prepare({ updatedAt: new Date('2026-10-02T11:00:00Z') });
    await expect(recordBookingAttendance(10, actor, input)).rejects.toThrow(/Reservation changed/);
  });
  it('re-reads a visit under lock and rejects a concurrent check-in', async () => {
    state.rows.push([context()], [{ id: 5, updatedAt: new Date(timestamp) }], [{ id: 5, checkinStatus: 'checked_in', updatedAt: new Date('2026-10-02T11:00:00Z') }]);
    await expect(recordBookingAttendance(10, actor, { ...input, visitId: 5 })).rejects.toThrow(/visit record changed/);
    expect(state.locks).toHaveLength(2); expect(state.events).toEqual([]);
  });
  it('records attended separately without manufacturing check-in/out or checklist evidence', async () => {
    prepare(); response(); await recordBookingAttendance(10, actor, { ...input, action: 'report_attended' });
    expect(Object.keys(state.updates[0])).toEqual(['updatedAt']);
    expect(state.events[0].action).toBe('report_attended');
  });
  it('corrects legacy no-show without reopening a completed reservation or deleting old evidence', async () => {
    const detected = new Date('2026-10-02T12:00:00Z');
    prepare({ status: 'completed', checkinStatus: 'no_show', noShowDetectedAt: detected }); response();
    await recordBookingAttendance(10, actor, { ...input, action: 'withdraw_attendance' });
    expect(state.events[0].evidenceSnapshot.noShowDetectedAt).toEqual(detected);
    expect(state.updates[0]).not.toHaveProperty('status');
    expect(state.updates[0].noShowDetectedAt).toBeNull();
  });
  it('does not allow an attended statement to silently become a no-show', async () => {
    prepare({}, [], [{ action: 'report_attended', visitId: null }]);
    await expect(recordBookingAttendance(10, actor, input)).rejects.toThrow(/Withdraw/);
  });
  it('never includes private admin evidence in notifications', async () => {
    prepare(); response(); await recordBookingAttendance(10, { id: 1, role: 'admin' }, { ...input, sharedMessage: undefined, internalNotes: 'SECRET' });
    expect(JSON.stringify(state.notify.mock.calls)).not.toContain('SECRET');
    expect(state.events[0].internalNotes).toBe('SECRET');
  });
  it('denies wrong-chef history access before reading private history', async () => {
    state.rows.push([context()]); await expect(readBookingAttendance(10, { id: 999, role: 'chef' })).rejects.toThrow(/not found/);
  });
  it('public history cannot expose internal notes or historical snapshots', async () => {
    state.rows.push([context()], [{ id: 1, visitId: null, action: 'report_no_show', actorRole: 'admin',
      sharedMessage: 'Public message', internalNotes: 'SECRET', evidenceSnapshot: { checkoutNotes: 'SECRET' } }], []);
    const result = await readBookingAttendance(10, { id: 3, role: 'chef' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.history[0].sharedMessage).toBe('Public message');
  });
  it('tells the chef plainly after "They didn’t come": who reported it, the policy and how to contest (WP-N)', async () => {
    state.rows.push([{ ...context(), kitchenName: 'PHASE0 Main Kitchen' }], [], []); response();
    await recordBookingAttendance(10, actor, input);
    const roleText = state.notify.mock.calls[0][6].roleText;
    expect(roleText.chef.title).toBe('PHASE0 Main Kitchen reported you didn’t arrive');
    // Owner (Oct 15): never refunded at any kitchen (50% or 100% late charge), disclosed at checkout.
    // Chefs see the kitchen's name, kitchens the chef's; the note reads once with one full stop.
    expect(roleText.chef.message).toBe('PHASE0 Main Kitchen reported you didn’t arrive. No-shows aren’t refunded. Note from PHASE0 Main Kitchen: Chef did not attend. If you were there, tell us from the booking page.');
    expect(roleText.manager).toEqual({ title: 'No-show reported · Sam Chef',
      message: 'You reported that Sam Chef didn’t come. They’ve been told. Your note: Chef did not attend. If they disagree, Local Cooks will review it with you.' });
    // The base text is Local Cooks' (admin) version: who reported whom, in plain words.
    expect(state.notify.mock.calls[0][4]).toBe('PHASE0 Main Kitchen reported that Sam Chef didn’t come. Note from PHASE0 Main Kitchen: Chef did not attend.');
    expect(roleText.chef.message).not.toMatch(/%/);
    expect(state.notify.mock.calls[0][6]).toMatchObject({ policyTreatment: 'cancellation_at_start', moneyEffectsApplied: false });
  });
  it('"They came" on a booking that closed with no check-in opens the rating request, nothing else (WP-N)', async () => {
    state.rows.push([{ ...context({ status: 'completed', feedbackRequestedAt: null }), kitchenName: 'PHASE0 Main Kitchen' }], [], []); response();
    await recordBookingAttendance(10, actor, { action: 'report_attended', expectedUpdatedAt: timestamp, expectedBookingUpdatedAt: timestamp, sharedMessage: 'Arrived about 9:10 a.m.' });
    expect(state.events[0]).toMatchObject({ action: 'report_attended' });
    expect(state.updates).toEqual([{ updatedAt: expect.any(Date) }, { feedbackRequestedAt: expect.any(Date) }]);
    expect(state.notify.mock.calls[0][6].roleText.chef.title).toBe('PHASE0 Main Kitchen confirmed your visit');
  });
});
