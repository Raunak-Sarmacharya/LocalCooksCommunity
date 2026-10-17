/**
 * CP3 inventory on a real in-process Postgres (PGlite): weekly hours read real rows; grouped holds commit all-or-nothing
 * under real advisory locks. The single-day engine is stubbed (it has its own suites); this file proves what sits on it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { equipmentListings, kitchenBookings, kitchenCheckoutHolds, kitchenCheckoutIncidents } from '@shared/schema';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const engine = vi.hoisted(() => ({ calls: 0 }));
const h = vi.hoisted(() => ({ db: null as any, canBook: true, closed: new Set<string>(), taken: new Set<string>(),
  policy: {} as Record<string, any> }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => { const value = h.db[key]; return typeof value === 'function' ? value.bind(h.db) : value; } }), pool: {} }));
vi.mock('./booking-policy-settings', () => ({ kitchenBookingPolicies: async () => h.policy }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: h.canBook, message: 'Not open to you yet.' }) } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 9, minimumBookingHours: 2 }) } }));
const hours = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({
  startTime: `${String((from + i) % 24).padStart(2, '0')}:00`, endTime: `${String((from + i + 1) % 24).padStart(2, '0')}:00` }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {
  operatingWindow: async (_k: number, date: Date) => h.closed.has(date.toISOString().slice(0, 10)) ? { error: 'Kitchen is closed on this date' } : { startTime: '08:00', endTime: '16:00' },
  // The real single-day engine is covered elsewhere; here a date is either closed, taken or free.
  validateBookingAvailability: async (_k: number, date: Date, _s: string, _e: string, options: any) => {
    engine.calls++;
    const day = date.toISOString().slice(0, 10);
    if (h.closed.has(day)) return { valid: false, code: 'closed', error: 'Kitchen is closed on this date' };
    if (h.taken.has(day)) return { valid: false, code: 'booked', error: 'One or more selected time slots are no longer available' };
    return { valid: true, slots: options.fullDay ? hours(8, 16) : options.selectedSlots, windowStartTime: '08:00', windowEndTime: '16:00' };
  } } }));

import { validateBookingDays } from './booking-days-validation';
import { assertKitchenCheckoutGroup, bindKitchenCheckout, KitchenHoldMissingError, KitchenSlotUnavailableError, releaseKitchenCheckout,
  renewKitchenCheckoutGroup, reserveKitchenCheckoutGroup } from './kitchen-checkout-holds';
import { WeeklyChefHoursLimitError } from './kitchen-booking-quota';
import { kitchenRuleOverride } from './booking-rule-overrides';

beforeAll(async () => {
  ({ db: h.db } = await createTestDatabase([kitchenBookings, kitchenCheckoutHolds, kitchenCheckoutIncidents, equipmentListings], [
    'CREATE UNIQUE INDEX kitchen_holds_group_day_unique ON kitchen_checkout_holds (group_id, operating_date) WHERE group_id IS NOT NULL',
    'CREATE UNIQUE INDEX kitchen_checkout_incidents_session ON kitchen_checkout_incidents (session_id)',
  ]));
});
afterAll(async () => { await h.db?.$client?.close?.(); });

beforeEach(async () => {
  await h.db.delete(kitchenBookings); await h.db.delete(kitchenCheckoutHolds); await h.db.delete(kitchenCheckoutIncidents); await h.db.delete(equipmentListings);
  h.canBook = true; h.closed = new Set(); h.taken = new Set();
  h.policy = { timezone: 'America/St_Johns', bookingBufferMinutes: 60, turnoverBufferEnabled: true, maxBookingDays: 7, allowMultiDayBookings: true,
    multidayCreationEnabled: true, defaultDailyBookingLimit: 3, minimumBookingWindowHours: 1, weeklyChefHoursLimit: null };
});

let nextId = 1;
const addBooking = (chefId: number, date: string, from: number, to: number, status = 'confirmed', kitchenId = 4) => h.db.insert(kitchenBookings).values({
  id: nextId++, chefId, kitchenId, bookingDate: new Date(`${date}T12:00:00Z`), startTime: hours(from, to)[0].startTime, endTime: hours(from, to).at(-1)!.endTime,
  operatingWindowStartTime: '08:00', selectedSlots: hours(from, to), status, totalPrice: '0', hourlyRate: '0', durationHours: String(to - from) });
const day = (date: string, from = 10, to = 12, extra: Record<string, unknown> = {}) => ({ date, pricingMode: 'hourly' as const, slots: hours(from, to), ...extra });
// 2099-10-05 is a Monday.
const validate = (days: any[], extra: Record<string, unknown> = {}) => validateBookingDays({ kitchenId: 4, chefId: 3, days, ...extra });

describe('validateBookingDays', () => {
  it('accepts any tapped dates (Mon/Wed/Fri) and returns normalized days', async () => {
    const result = await validate([day('2099-10-09'), day('2099-10-05'), day('2099-10-07')]);
    expect(result).toMatchObject({ ok: true, bufferMinutes: 60, timezone: 'America/St_Johns' });
    expect(result.ok && result.days.map(item => item.date)).toEqual(['2099-10-05', '2099-10-07', '2099-10-09']);
  });

  it('applies the count/span contract and the rollout gate (legacy one-day payloads excepted)', async () => {
    expect(await validate([day('2099-10-05'), day('2099-10-20')])).toMatchObject({ ok: false, code: 'SPAN_TOO_LONG' });
    h.policy.allowMultiDayBookings = false;
    expect(await validate([day('2099-10-05'), day('2099-10-06')])).toMatchObject({ ok: false, code: 'TOO_MANY_DAYS' });
    h.policy.allowMultiDayBookings = true; h.policy.multidayCreationEnabled = false;
    expect(await validate([day('2099-10-05'), day('2099-10-06')])).toMatchObject({ ok: false, code: 'MULTIDAY_DISABLED' });
    expect(await validate([day('2099-10-05')], { legacySingleDay: true })).toMatchObject({ ok: true });
  });

  it('returns a reason for every failing date, not only the first', async () => {
    h.closed.add('2099-10-06'); h.taken.add('2099-10-08');
    const result = await validate([day('2099-10-05'), day('2099-10-06'), day('2099-10-08')]);
    expect(result).toMatchObject({ ok: false, kind: 'availability', dayErrors: [
      { date: '2099-10-06', reason: 'closed' }, { date: '2099-10-08', reason: 'booked' }] });
  });

  it('caps hourly length per day; a full day keeps the daily-rate bypass; minimum hours apply to hourly days', async () => {
    expect(await validate([day('2099-10-05', 9, 13)])).toMatchObject({ ok: false, dayErrors: [{ reason: 'length', message: 'Select no more than 3 hourly slots' }] });
    expect(await validate([day('2099-10-05', 9, 10)])).toMatchObject({ ok: false, dayErrors: [{ reason: 'length' }] });
    expect(await validate([{ date: '2099-10-05', pricingMode: 'daily' }])).toMatchObject({ ok: true, days: [{ slots: hours(8, 16) }] });
  });

  it('checks notice in the location time zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2099-10-05T12:00:00Z')); // 09:30 in St. John's
      expect(await validate([day('2099-10-05', 10, 12)])).toMatchObject({ ok: false, dayErrors: [{ reason: 'notice', message: 'Bookings must be made at least 1 hour in advance' }] });
      h.policy.timezone = 'America/Vancouver'; // 05:00 there: the same hours are far enough away
      expect(await validate([day('2099-10-05', 10, 12)])).toMatchObject({ ok: true });
    } finally { vi.useRealTimers(); }
  });

  it('refuses a chef the location is not open to, and equipment that is not this kitchen\'s', async () => {
    await h.db.insert(equipmentListings).values([{ id: 1, kitchenId: 4, category: 'cooking', equipmentType: 'Mixer', condition: 'good', isActive: true },
      { id: 2, kitchenId: 5, category: 'cooking', equipmentType: 'Oven', condition: 'good', isActive: true }]);
    expect(await validate([day('2099-10-05', 10, 12, { equipmentIds: [1] })])).toMatchObject({ ok: true, days: [{ equipmentIds: [1] }] });
    expect(await validate([day('2099-10-05', 10, 12, { equipmentIds: [2] })])).toMatchObject({ ok: false, dayErrors: [{ reason: 'equipment_unavailable' }] });
    h.canBook = false;
    expect(await validate([day('2099-10-05')])).toMatchObject({ ok: false, kind: 'eligibility', dayErrors: [{ reason: 'not_open_to_you' }] });
  });
});

describe('weekly hours per chef at this kitchen', () => {
  beforeEach(() => { h.policy.weeklyChefHoursLimit = 8; });

  it('counts used, in-progress and upcoming hours; 6 used + 3 rejects, +2 accepts', async () => {
    await addBooking(3, '2099-10-05', 8, 11, 'completed'); // used Monday
    await addBooking(3, '2099-10-06', 8, 11, 'confirmed');
    expect(await validate([day('2099-10-08', 10, 13)])).toMatchObject({ ok: false, code: 'WEEKLY_CHEF_HOURS_LIMIT', kind: 'weekly',
      weeks: [{ weekStart: '2099-10-05', weekEnd: '2099-10-11', countedMinutes: 360, requestedMinutes: 180, remainingMinutes: 120 }],
      dayErrors: [{ date: '2099-10-08', reason: 'weekly_limit' }], error: expect.stringContaining('6 of 8 hours') });
    expect(await validate([day('2099-10-08', 10, 12)])).toMatchObject({ ok: true });
  });

  it('cancelled hours do not count; another chef, another kitchen and the next week are independent', async () => {
    await addBooking(3, '2099-10-05', 8, 16, 'cancelled');
    await addBooking(9, '2099-10-05', 8, 16);
    await addBooking(3, '2099-10-06', 8, 16, 'confirmed', 5);
    await addBooking(3, '2099-10-07', 8, 14);
    expect(await validate([day('2099-10-08', 10, 12)])).toMatchObject({ ok: true });
    expect(await validate([day('2099-10-08', 10, 13)])).toMatchObject({ ok: false, code: 'WEEKLY_CHEF_HOURS_LIMIT' });
    expect(await validate([day('2099-10-12', 10, 12)])).toMatchObject({ ok: true }); // next Monday
  });

  it('counts active holds (checkout, change, added time) and excludes the chef\'s own replaced booking', async () => {
    await h.db.insert(kitchenCheckoutHolds).values({ id: 'other-checkout', kitchenId: 4, chefId: 3, operatingDate: '2099-10-06', windowStartTime: '08:00',
      selectedSlots: hours(8, 15), expiresAt: new Date(Date.now() + 60_000) });
    await h.db.insert(kitchenCheckoutHolds).values({ id: 'expired', kitchenId: 4, chefId: 3, operatingDate: '2099-10-07', windowStartTime: '08:00',
      selectedSlots: hours(8, 15), expiresAt: new Date(Date.now() - 60_000) });
    expect(await validate([day('2099-10-08', 10, 12)])).toMatchObject({ ok: false, code: 'WEEKLY_CHEF_HOURS_LIMIT' });
    expect(await validate([day('2099-10-08', 10, 12)], { excludeHoldId: 'other-checkout' })).toMatchObject({ ok: true });
    await h.db.delete(kitchenCheckoutHolds);
    await addBooking(3, '2099-10-06', 8, 15); // id is the next id
    const [own] = await h.db.select().from(kitchenBookings);
    expect(await validate([day('2099-10-08', 10, 12)], { excludeBookingId: own.id })).toMatchObject({ ok: true });
  });

  it('only a trusted kitchen grant waives the limit; a chef-supplied flag does not', async () => {
    await addBooking(3, '2099-10-05', 8, 16);
    expect(await validate([day('2099-10-08', 10, 12)], { override: { ignoreWeeklyLimit: true } })).toMatchObject({ ok: false, code: 'WEEKLY_CHEF_HOURS_LIMIT' });
    const grant = kitchenRuleOverride({ actorId: 8, actorRole: 'manager', scope: 'test', ignoreWeeklyLimit: true, reason: 'Big catering order' });
    expect(await validate([day('2099-10-08', 10, 12)], { override: grant })).toMatchObject({ ok: true });
  });
});

describe('grouped checkout holds', () => {
  const groupDay = (operatingDate: string, from = 10, to = 12) => ({ operatingDate, windowStartTime: '08:00', slots: hours(from, to) });
  const reserve = (days: any[], extra: Record<string, unknown> = {}) =>
    reserveKitchenCheckoutGroup({ kitchenId: 4, chefId: 3, days, quoteSnapshot: { version: 1, days: days.map(d => d.operatingDate) }, ...extra });
  const rows = () => h.db.select().from(kitchenCheckoutHolds);

  it('reserves every day in one transaction: one group, the quote on the head only, the saved buffer on every row', async () => {
    const groupId = await reserve([groupDay('2099-10-09'), groupDay('2099-10-05'), groupDay('2099-10-07')]);
    const saved = await rows();
    expect(saved).toHaveLength(3);
    expect(saved.every((row: any) => row.groupId === groupId && row.bufferMinutesSnapshot === 60)).toBe(true);
    expect(saved.find((row: any) => row.id === groupId)).toMatchObject({ operatingDate: '2099-10-05', quoteSnapshot: { version: 1 } });
    expect(saved.filter((row: any) => row.quoteSnapshot === null)).toHaveLength(2);
  });

  it('two chefs racing for one shared day: exactly one group wins and the loser leaves no rows', async () => {
    engine.calls = 0;
    const results = await Promise.allSettled([
      reserve([groupDay('2099-10-05'), groupDay('2099-10-07')]),
      reserveKitchenCheckoutGroup({ kitchenId: 4, chefId: 9, days: [groupDay('2099-10-07', 11, 13), groupDay('2099-10-09')], quoteSnapshot: { version: 1 } }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(KitchenSlotUnavailableError);
    expect(engine.calls).toBe(4); // both groups passed the stubbed engine: the loser lost to the in-transaction scan
    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((row: any) => row.groupId)).size).toBe(1);
  });

  it('rejects the whole group when any day conflicts (buffer included) and writes nothing', async () => {
    await addBooking(9, '2099-10-07', 8, 9); // 09:00 end + 1 h buffer blocks a 09:00 start
    await expect(reserve([groupDay('2099-10-05'), groupDay('2099-10-07', 9, 11)])).rejects.toBeInstanceOf(KitchenSlotUnavailableError);
    expect(await rows()).toHaveLength(0);
    await expect(reserve([groupDay('2099-10-05'), groupDay('2099-10-07', 10, 12)])).resolves.toEqual(expect.any(String));
  });

  it('a kitchen-waived buffer reserves next to a neighbour, but never on top of it', async () => {
    await addBooking(9, '2099-10-07', 8, 9);
    const grant = kitchenRuleOverride({ actorId: 8, actorRole: 'manager', scope: 'test', ignoreBuffer: true, reason: 'Kitchen prep day' })!;
    await expect(reserve([groupDay('2099-10-07', 9, 11)], { override: grant })).resolves.toEqual(expect.any(String));
    expect((await rows())[0].bufferMinutesSnapshot).toBe(0);
    await h.db.delete(kitchenCheckoutHolds);
    await expect(reserve([groupDay('2099-10-07', 8, 10)], { override: grant })).rejects.toBeInstanceOf(KitchenSlotUnavailableError);
  });

  it('enforces weekly hours for the whole group inside the lock', async () => {
    h.policy.weeklyChefHoursLimit = 4;
    await expect(reserve([groupDay('2099-10-05'), groupDay('2099-10-07'), groupDay('2099-10-09')])).rejects.toBeInstanceOf(WeeklyChefHoursLimitError);
    expect(await rows()).toHaveLength(0);
    // Same hours split across two weeks fit.
    await expect(reserve([groupDay('2099-10-09'), groupDay('2099-10-12')])).resolves.toEqual(expect.any(String));
  });

  it('rejects an overnight day that runs into the next selected day, and equipment from another kitchen', async () => {
    await expect(reserve([{ operatingDate: '2099-10-05', windowStartTime: '22:00', slots: hours(22, 33) }, groupDay('2099-10-06', 8, 10)]))
      .rejects.toBeInstanceOf(KitchenSlotUnavailableError);
    await h.db.insert(equipmentListings).values({ id: 7, kitchenId: 5, category: 'cooking', equipmentType: 'Oven', condition: 'good', isActive: true });
    await expect(reserve([{ ...groupDay('2099-10-05'), equipmentListingIds: [7] }])).rejects.toBeInstanceOf(KitchenSlotUnavailableError);
    expect(await rows()).toHaveLength(0);
  });

  it('binds on the head (copying the quote to the incident), validates, renews and releases the whole group', async () => {
    const days = [groupDay('2099-10-05'), groupDay('2099-10-07')];
    const groupId = await reserve(days);
    const other = (await rows()).find((row: any) => row.id !== groupId)!;
    await expect(bindKitchenCheckout(other.id, 'cs_1')).rejects.toThrow('first day');
    await bindKitchenCheckout(groupId, 'cs_1');
    const [incident] = await h.db.select().from(kitchenCheckoutIncidents).where(eq(kitchenCheckoutIncidents.sessionId, 'cs_1'));
    expect(incident.quoteSnapshot).toMatchObject({ version: 1 });
    await expect(assertKitchenCheckoutGroup(groupId, 'cs_1', 4, days)).resolves.toMatchObject({ head: { id: groupId } });
    await expect(assertKitchenCheckoutGroup(groupId, 'cs_1', 4, [days[0]])).rejects.toBeInstanceOf(KitchenHoldMissingError);
    await expect(assertKitchenCheckoutGroup(groupId, 'cs_other', 4, days)).rejects.toBeInstanceOf(KitchenHoldMissingError);
    const until = new Date(Date.now() + 3_600_000);
    await renewKitchenCheckoutGroup(groupId, until);
    expect((await rows()).every((row: any) => row.expiresAt.getTime() === until.getTime())).toBe(true);
    await releaseKitchenCheckout(other.id); // from any row: never a partial group
    expect(await rows()).toHaveLength(0);
  }, 30_000);

  it('expired cleanup keeps an unbound head\'s quote for recovery but frees its time', async () => {
    const past = new Date(Date.now() - 60_000);
    await h.db.insert(kitchenCheckoutHolds).values([
      { id: 'head', groupId: 'head', kitchenId: 4, chefId: 3, operatingDate: '2099-10-05', windowStartTime: '08:00', selectedSlots: hours(10, 12), quoteSnapshot: { v: 1 }, expiresAt: past },
      { id: 'tail', groupId: 'head', kitchenId: 4, chefId: 3, operatingDate: '2099-10-06', windowStartTime: '08:00', selectedSlots: hours(13, 14), expiresAt: past },
      { id: 'bound', groupId: 'bound', kitchenId: 4, chefId: 3, operatingDate: '2099-10-05', windowStartTime: '08:00', selectedSlots: hours(14, 15), quoteSnapshot: { v: 1 }, stripeSessionId: 'cs_b', expiresAt: past },
      { id: 'legacy', kitchenId: 4, chefId: 3, operatingDate: '2099-10-05', windowStartTime: '08:00', selectedSlots: hours(15, 16), expiresAt: past },
    ]);
    await reserve([groupDay('2099-10-05', 10, 12), groupDay('2099-10-06', 13, 14)]); // the expired head's own hours are free again
    expect((await rows()).map((row: any) => row.id).filter((id: string) => ['head', 'tail', 'bound', 'legacy'].includes(id))).toEqual(['head']);
  });
});
