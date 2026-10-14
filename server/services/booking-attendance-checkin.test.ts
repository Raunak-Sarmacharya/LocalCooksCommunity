import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { kitchens, locations } from '@shared/schema';

const state = vi.hoisted(() => ({
  rows: [] as any[][], updates: [] as any[], attempts: [] as any[], conditions: [] as any[],
  selects: [] as any[], joins: [] as any[], locks: [] as any[], won: true, duties: {} as any,
  capture: vi.fn(), queue: vi.fn(), deliver: vi.fn(),
}));
vi.mock('../db', () => {
  const db: any = {
    select: (fields: any) => {
      state.selects.push(fields);
      const chain: any = { from: () => chain,
        innerJoin: (table: any) => { state.joins.push(table); return chain; }, where: () => chain,
        limit: async () => state.rows.shift() || [] };
      return chain;
    },
    // Visit-code challenge lookups are not row locks on the booking; legacy bookings have no challenge row.
    execute: async (query: any) => { if (!JSON.stringify(query.queryChunks?.map((chunk: any) => chunk?.value ?? '')).includes('kitchen_visit_arrival_challenges')) state.locks.push(query); return []; },
    update: () => ({ set: (value: any) => {
      state.attempts.push(value);
      return { where: (condition: any) => {
        state.conditions.push(condition);
        return { returning: async () => {
          if (!state.won) return [];
          state.updates.push(value); return [{ id: 10 }];
        } };
      } };
    } }),
  };
  db.transaction = async (run: any) => run(db);
  return { db };
});
vi.mock('./visit-duties', () => ({ kitchenDuties: async () => state.duties,
  currentKitchenDuties: async () => ({ ...state.duties, arrival: { ...state.duties.arrival, enabled: true }, departure: { ...state.duties.departure, enabled: true } }),
  validateCurrentKitchenSubmission: vi.fn(async () => {}), captureKitchenDuties: state.capture }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue, deliverBookingLifecycleEvents: state.deliver }));
vi.mock('./checkin-checkout-checklist', () => ({}));
import { requestKitchenCheckin, requestKitchenCheckout } from './kitchen-checkout-service';

const booking = { id: 10, chefId: 3, kitchenId: 4, locationId: 5, bookingDate: new Date('2026-10-02T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'), startTime: '09:00', endTime: '17:00',
  operatingWindowStartTime: null, timezone: 'Asia/Calcutta', checkinStatus: 'not_checked_in', status: 'confirmed' };
// UTC expectations are written independently of the converters used by the service.
const zones = [
  { timezone: 'Asia/Calcutta', start: '2026-10-02T03:30:00Z', end: '2026-10-02T11:30:00Z' },
  { timezone: 'Asia/Tokyo', start: '2026-10-02T00:00:00Z', end: '2026-10-02T08:00:00Z' },
  { timezone: 'America/Toronto', start: '2026-10-02T13:00:00Z', end: '2026-10-02T21:00:00Z' },
  { timezone: 'America/Vancouver', start: '2026-10-02T16:00:00Z', end: '2026-10-03T00:00:00Z' },
  { timezone: 'UTC', start: '2026-10-02T09:00:00Z', end: '2026-10-02T17:00:00Z' },
  { timezone: 'America/St_Johns', start: '2026-10-02T11:30:00Z', end: '2026-10-02T19:30:00Z' },
];
const overnight = [
  { name: 'saved Calcutta overnight window', timezone: 'Asia/Calcutta', date: '2026-10-02',
    startTime: '20:00', endTime: '02:00', operatingWindowStartTime: '20:00', start: '2026-10-02T14:30:00Z', end: '2026-10-02T20:30:00Z' },
  { name: 'legacy Calcutta overnight window', timezone: 'Asia/Calcutta', date: '2026-10-02',
    startTime: '20:00', endTime: '02:00', operatingWindowStartTime: null, start: '2026-10-02T14:30:00Z', end: '2026-10-02T20:30:00Z' },
  { name: 'Vancouver after-midnight tail', timezone: 'America/Vancouver', date: '2026-10-02',
    startTime: '00:00', endTime: '02:00', operatingWindowStartTime: '20:00', start: '2026-10-03T07:00:00Z', end: '2026-10-03T09:00:00Z' },
  { name: 'Toronto spring DST overnight', timezone: 'America/Toronto', date: '2026-03-07',
    startTime: '20:00', endTime: '04:00', operatingWindowStartTime: '20:00', start: '2026-03-08T01:00:00Z', end: '2026-03-08T08:00:00Z' },
  { name: 'Toronto autumn DST overnight', timezone: 'America/Toronto', date: '2026-10-31',
    startTime: '20:00', endTime: '04:00', operatingWindowStartTime: '20:00', start: '2026-11-01T00:00:00Z', end: '2026-11-01T09:00:00Z' },
];
function prepare(overrides = {}) { state.rows.push([{ ...booking, ...overrides }]); }
function noWrites() {
  expect(state.attempts).toEqual([]); expect(state.updates).toEqual([]); expect(state.locks).toEqual([]);
  expect(state.capture).not.toHaveBeenCalled(); expect(state.queue).not.toHaveBeenCalled(); expect(state.deliver).not.toHaveBeenCalled();
}
function recorded(action: 'arrival' | 'departure', now: Date, wall: string) {
  const arrival = action === 'arrival';
  expect(state.updates).toHaveLength(1);
  expect(state.updates[0]).toMatchObject(arrival
    ? { checkinStatus: 'checked_in', checkedInAt: now, actualStartTime: wall, updatedAt: now }
    : { checkinStatus: 'checkout_requested', checkoutRequestedAt: now, actualEndTime: wall, updatedAt: now });
  expect(state.updates[0][arrival ? 'checkedInAt' : 'checkoutRequestedAt'].toISOString()).toBe(now.toISOString());
  expect(state.updates[0]).not.toHaveProperty('status');
  expect(state.updates[0]).not.toHaveProperty('checkoutApprovedAt');
  if (!arrival) expect(state.updates[0]).not.toHaveProperty('checkedInAt');
  expect(state.selects[0].timezone).toBe(locations.timezone);
  expect(state.joins.slice(-2)).toEqual([kitchens, locations]);
  expect(state.locks).toHaveLength(1);
  const lock = new PgDialect().sqlToQuery(state.locks[0]);
  expect(lock.sql).toMatch(/FOR UPDATE/); expect(lock.params).toEqual([10]);
  expect(new PgDialect().sqlToQuery(state.conditions[0]).params).toEqual(expect.arrayContaining([10, booking.updatedAt.toISOString(), 'confirmed']));
  expect(state.capture).toHaveBeenCalledWith(expect.anything(), 10, state.duties);
  expect(state.queue).toHaveBeenCalledWith(expect.anything(), 10, arrival ? 'checkin_recorded' : 'checkout_requested',
    expect.any(String), expect.any(String), 3, { recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
  expect(state.deliver).toHaveBeenCalledWith(2, 20_000, 10);
}

describe('single/contiguous kitchen timezone (mocked DB and delivery, real time and duty validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    state.rows = []; state.updates = []; state.attempts = []; state.conditions = [];
    state.selects = []; state.joins = []; state.locks = []; state.won = true;
    state.duties = { version: 1, source: 'confirmation', capturedAt: '2026-10-01T00:00:00Z',
      checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60,
      arrival: { enabled: true, instructions: null, items: [], photos: [] },
      departure: { enabled: true, instructions: null, items: [], photos: [] } };
  });
  afterEach(() => vi.useRealTimers());

  it.each(['not_checked_in', null])('accepts a late Calcutta arrival with status %s using its own wall clock', async checkinStatus => {
    const now = new Date('2026-10-02T10:00:00Z'); prepare({ checkinStatus });
    expect((await requestKitchenCheckin(10, 3, 'self')).success).toBe(true);
    recorded('arrival', now, '15:30');
    expect(new PgDialect().sqlToQuery(state.conditions[0]).params).toContain('not_checked_in');
  });
  describe.each(zones)('$timezone arrival eligibility', ({ timezone, start, end }) => {
    it.each(['before opening', 'at opening', 'at end', 'after end'])('%s', async boundary => {
      const instant = boundary.includes('opening') ? Date.parse(start) - 15 * 60_000 : Date.parse(end);
      const now = new Date(instant + (boundary === 'before opening' ? -1 : boundary === 'after end' ? 1 : 0));
      vi.setSystemTime(now); prepare({ timezone });
      const result = await requestKitchenCheckin(10, 3);
      if (boundary === 'before opening' || boundary === 'after end') {
        expect(result.error).toMatch(boundary === 'before opening' ? /Check-in opens/ : /window has closed/); noWrites();
      } else { expect(result.success).toBe(true); recorded('arrival', now, boundary === 'at opening' ? '08:45' : '17:00'); }
    });
  });
  it.each(zones)('$timezone departure-only rejects 1 ms before start and accepts exact start', async ({ timezone, start }) => {
    state.duties.arrival.enabled = false;
    vi.setSystemTime(new Date(Date.parse(start) - 1)); prepare({ timezone });
    expect((await requestKitchenCheckout(10, 3)).error).toMatch(/after this visit starts/); noWrites();
    const now = new Date(start); vi.setSystemTime(now); prepare({ timezone });
    expect((await requestKitchenCheckout(10, 3)).success).toBe(true); recorded('departure', now, '09:00');
    expect(new PgDialect().sqlToQuery(state.conditions[0]).params).toContain('not_checked_in');
  });
  it.each(zones)('$timezone checked-in checkout keeps the existing ability to request after scheduled end', async ({ timezone, end }) => {
    const now = new Date(Date.parse(end) + 25 * 60_000); vi.setSystemTime(now); prepare({ timezone, checkinStatus: 'checked_in' });
    expect((await requestKitchenCheckout(10, 3)).success).toBe(true); recorded('departure', now, '17:25');
    expect(new PgDialect().sqlToQuery(state.conditions[0]).params).toContain('checked_in');
  });

  describe.each(overnight)('$name', fixture => {
    it.each(['previous day', 'at opening', 'at end', 'after end'])('arrival %s', async boundary => {
      const { name, date, start, end, ...times } = fixture;
      const now = new Date(boundary === 'previous day' ? Date.parse(start) - 86_400_000
        : boundary === 'at opening' ? Date.parse(start) - 15 * 60_000 : Date.parse(end) + Number(boundary === 'after end'));
      vi.setSystemTime(now); prepare({ ...times, bookingDate: new Date(`${date}T00:00:00Z`) });
      const result = await requestKitchenCheckin(10, 3);
      if (boundary === 'previous day' || boundary === 'after end') {
        expect(result.error).toMatch(boundary === 'previous day' ? /Check-in opens/ : /window has closed/); noWrites();
      } else { expect(result.success).toBe(true); recorded('arrival', now, boundary === 'at end' ? times.endTime : times.startTime === '00:00' ? '23:45' : '19:45'); }
    });
    it('departure-only uses the saved start calendar day and UTC instant', async () => {
      const { name, date, start, end, ...times } = fixture; state.duties.arrival.enabled = false;
      const overrides = { ...times, bookingDate: new Date(`${date}T00:00:00Z`), checkinStatus: null };
      vi.setSystemTime(new Date(Date.parse(start) - 1)); prepare(overrides);
      expect((await requestKitchenCheckout(10, 3)).error).toMatch(/after this visit starts/); noWrites();
      const now = new Date(start); vi.setSystemTime(now); prepare(overrides);
      expect((await requestKitchenCheckout(10, 3)).success).toBe(true); recorded('departure', now, times.startTime);
    });
  });

  describe.each([null, undefined, ''])('legacy timezone fallback %s', timezone => {
    it('arrival uses Newfoundland eligibility and stores the same UTC instant', async () => {
      vi.setSystemTime(new Date('2026-10-02T11:14:59.999Z')); prepare({ timezone });
      expect((await requestKitchenCheckin(10, 3)).error).toMatch(/Check-in opens/); noWrites();
      const now = new Date('2026-10-02T11:15:00Z'); vi.setSystemTime(now); prepare({ timezone });
      expect((await requestKitchenCheckin(10, 3)).success).toBe(true); recorded('arrival', now, '08:45');
    });
    it('departure-only opens at Newfoundland start', async () => {
      state.duties.arrival.enabled = false;
      vi.setSystemTime(new Date('2026-10-02T11:29:59.999Z')); prepare({ timezone });
      expect((await requestKitchenCheckout(10, 3)).error).toMatch(/after this visit starts/); noWrites();
      const now = new Date('2026-10-02T11:30:00Z'); vi.setSystemTime(now); prepare({ timezone });
      expect((await requestKitchenCheckout(10, 3)).success).toBe(true); recorded('departure', now, '09:00');
    });
    it('checked-in checkout stores Newfoundland wall time', async () => {
      const now = new Date('2026-10-02T20:00:00Z'); vi.setSystemTime(now); prepare({ timezone, checkinStatus: 'checked_in' });
      expect((await requestKitchenCheckout(10, 3)).success).toBe(true); recorded('departure', now, '17:30');
    });
  });

  it('allows arrival despite a disabled legacy snapshot with zero tasks', async () => {
    state.duties.arrival.enabled = false; prepare();
    expect((await requestKitchenCheckin(10, 3)).success).toBe(true);
  });
  it('uses the existing saved early-arrival window rather than a new default', async () => {
    state.duties.checkinWindowMinutesBefore = 30;
    vi.setSystemTime(new Date('2026-10-02T02:59:59.999Z')); prepare();
    expect((await requestKitchenCheckin(10, 3)).error).toMatch(/30 minutes before/); noWrites();
    const now = new Date('2026-10-02T03:00:00Z'); vi.setSystemTime(now); prepare();
    expect((await requestKitchenCheckin(10, 3)).success).toBe(true); recorded('arrival', now, '08:30');
  });
  it.each(['arrival', 'departure'] as const)('%s rejects foreign chefs, cancelled bookings and incomplete required duties', async action => {
    const request = () => action === 'arrival' ? requestKitchenCheckin(10, 3) : requestKitchenCheckout(10, 3);
    const checkinStatus = action === 'arrival' ? 'not_checked_in' : 'checked_in';
    prepare({ chefId: 999, checkinStatus }); expect((await request()).error).toMatch(/permission/); noWrites();
    prepare({ status: 'cancelled', checkinStatus }); expect((await request()).success).toBe(false); noWrites();
    state.duties[action].items = [{ id: 'clean', label: 'Clean', required: true }];
    prepare({ checkinStatus }); expect((await request()).error).toMatch(/required checklist/); noWrites();
    state.duties[action].items = []; state.duties[action].photos = [{ id: 'counter', label: 'Counter', required: true }];
    prepare({ checkinStatus }); expect((await request()).error).toMatch(/required item/); noWrites();
  });
  it.each(['arrival', 'departure'] as const)('%s records submitted evidence and keeps the duties capture/notice transaction', async action => {
    const now = new Date('2026-10-02T10:00:00Z');
    state.duties[action].items = [{ id: 'clean', label: 'Clean', required: true }];
    state.duties[action].photos = [{ id: 'counter', label: 'Counter', required: true }];
    const items = [{ id: 'clean', label: 'Clean', checked: true }];
    prepare({ checkinStatus: action === 'arrival' ? 'not_checked_in' : 'checked_in' });
    const result = action === 'arrival' ? await requestKitchenCheckin(10, 3, 'self', 'Chef note', ['photo'], items)
      : await requestKitchenCheckout(10, 3, 'Chef note', ['photo'], items);
    expect(result.success).toBe(true); recorded(action, now, '15:30');
    expect(state.updates[0]).toMatchObject(action === 'arrival'
      ? { checkinNotes: 'Chef note', checkinPhotoUrls: ['photo'], checkinChecklistItems: items, checkedInMethod: 'self' }
      : { checkoutNotes: 'Chef note', checkoutPhotoUrls: ['photo'], checkoutChecklistItems: items });
  });
  it.each(['arrival', 'departure'] as const)('%s loses CAS without committed writes, duties capture or notices', async action => {
    state.won = false; prepare({ checkinStatus: action === 'arrival' ? 'not_checked_in' : 'checked_in' });
    const result = action === 'arrival' ? await requestKitchenCheckin(10, 3) : await requestKitchenCheckout(10, 3);
    expect(result.error).toMatch(/Booking changed/); expect(state.attempts).toHaveLength(1); expect(state.updates).toEqual([]);
    const guard = new PgDialect().sqlToQuery(state.conditions[0]);
    expect(guard.params).toEqual(expect.arrayContaining([10, booking.updatedAt.toISOString(), 'confirmed', action === 'arrival' ? 'not_checked_in' : 'checked_in']));
    expect(state.capture).not.toHaveBeenCalled(); expect(state.queue).not.toHaveBeenCalled(); expect(state.deliver).not.toHaveBeenCalled();
  });
  it('does not erase an existing no-show through chef arrival', async () => {
    prepare({ checkinStatus: 'no_show' }); expect((await requestKitchenCheckin(10, 3)).success).toBe(false); noWrites();
  });
});
