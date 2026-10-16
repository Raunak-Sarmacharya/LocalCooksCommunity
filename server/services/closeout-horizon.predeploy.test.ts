import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], writes: [] as any[], due: [] as any[], query: null as any, limit: 0,
  cutover: new Date('2026-10-01T00:00:00Z'), anchored: 0, send: vi.fn(async (_event: unknown) => ({ ids: [] })), reports: [] as any[] }));
vi.mock('../db', () => {
  const db: any = {
    execute: vi.fn(async () => []),
    select: (fields: any) => {
      let table: string;
      const rows = () => table === 'kitchen_booking_visits' ? state.visits : table === 'kitchen_booking_attendance_events' ? state.reports
        : table === 'users' || table === 'applications' || table === 'chef_kitchen_applications' ? [] : fields?.booking
        ? [{ booking: state.booking, timezone: 'America/St_Johns', managerId: 7, locationId: 4, kitchenName: 'Harbour Kitchen' }] : state.due.slice(0, state.limit);
      const q: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return q; },
        innerJoin: () => q, where: (query: any) => { if (fields?.id) state.query = query; return q; },
        orderBy: () => q, limit: (limit: number) => { state.limit = limit; return q; },
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
vi.mock('../lifecycle-inngest', () => ({ inngest: { send: state.send } }));
vi.mock('./kitchen-payout-service', () => ({ scheduleKitchenPayout: vi.fn() }));
import { db } from '../db';
import { persistBookingCloseout, sweepClockCloseout } from './clock-closeout';


describe('predeploy finding 9: arm saved deadlines as they enter the horizon', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); vi.clearAllMocks();
    vi.stubEnv('INNGEST_EVENT_KEY', 'mock-event-key');
    state.booking = { id: 10, bookingDate: new Date('2026-10-20'), startTime: '10:00', endTime: '11:00',
      status: 'confirmed', checkinStatus: 'not_checked_in', visitDuties: null };
    state.visits = []; state.reports = []; state.writes = []; state.due = [{ id: 10 }];
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('sweep considers an unchanged future deadline in the six-day horizon and arms it before it is due', async () => {
    await db.transaction(tx => persistBookingCloseout(10, tx));
    await vi.advanceTimersByTimeAsync(1);
    expect(state.send).not.toHaveBeenCalled();
    const saved = structuredClone(state.booking.visitDuties.clockCloseout);
    const due = new Date(saved.nextDueAt);
    vi.setSystemTime(new Date(due.getTime() - 5 * 86_400_000));
    state.writes = [];
    const result = await sweepClockCloseout();
    const query = new PgDialect().sqlToQuery(state.query);
    expect(query.params).toContain(new Date(Date.now() + 6 * 86_400_000).toISOString());
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    expect(result.changed).toBe(0);
    expect(state.booking.visitDuties.clockCloseout).toEqual(saved);
    expect(state.writes).toEqual([]);
    expect(state.send.mock.calls[0][0]).toMatchObject({ id: `deadline:closeout:10:${due.getTime()}`, data: { kind: 'closeout', id: 10, dueAt: due.toISOString() } });
  });

  it('an unchanged persist retries a missed timer with the same deduplication identity', async () => {
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    await db.transaction(tx => persistBookingCloseout(10, tx));
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    const saved = structuredClone(state.booking.visitDuties.clockCloseout);
    const next = await db.transaction(tx => persistBookingCloseout(10, tx));
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(next.changed).toBe(false);
    expect(state.booking.visitDuties.clockCloseout).toEqual(saved);
    expect(state.send.mock.calls[0]).toEqual(state.send.mock.calls[1]);
  });
});
