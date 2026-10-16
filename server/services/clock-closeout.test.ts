import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], writes: [] as any[], due: [] as any[], query: null as any, limit: 0,
  cutover: new Date('2026-10-01T00:00:00Z'), anchored: 0, reports: [] as any[] }));
vi.mock('../db', () => {
  const db: any = {
    execute: vi.fn(async () => []),
    select: (fields: any) => {
      let table: string;
      const rows = () => table === 'kitchen_booking_visits' ? state.visits : table === 'kitchen_booking_attendance_events' ? state.reports
        : table === 'users' || table === 'applications' || table === 'chef_kitchen_applications' ? [] : fields?.booking
        ? [{ booking: state.booking, timezone: 'America/St_Johns', managerId: 7, locationId: 4, kitchenName: 'Harbour Kitchen' }] : state.due.slice(0, state.limit);
      const q: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return q; },
        innerJoin: () => q, where: (query: any) => { state.queries = [...(state.queries || []), query]; state.query = query; return q; },
        orderBy: () => q, limit: (limit: number) => { state.limits = [...(state.limits || []), limit]; state.limit = limit; return q; },
        then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
      return q;
    },
    update: (table: any) => ({ set: (values: any) => ({ where: () => {
      state.writes.push({ table: table[Symbol.for('drizzle:Name')], values });
      Object.assign(table[Symbol.for('drizzle:Name')] === 'kitchen_bookings' ? state.booking : state.visits[0], values);
      return Promise.resolve([]);
    } }) }),
    transaction: async (work: any) => work(db),
  };
  return { db };
});
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24 }),
  getCloseoutNotificationsFrom: async () => { state.anchored++; return state.cutover; } }));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 15 }) }));
vi.mock('./visit-duties', () => ({ kitchenDuties: async () => ({ version: 2, arrival: { enabled: true, items: [], photos: [] }, departure: { enabled: true, items: [], photos: [] }, checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn(async () => {}) }));
const timer = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock('./deadline-timer', () => ({ deadlineHorizonMs: 6 * 86_400_000, scheduleDeadlineTimer: timer.schedule }));
import { db } from '../db';
import { persistBookingCloseout, projectBookingCloseout, recordKitchenInspection, sweepClockCloseout } from './clock-closeout';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { workerContext } from './worker-context';

describe('closeout persistence and reads (mocked database/providers)', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T14:00:00Z')); vi.clearAllMocks();
    state.booking = { id: 10, bookingDate: new Date('2026-10-13'), startTime: '10:00', endTime: '11:00', status: 'confirmed', checkinStatus: 'not_checked_in', visitDuties: null };
    state.visits = []; state.writes = []; state.due = [{ id: 10 }]; state.cutover = new Date('2026-10-01T00:00:00Z'); state.anchored = 0; state.reports = [];
  });
  afterEach(() => vi.useRealTimers());
  it('completes never-tapped service while preserving unknown attendance and approval fields; no rating request (WP-N)', async () => {
    const result = await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(result.projection?.status).toBe('completed');
    expect(result.projection?.visits[0].attendance).toBe('unknown');
    expect(state.booking.feedbackRequestedAt).toBeUndefined();
    expect(state.booking.checkinStatus).toBe('not_checked_in');
    expect(state.booking).not.toHaveProperty('checkoutApprovedAt');
    expect(queueBookingLifecycleEvent).toHaveBeenCalledWith(expect.anything(), 10, 'service_ended', expect.anything(), expect.anything(), undefined,
      expect.objectContaining({ serviceEndedAt: '2026-10-13T13:45:00.000Z', noArrival: true, notificationRecipientPolicy: 'participants' }));
  });
  it('arms and re-arms the next closeout deadline even when the saved clock is unchanged (WP-T)', async () => {
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); // before the booked start: service end is the next deadline
    const first = await db.transaction(tx => persistBookingCloseout(10, tx));
    const dueAt = first.projection!.nextDueAt;
    expect(dueAt).toEqual(expect.any(String));
    expect(timer.schedule).toHaveBeenCalledTimes(1);
    expect(timer.schedule).toHaveBeenCalledWith('closeout', 10, dueAt, Date.now());
    // The same deadline is re-armed; Inngest dedupes its event identity.
    await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(timer.schedule).toHaveBeenCalledTimes(2);
    // Each timer fires just after its deadline: the saved clock advances and arms the next one, until the booking is closed.
    let due: string | null = dueAt, last = first;
    for (let step = 0; step < 10 && due; step++) {
      vi.setSystemTime(new Date(Date.parse(due) + 5_000));
      last = await db.transaction(tx => persistBookingCloseout(10, tx));
      if (last.projection!.nextDueAt) expect(timer.schedule).toHaveBeenLastCalledWith('closeout', 10, last.projection!.nextDueAt, Date.now());
      due = last.projection!.nextDueAt;
    }
    expect(due).toBeNull();
    expect(last.projection?.status).toBe('completed');
    const armed = timer.schedule.mock.calls.map(call => Date.parse(call[2]));
    expect(armed.length).toBeGreaterThan(2);
    expect(armed).toEqual([...armed].sort((a, b) => a - b)); // deadlines advance in order; retries may repeat the same deadline
    expect(armed[0]).toBe(armed[1]);
    expect(new Set(armed.slice(1)).size).toBe(armed.length - 1);
  });
  it('words a booked time that ended with no arrival per role: the kitchen is asked, the chef is told plainly (WP-N)', async () => {
    await db.transaction(tx => persistBookingCloseout(10, tx));
    const call = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(args => args[2] === 'service_ended')!;
    const roleText = (call[6] as any).roleText;
    expect(roleText.manager).toEqual({ title: 'No check-in from the chef', message: 'Tue, Oct 13, 10:00 a.m. Did they come? Tell us by Oct 14, 11:00 a.m.' });
    expect(roleText.chef).toEqual({ title: 'No check-in recorded',
      message: 'We didn\u2019t see a check-in for your booking at Harbour Kitchen (Oct 13, 10:00 a.m.). If you were there, let us know.' });
  });
  it('a kitchen "They came" statement counts as attended: the rating request opens and the visit is not a no-arrival (WP-N)', async () => {
    state.reports = [{ bookingId: 10, visitId: null, action: 'report_attended' }];
    const result = await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(result.projection?.visits[0].attendance).toBe('unknown');
    expect(state.booking.feedbackRequestedAt).toEqual(new Date('2026-10-13T14:00:00Z'));
    const call = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(args => args[2] === 'service_ended')!;
    expect(call[6]).not.toHaveProperty('noArrival');
    const projected = await projectBookingCloseout(state.booking, 'America/St_Johns', [], undefined, db);
    expect(projected.closeout.visits[0].attendance).toBe('recorded');
  });
  it('a chef still checked in at the end is asked to check out now (never told the visit is complete), and the kitchen is told', async () => {
    Object.assign(state.booking, { checkinStatus: 'checked_in', checkedInAt: new Date('2026-10-13T13:05:00Z') });
    await db.transaction(tx => persistBookingCloseout(10, tx));
    const call = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(args => args[2] === 'service_ended')!;
    const roleText = (call[6] as any).roleText;
    expect(roleText.chef).toMatchObject({ title: 'Your booked time has ended' });
    expect(roleText.chef.message).toMatch(/still checked in\. Please check out now — the kitchen may charge for the extra time\./);
    expect(roleText.manager.message).toMatch(/hasn’t checked out\. Message them, or record when they left/);
  });
  it('delayed and duplicate sweep is idempotent and records the due instant, never worker time', async () => {
    vi.setSystemTime(new Date('2026-10-20T14:00:00Z'));
    expect((await sweepClockCloseout()).changed).toBe(1);
    const before = structuredClone(state.booking); const writes = state.writes.length;
    expect((await sweepClockCloseout()).changed).toBe(0);
    expect(state.booking).toEqual(before); expect(state.writes).toHaveLength(writes);
    expect(Object.values(state.booking.visitDuties.clockCloseout.inspections)).toEqual([{ outcome: 'auto_closed_uninspected', closedAt: '2026-10-14T13:30:00.000Z' }]);
    // No arrival recorded: no chef "Visit complete" (WP-N), only the start notice and the manager's window notice.
    expect(queueBookingLifecycleEvent).toHaveBeenCalledTimes(2);
  });
  it('requests feedback for attended completion and preserves its original timestamp on later sweeps', async () => {
    state.booking.checkinStatus = 'checked_in'; state.booking.checkedInAt = new Date('2026-10-13T12:30:00Z');
    await db.transaction(tx => persistBookingCloseout(10, tx));
    const requested = state.booking.feedbackRequestedAt;
    expect(requested).toEqual(new Date('2026-10-13T14:00:00Z'));
    vi.setSystemTime(new Date('2026-10-20T14:00:00Z')); await sweepClockCloseout();
    expect(state.booking.feedbackRequestedAt).toEqual(requested);
  });
  it('does not request feedback for reported no-shows', async () => {
    state.booking.checkinStatus = 'no_show'; state.booking.noShowDetectedAt = new Date();
    await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(state.booking.feedbackRequestedAt).toBeUndefined();
  });
  it.each(['cancelled', 'pending', 'cancellation_requested'])('does not request feedback for %s', async status => {
    state.booking.status = status; await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(state.booking.feedbackRequestedAt).toBeUndefined();
  });
  it('closes an old booking silently: state is saved, no notices are queued, and a repeat changes nothing', async () => {
    // Rollout anchored the cutover after this booking finished (service ended 13:45Z, inspection closed 14 Oct 13:30Z).
    state.cutover = new Date('2026-10-20T00:00:00Z');
    vi.setSystemTime(new Date('2026-10-21T14:00:00Z'));
    expect((await sweepClockCloseout()).changed).toBe(1);
    expect(state.booking.status).toBe('completed');
    expect(state.booking.visitDuties.clockCloseout.serviceEndedAt).toBe('2026-10-13T13:45:00.000Z');
    expect(Object.values(state.booking.visitDuties.clockCloseout.inspections)).toHaveLength(1);
    expect(queueBookingLifecycleEvent).not.toHaveBeenCalled();
    const before = structuredClone(state.booking);
    expect((await sweepClockCloseout()).changed).toBe(0);
    expect(state.booking).toEqual(before); expect(queueBookingLifecycleEvent).not.toHaveBeenCalled();
  });
  it('notifies for a booking that finishes after the cutover: the chef and manager once, the manager alone for the inspection', async () => {
    state.cutover = new Date('2026-10-13T00:00:00Z');
    Object.assign(state.booking, { checkinStatus: 'checkout_requested', checkedInAt: new Date('2026-10-13T12:35:00Z'), checkoutRequestedAt: new Date('2026-10-13T13:20:00Z') });
    vi.setSystemTime(new Date('2026-10-20T14:00:00Z'));
    expect((await sweepClockCloseout()).changed).toBe(1);
    expect(vi.mocked(queueBookingLifecycleEvent).mock.calls.map(call => [call[2], (call[6] as any).recipientPolicy])).toEqual([
      ['service_ended', 'participants'], ['visit_closed', 'chef'], ['inspection_auto_closed', 'manager']]);
    expect((await sweepClockCloseout()).changed).toBe(0);
    expect(queueBookingLifecycleEvent).toHaveBeenCalledTimes(3);
  });
  it('closes an unanswered no-check-in visit without telling the chef it is complete (WP-N)', async () => {
    state.cutover = new Date('2026-10-13T00:00:00Z');
    vi.setSystemTime(new Date('2026-10-20T14:00:00Z'));
    expect((await sweepClockCloseout()).changed).toBe(1);
    expect(vi.mocked(queueBookingLifecycleEvent).mock.calls.map(call => [call[2], (call[6] as any).recipientPolicy])).toEqual([
      ['service_ended', 'participants'], ['inspection_auto_closed', 'manager']]);
  });
  it('notifies when service ended just after the cutover', async () => {
    // Service ended 13:45Z, after the cutover at 13:00Z.
    state.cutover = new Date('2026-10-13T13:00:00Z');
    vi.setSystemTime(new Date('2026-10-13T14:00:00Z'));
    await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(queueBookingLifecycleEvent).toHaveBeenCalledTimes(1);
  });
  it('does not announce while a cancellation request is unresolved', async () => {
    state.booking.status = 'cancellation_requested';
    await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(state.booking.visitDuties.clockCloseout.serviceEndedAt).toBeTruthy();
    expect(queueBookingLifecycleEvent).not.toHaveBeenCalled();
  });
  it('anchors the notification cutover at the start of each sweep, before closing anything', async () => {
    await sweepClockCloseout();
    expect(state.anchored).toBeGreaterThanOrEqual(1);
  });
  it('two dated visits with identical hours persist and close independently by visit id', async () => {
    state.booking.selectedSlots = [{ startTime: '10:00', endTime: '11:00' }, { startTime: '10:00', endTime: '11:00', date: '2026-10-14' }];
    state.visits = [{ id: 31, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'checked_out', checkoutApprovedBy: 7 },
      { id: 32, blockIndex: 1, startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in' }];
    vi.setSystemTime(new Date('2026-10-14T14:00:00Z'));
    const first = await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(first.projection?.status).toBe('completed');
    expect(first.projection?.visits.map(visit => [visit.key, visit.phase])).toEqual([['31', 'ended'], ['32', 'ended']]);
    vi.setSystemTime(new Date('2026-10-20T14:00:00Z'));
    expect((await sweepClockCloseout()).changed).toBe(1);
    const saved = state.booking.visitDuties.clockCloseout;
    expect(Object.keys(saved.inspections)).toEqual(['32']);
    expect(saved.inspections['32'].closedAt).toBe('2026-10-15T13:30:00.000Z');
    expect(state.booking.status).toBe('completed');
    expect(queueBookingLifecycleEvent).toHaveBeenCalledWith(expect.anything(), 10, 'inspection_auto_closed', expect.anything(), expect.anything(), undefined,
      expect.objectContaining({ visitKey: '32' }));
  });
  it('read projection derives completion and auto-close without any writes or events', async () => {
    vi.setSystemTime(new Date('2026-10-20T14:00:00Z'));
    const result = await projectBookingCloseout(state.booking, 'America/St_Johns', []);
    expect(result.status).toBe('completed'); expect(result.closeout.visits[0].inspection.outcome).toBe('auto_closed_uninspected');
    expect(state.booking.status).toBe('confirmed'); expect(state.writes).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled(); expect(queueBookingLifecycleEvent).not.toHaveBeenCalled();
  });
  it('allows a manager inspection without taps after service completion and preserves missing departure', async () => {
    await db.transaction(tx => persistBookingCloseout(10, tx));
    expect((await recordKitchenInspection(10, 7, undefined, 'Inspected')).success).toBe(true);
    expect(state.booking.status).toBe('completed');
    expect(state.booking.checkoutApprovedBy).toBe(7); expect(state.booking).not.toHaveProperty('checkedOutAt');
    expect(state.booking).not.toHaveProperty('checkoutRequestedAt');
  });
  it('early clear does not complete service', async () => {
    vi.setSystemTime(new Date('2026-10-13T13:00:00Z'));
    state.booking.checkoutRequestedAt = new Date('2026-10-13T12:45:00Z');
    const result = await recordKitchenInspection(10, 7);
    expect(result.success).toBe(true); expect(state.booking.status).toBe('confirmed');
  });
  it.each([['2026-10-13T12:00:00Z', 7], ['2026-10-15T12:00:00Z', 7], ['2026-10-13T14:00:00Z', 99]])('rejects inspection at %s by %s without writes', async (time, manager) => {
    vi.setSystemTime(new Date(time)); expect((await recordKitchenInspection(10, manager)).success).toBe(false); expect(state.writes).toEqual([]);
  });
  it('keeps a timely claim case open without delaying service or changing the claim', async () => {
    state.booking.checkinStatus = 'checkout_claim_filed';
    const result = await db.transaction(tx => persistBookingCloseout(10, tx));
    expect(result.projection?.status).toBe('completed'); expect(result.projection?.visits[0].inspection.outcome).toBe('issue_filed');
    expect(state.writes.every(write => write.table === 'kitchen_bookings')).toBe(true);
  });
  it('preserves historical completed/cleared records byte for byte', async () => {
    state.booking.status = 'completed'; state.booking.checkinStatus = 'checked_out';
    const before = structuredClone(state.booking);
    expect((await db.transaction(tx => persistBookingCloseout(10, tx))).changed).toBe(false);
    expect(state.booking).toEqual(before); expect(state.writes).toEqual([]);
  });
  it('caps the batch, saves the keyset checkpoint and wraps an empty page', async () => {
    const checkpoints: any[] = [];
    state.due = []; state.queries = []; state.limits = [];
    const context: any = { database: db, deadline: Infinity, taskDeadline: Infinity, cursors: { clockCloseout: 123 },
      checkpoint: async (key: string, id: number) => checkpoints.push([key, id]) };
    await workerContext.run(context, () => sweepClockCloseout());
    // Due work: 3 per tick on its own cursor; timer arming: a separate write-free page that never takes a due slot.
    expect(state.limits).toEqual([3, 25]);
    expect(checkpoints).toEqual([['clockCloseout', 0], ['closeoutArm', 0]]);
    const query = new PgDialect().sqlToQuery(state.queries[0]);
    expect(query.params).toContain(123); expect(query.sql).toContain('nextDueAt');
    // The due page selects only deadlines that have passed (no horizon bound mixed in).
    expect(query.sql).toContain('<=');
    const arm = new PgDialect().sqlToQuery(state.queries[1]);
    expect(arm.sql).toContain('>'); expect(arm.sql).toContain('<=');
    await expect(sweepClockCloseout(4)).rejects.toThrow('three');
  });
});
