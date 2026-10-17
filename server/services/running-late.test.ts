import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][], queue: vi.fn(), block: null as any }));
vi.mock('../db', () => ({ db: { select: () => chain(), transaction: (run: any) => run({ select: () => chain() }) } }));
const chain = (): any => { const value: any = { from: () => value, innerJoin: () => value, where: () => value, orderBy: () => value, limit: () => value, for: () => value,
  then: (resolve: any, reject: any) => Promise.resolve(state.rows.shift() ?? []).then(resolve, reject) }; return value; };
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Maya Chen' }));
vi.mock('./advance-reminders', () => ({ reminderVisitTimes: () => [state.block] }));
import { readRunningLate, reportRunningLate, RunningLateError } from './running-late';

const start = new Date('2026-10-14T13:00:00Z'), end = new Date('2026-10-14T17:00:00Z');
const booking = (extra: Record<string, unknown> = {}) => [{ booking: { id: 10, chefId: 3, status: 'confirmed', checkinStatus: 'not_checked_in', ...extra }, kitchenName: 'Harbour', timezone: 'UTC' }];
const event = (minutes: number, reportedAt: string) => ({ createdAt: new Date(reportedAt), metadata: { minutes, reportedAt, expectedAt: new Date(Date.parse(reportedAt) + minutes * 60000).toISOString(), note: null, visitId: null } });
const report = (minutes: unknown, now: string, input: Record<string, unknown> = {}) => reportRunningLate({ bookingId: 10, chefId: 3, minutes, note: null, ...input }, new Date(now));
beforeEach(() => { state.rows = []; state.queue.mockReset(); state.block = { index: 0, start, end }; });

describe('chef running-late heads-up', () => {
  it('queues one manager notice and returns what the chef sees', async () => {
    state.rows = [booking(), [], []];
    const result = await report(15, '2026-10-14T13:22:00Z', { note: 'Traffic' });
    expect(result.created).toBe(true);
    expect(result.runningLate).toMatchObject({ minutes: 15, reportedAt: '2026-10-14T13:22:00.000Z', expectedAt: '2026-10-14T13:37:00.000Z', note: 'Traffic', count: 1 });
    expect(state.queue).toHaveBeenCalledTimes(1);
    const [, id, kind, title, message, actor, metadata] = state.queue.mock.calls[0];
    expect([id, kind, title, actor]).toEqual([10, 'running_late', 'Maya Chen is running late', 3]);
    expect(message).toMatch(/^Maya Chen is running about 15 minutes late\. Their booking still ends at 5:00 p\.m\./);
    expect(metadata).toMatchObject({ recipientPolicy: 'manager', minutes: 15, endsAt: end.toISOString(), note: 'Traffic', visitId: null });
  });
  it('is idempotent for the same choice while the stated arrival is still ahead', async () => {
    state.rows = [booking(), [], [event(30, '2026-10-14T13:10:00Z')]];
    const result = await report(30, '2026-10-14T13:20:00Z');
    expect(result.created).toBe(false);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('lets the chef change their choice, and limits the heads-ups per booking to three', async () => {
    state.rows = [booking(), [], [event(15, '2026-10-14T13:05:00Z')]];
    expect((await report(60, '2026-10-14T13:10:00Z')).runningLate.count).toBe(2);
    state.rows = [booking(), [], [event(60, '2026-10-14T13:30:00Z'), event(30, '2026-10-14T13:20:00Z'), event(15, '2026-10-14T13:05:00Z')]];
    await expect(report(15, '2026-10-14T13:40:00Z')).rejects.toMatchObject({ status: 429, code: 'RUNNING_LATE_LIMIT' });
  });
  it('refuses outside the window, after check-in, for other chefs, and for unknown choices', async () => {
    state.rows = [booking()];
    await expect(report(15, '2026-10-14T12:20:00Z')).rejects.toMatchObject({ status: 409, code: 'RUNNING_LATE_UNAVAILABLE' });
    state.rows = [booking()];
    await expect(report(15, '2026-10-14T17:00:00Z')).rejects.toMatchObject({ status: 409 });
    state.rows = [booking({ checkinStatus: 'checked_in' })];
    await expect(report(15, '2026-10-14T13:20:00Z')).rejects.toMatchObject({ status: 409 });
    state.rows = [booking({ chefId: 99 })];
    await expect(report(15, '2026-10-14T13:20:00Z')).rejects.toMatchObject({ status: 404 });
    await expect(report(45, '2026-10-14T13:20:00Z')).rejects.toBeInstanceOf(RunningLateError);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('opens 30 minutes before the booked start', async () => {
    state.rows = [booking(), [], []];
    expect((await report(15, '2026-10-14T12:30:00Z')).created).toBe(true);
  });
  it('counts running-late updates for the selected dated day independently', async () => {
    const visits = [{ id: 22, blockIndex: 0, visitDate: '2026-10-14', scheduleRevision: 1, scheduleState: 'active', checkinStatus: 'not_checked_in' }];
    const older = [15, 30, 60].map(minutes => ({ ...event(minutes, '2026-10-12T13:00:00Z'), metadata: { ...event(minutes, '2026-10-12T13:00:00Z').metadata, visitId: 21 } }));
    state.rows = [booking({ scheduleRevision: 1 }), visits, older];
    expect((await report(15, '2026-10-14T13:20:00Z', { visitId: 22 })).runningLate).toMatchObject({ count: 1, visitId: 22 });
    state.rows = [[{ ...event(15, '2026-10-14T13:20:00Z'), metadata: { ...event(15, '2026-10-14T13:20:00Z').metadata, visitId: 22, scheduleRevision: 1 } }, ...older], [{ scheduleRevision: 1 }], visits];
    expect(await readRunningLate(10)).toMatchObject({ count: 1, visitId: 22 });
  });
  it('drops running-late evidence for a cancelled day or an old schedule from current readers', async () => {
    const dated = { ...event(15, '2026-10-14T13:20:00Z'), metadata: { ...event(15, '2026-10-14T13:20:00Z').metadata, scheduleRevision: 1, visitId: 22 } };
    state.rows = [[dated], [{ scheduleRevision: 1 }], [{ id: 22, visitDate: '2026-10-14', scheduleRevision: 1, scheduleState: 'cancelled' }]];
    expect(await readRunningLate(10)).toBeNull();
    state.rows = [[dated], [{ scheduleRevision: 2 }], [{ id: 22, visitDate: '2026-10-14', scheduleRevision: 1, scheduleState: 'active' }]];
    expect(await readRunningLate(10)).toBeNull();
  });
  it('reads the latest heads-up back with the number sent', async () => {
    state.rows = [[event(30, '2026-10-14T13:20:00Z'), event(15, '2026-10-14T13:05:00Z')]];
    expect(await readRunningLate(10)).toMatchObject({ minutes: 30, count: 2, visitId: null });
    state.rows = [[]];
    expect(await readRunningLate(10)).toBeNull();
  });
});
