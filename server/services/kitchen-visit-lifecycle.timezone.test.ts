import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const state = vi.hoisted(() => ({ context: {} as any, duties: {} as any, parent: {} as any,
  method: 'self' as 'code' | 'self', verify: vi.fn(), writes: [] as any[], conditions: [] as any[], won: true, queue: vi.fn(), capture: vi.fn(), checkin: vi.fn(), checkout: vi.fn(), lateOpen: vi.fn(async () => false), persist: vi.fn(async () => ({ changed: true })) }));
vi.mock('../db', () => {
  const db: any = {
    select: (projection?: any) => { const q: any = { from: () => q, innerJoin: () => q, where: () => q,
      limit: async () => [projection?.visit ? state.context : projection ? state.parent : state.context.visit] }; return q; },
    execute: async () => [],
    update: () => ({ set: (values: any) => ({ where: (condition: any) => {
      state.conditions.push(condition);
      return { returning: async () => { if (!state.won) return []; state.writes.push(values); return [{ id: 5 }]; } };
    } }) }),
  };
  db.transaction = async (run: any) => run(db);
  return { db };
});
vi.mock('./visit-duties', () => ({ kitchenDuties: async () => state.duties,
  currentKitchenDuties: async () => ({ ...state.duties, arrival: { ...state.duties.arrival, enabled: true }, departure: { ...state.duties.departure, enabled: true } }),
  validateCurrentKitchenSubmission: vi.fn(async () => {}), captureKitchenDuties: state.capture }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./kitchen-checkout-service', () => ({ sendCheckinNotification: state.checkin,
  sendCheckoutRequestNotification: state.checkout, sendCheckoutClearedNotification: vi.fn() }));
vi.mock('./kitchen-booking-visits', () => ({ ensureKitchenBookingVisits: vi.fn() }));
vi.mock('./checkin-checkout-checklist', () => ({}));
vi.mock('./lifecycle-settings', () => ({}));
vi.mock('./worker-context', () => ({ inRecurringWorker: () => false }));
vi.mock('./clock-closeout', () => ({ lateDepartureOpen: state.lateOpen, persistBookingCloseout: state.persist }));
vi.mock('./visit-code-challenge', async importOriginal => ({
  ...await importOriginal<typeof import('./visit-code-challenge')>(),
  arrivalAlreadyRecordedForRequest: async () => false,
  verifyArrivalCode: state.verify,
  gateArrivalInTx: async () => ({ kind: 'ok', method: state.method }),
  consumeForArrival: vi.fn(),
}));
import { checkinKitchenVisit, checkoutKitchenVisit } from './kitchen-visit-lifecycle';

const zones = [
  { timezone: 'Asia/Tokyo', start: '2026-10-02T00:00:00Z' },
  { timezone: 'America/Toronto', start: '2026-10-02T13:00:00Z' },
  { timezone: 'America/Vancouver', start: '2026-10-02T16:00:00Z' },
  { timezone: 'UTC', start: '2026-10-02T09:00:00Z' },
  { timezone: 'America/St_Johns', start: '2026-10-02T11:30:00Z' },
];

describe('split kitchen visit timezone (mocked DB and notifications, real time helpers)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers();
    state.method = 'self';
    state.verify.mockImplementation(async () => ({ kind: 'ok', method: state.method }));
    state.context = { timezone: 'America/Vancouver', locationId: 4, managerId: 2,
      booking: { id: 10, chefId: 3, status: 'confirmed', bookingDate: new Date('2026-10-02T00:00:00Z'),
        startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '08:00', updatedAt: new Date('2026-10-01T00:00:00Z') },
      visit: { id: 5, bookingId: 10, startTime: '09:00', endTime: '10:00', checkinStatus: 'not_checked_in' } };
    state.parent = { status: 'confirmed', updatedAt: state.context.booking.updatedAt };
    state.duties = { version: 1, checkinWindowMinutesBefore: 15,
      arrival: { enabled: true, items: [], photos: [] }, departure: { enabled: true, items: [], photos: [] } };
    state.writes = []; state.conditions = []; state.won = true;
  });
  afterEach(() => vi.useRealTimers());

  it.each(['code', 'self'] as const)('stores %s as the check-in method returned by the arrival gate', async method => {
    state.method = method;
    vi.setSystemTime(new Date('2026-10-02T16:00:00Z'));
    expect(await checkinKitchenVisit(10, 5, 3, undefined, undefined, undefined,
      method === 'code' ? '123456' : undefined, 'arrival-request')).toMatchObject({ success: true });
    expect(state.verify).toHaveBeenCalledWith(expect.objectContaining({ visitCode: method === 'code' ? '123456' : undefined }));
    expect(state.writes[0]).toMatchObject({ checkinStatus: 'checked_in', checkedInMethod: method });
  });

  describe.each(zones)('$timezone arrival', ({ timezone, start }) => {
    it.each([
      { offset: -15 * 60_000 - 1, success: false },
      { offset: -15 * 60_000, success: true, wall: '08:45' },
      { offset: 60 * 60_000, success: true, wall: '10:00' },
      { offset: 60 * 60_000 + 1, success: false },
    ])('offset $offset ms from scheduled start: success=$success', async ({ offset, success, wall }) => {
      state.context.timezone = timezone;
      const now = new Date(Date.parse(start) + offset); vi.setSystemTime(now);
      expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(success);
      if (success) {
        expect(state.writes[0]).toMatchObject({ checkedInAt: now, updatedAt: now, actualStartTime: wall });
        expect(state.writes[0].checkedInAt.toISOString()).toBe(now.toISOString());
        expect(state.queue).toHaveBeenCalledOnce(); expect(state.checkin).toHaveBeenCalledOnce();
      } else { expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.checkin).not.toHaveBeenCalled(); }
    });
  });

  it.each(zones)('$timezone departure-only rejects before start and accepts exact start', async ({ timezone, start }) => {
    state.context.timezone = timezone; state.duties.arrival.enabled = false;
    vi.setSystemTime(new Date(Date.parse(start) - 1));
    expect((await checkoutKitchenVisit(10, 5, 3)).success).toBe(false);
    expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
    const now = new Date(start); vi.setSystemTime(now);
    expect((await checkoutKitchenVisit(10, 5, 3)).success).toBe(true);
    expect(state.writes[0]).toMatchObject({ actualEndTime: '09:00', checkoutRequestedAt: now, updatedAt: now });
    expect(state.writes[0]).not.toHaveProperty('checkedInAt');
    expect(state.checkout).toHaveBeenCalledWith(10, 3, 5);
    expect(new PgDialect().sqlToQuery(state.conditions[0]).params).toEqual(expect.arrayContaining([10, 5, 'not_checked_in']));
  });

  it.each([
    { timezone: 'America/Vancouver', date: '2026-10-02', windowStart: '08:00', visitStart: '00:00', visitEnd: '01:00', start: '2026-10-03T07:00:00Z', end: '2026-10-03T08:00:00Z' },
    { timezone: 'UTC', date: '2026-10-02', windowStart: null, visitStart: '00:00', visitEnd: '01:00', start: '2026-10-03T00:00:00Z', end: '2026-10-03T01:00:00Z' },
    { timezone: 'America/Toronto', date: '2026-03-07', windowStart: '08:00', visitStart: '03:00', visitEnd: '04:00', start: '2026-03-08T07:00:00Z', end: '2026-03-08T08:00:00Z' },
    { timezone: 'America/Toronto', date: '2026-10-31', windowStart: '08:00', visitStart: '03:00', visitEnd: '04:00', start: '2026-11-01T08:00:00Z', end: '2026-11-01T09:00:00Z' },
  ])('uses next calendar day for $timezone $date overnight tail, including DST', async ({ timezone, date, windowStart, visitStart, visitEnd, start, end }) => {
    state.context.timezone = timezone;
    Object.assign(state.context.booking, { bookingDate: new Date(`${date}T00:00:00Z`), startTime: '23:00', operatingWindowStartTime: windowStart });
    Object.assign(state.context.visit, { startTime: visitStart, endTime: visitEnd });
    vi.setSystemTime(new Date(Date.parse(start) - 86_400_000));
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false); expect(state.writes).toEqual([]);
    vi.setSystemTime(new Date(Date.parse(start) - 15 * 60_000 - 1));
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false); expect(state.writes).toEqual([]);
    vi.setSystemTime(new Date(Date.parse(start) - 15 * 60_000));
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(true);
    expect(state.writes[0].checkedInAt.toISOString()).toBe(new Date(Date.parse(start) - 15 * 60_000).toISOString());
    vi.setSystemTime(new Date(end)); expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(true);
    vi.setSystemTime(new Date(Date.parse(end) + 1)); expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false);
    state.context.visit.checkinStatus = 'not_checked_in'; state.duties.arrival.enabled = false;
    vi.setSystemTime(new Date(Date.parse(start) - 1)); expect((await checkoutKitchenVisit(10, 5, 3)).success).toBe(false);
    vi.setSystemTime(new Date(start)); expect((await checkoutKitchenVisit(10, 5, 3)).success).toBe(true);
    expect(state.writes.at(-1)).toMatchObject({ actualEndTime: visitStart, checkoutRequestedAt: new Date(start) });
  });

  it.each([null, undefined, ''])('retains St. Johns fallback when saved zone is %s', async timezone => {
    state.context.timezone = timezone; vi.setSystemTime(new Date('2026-10-02T11:15:00Z'));
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(true);
    expect(state.writes[0].actualStartTime).toBe('08:45');
  });
  it('formats ordinary checkout in kitchen time without changing the UTC request instant', async () => {
    state.context.visit.checkinStatus = 'checked_in'; const now = new Date('2026-10-02T16:25:00Z'); vi.setSystemTime(now);
    expect((await checkoutKitchenVisit(10, 5, 3)).success).toBe(true);
    expect(state.writes[0]).toMatchObject({ checkoutRequestedAt: now, actualEndTime: '09:25', updatedAt: now });
  });
  it('allows day 2 arrival after day 1 was missed, using the selected date and anchor', async () => {
    state.context.booking.scheduleRevision = 1; state.parent.scheduleRevision = 1;
    state.context.visit = { ...state.context.visit, visitDate: '2026-10-05', scheduleRevision: 1, scheduleState: 'active', blockIndex: 2,
      operatingWindowStartTime: '08:00' };
    vi.setSystemTime(new Date('2026-10-05T16:00:00Z'));
    expect(await checkinKitchenVisit(10, 5, 3)).toMatchObject({ success: true });
    expect(state.writes[0].checkedInAt).toEqual(new Date('2026-10-05T16:00:00Z'));
    state.writes = []; state.context.visit.scheduleState = 'cancelled';
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false);
    state.context.visit.scheduleState = 'active'; state.context.visit.scheduleRevision = 0;
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false); expect(state.writes).toEqual([]);
  });
  it('preserves chef ownership, task validation and parent/CAS failure without notices', async () => {
    vi.setSystemTime(new Date('2026-10-02T16:00:00Z'));
    expect((await checkinKitchenVisit(10, 5, 999)).success).toBe(false);
    expect(state.writes).toEqual([]);
    state.duties.arrival.items = [{ id: 'clean', label: 'Clean', required: true }];
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false);
    state.duties.arrival.items = []; state.parent.status = 'cancelled';
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false);
    state.parent.status = 'confirmed'; state.won = false;
    expect((await checkinKitchenVisit(10, 5, 3)).success).toBe(false);
    expect(state.writes).toEqual([]); expect(state.queue).not.toHaveBeenCalled(); expect(state.capture).not.toHaveBeenCalled();
  });
  it('a chef still checked in after the end can check out late, even once the booking reads completed; departure = now', async () => {
    state.context.visit.checkinStatus = 'checked_in'; state.context.booking.status = 'completed'; state.parent.status = 'completed';
    const now = new Date('2026-10-02T18:40:00Z'); vi.setSystemTime(now); // 11:40 Vancouver, 1 h 40 min after the 10:00 end
    state.lateOpen.mockResolvedValueOnce(true);
    expect(await checkoutKitchenVisit(10, 5, 3)).toMatchObject({ success: true, checkinStatus: 'checkout_requested' });
    expect(state.writes[0]).toMatchObject({ checkinStatus: 'checkout_requested', checkoutRequestedAt: now, actualEndTime: '11:40' });
    expect(state.persist).toHaveBeenCalledWith(10, expect.anything());
  });
  it('refuses a late checkout once the inspection window has closed', async () => {
    state.context.visit.checkinStatus = 'checked_in'; state.context.booking.status = 'completed'; state.parent.status = 'completed';
    vi.setSystemTime(new Date('2026-10-04T18:40:00Z'));
    state.lateOpen.mockResolvedValueOnce(false);
    expect(await checkoutKitchenVisit(10, 5, 3)).toMatchObject({ success: false, error: expect.stringMatching(/checkout window has closed/) });
    expect(state.writes).toEqual([]);
  });
});
