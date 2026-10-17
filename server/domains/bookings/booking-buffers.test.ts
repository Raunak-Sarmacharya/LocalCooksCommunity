import { afterEach, describe, expect, it, vi } from 'vitest';
const capacity = vi.hoisted(() => ({ holds: vi.fn(async () => [] as any[]), canBook: true, counted: new Map<string, number>() }));
vi.mock('../../db', () => ({ db: { select: () => { const query: any = { from: () => query, innerJoin: () => query, where: () => query, limit: async () => [], then: (resolve: any) => resolve([]) }; return query; } } }));
vi.mock('../kitchens/kitchen.service', () => ({ kitchenService: {
  getKitchenDateOverrideForDate: async () => null, getKitchenById: async () => ({ id: 4, locationId: 9 }),
  getMonthAvailability: async () => Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2099-10-${String(i + 1).padStart(2, '0')}`, true])),
  getKitchenAvailability: async () => Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isAvailable: dayOfWeek !== 0, startTime: '08:00', endTime: '18:00' })),
  getKitchenDateOverrides: async () => [] } }));
vi.mock('../users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: capacity.canBook }) } }));
vi.mock('../../services/kitchen-checkout-holds', () => ({ getActiveKitchenHolds: capacity.holds }));
vi.mock('../../services/kitchen-booking-quota', async importOriginal => ({ ...(await importOriginal<any>()),
  chefWeeklyMinutes: async () => capacity.counted }));
vi.mock('../../services/booking-policy-settings', () => ({ kitchenBookingPolicies: async () => policy }));
const policy: Record<string, any> = { maxAdvanceBookingDays: 100000, bookingBufferMinutes: 0, turnoverBufferEnabled: false, timezone: 'America/St_Johns',
  minimumBookingWindowHours: 1, weeklyChefHoursLimit: null };
import { bookingService } from './booking.service';
import { kitchenRuleOverride } from '../../services/booking-rule-overrides';

const date = new Date('2099-10-06T12:00:00Z'); // a Tuesday
const booking = (startTime: string, endTime: string, bufferMinutesSnapshot: number | null, extra: Record<string, unknown> = {}) => ({
  id: 1, chefId: 3, bookingDate: new Date('2099-10-06T12:00:00Z'), status: 'confirmed', startTime, endTime,
  operatingWindowStartTime: '08:00', selectedSlots: [{ startTime, endTime }], bufferMinutesSnapshot, ...extra });
const withBookings = (rows: unknown[]) => vi.spyOn(bookingService, 'getBookingsByKitchen').mockResolvedValue(rows as any);
const check = (startTime: string, endTime: string, options = {}) =>
  bookingService.validateBookingAvailability(4, date, startTime, endTime, options);

afterEach(() => { vi.restoreAllMocks(); policy.bookingBufferMinutes = 0; policy.turnoverBufferEnabled = false; policy.weeklyChefHoursLimit = null;
  capacity.canBook = true; capacity.counted = new Map(); capacity.holds.mockReset(); capacity.holds.mockResolvedValue([]); });

describe('buffer matrix (12:00 end)', () => {
  it.each([
    [0, '12:00', true], [60, '12:00', false], [60, '13:00', true], [120, '13:00', false], [120, '14:00', true],
  ])('kitchen buffer %s: a start at %s is allowed=%s', async (buffer, start, allowed) => {
    policy.bookingBufferMinutes = buffer;
    withBookings([booking('10:00', '12:00', buffer)]);
    const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`;
    expect(await check(start, end)).toMatchObject(allowed ? { valid: true } : { valid: false, code: 'buffer' });
  });

  it('an existing booking keeps its saved buffer after the kitchen turns it off', async () => {
    withBookings([booking('10:00', '12:00', 60)]);
    expect(await check('12:00', '13:00')).toMatchObject({ valid: false, code: 'buffer', error: expect.stringContaining('no longer available') });
    expect(await check('13:00', '14:00')).toMatchObject({ valid: true });
  });

  it('a new request uses the current buffer next to an older Off booking', async () => {
    policy.bookingBufferMinutes = 120;
    withBookings([booking('10:00', '12:00', 0)]);
    expect(await check('13:00', '14:00')).toMatchObject({ valid: false, code: 'buffer' });
    expect(await check('14:00', '15:00')).toMatchObject({ valid: true });
  });

  it('pads by the larger buffer, never the sum (60 saved + 120 new needs 2 h, not 3 h)', async () => {
    policy.bookingBufferMinutes = 120;
    withBookings([booking('10:00', '12:00', 60)]);
    expect(await check('14:00', '15:00')).toMatchObject({ valid: true });
  });

  it('a moved booking keeps its own saved buffer and never blocks itself', async () => {
    policy.bookingBufferMinutes = 120;
    withBookings([booking('10:00', '12:00', 0), booking('16:00', '17:00', 0, { id: 2 })]);
    expect(await check('12:00', '13:00', { excludeBookingId: 1, bufferMinutes: 0 })).toMatchObject({ valid: true });
    // Another booking by the same chef is still a different booking: it keeps the gap.
    expect(await check('15:00', '16:00', { excludeBookingId: 1, bufferMinutes: 60 })).toMatchObject({ valid: false, code: 'buffer' });
  });

  it('legacy rows without a snapshot follow the kitchen\'s current setting (today\'s behavior)', async () => {
    withBookings([booking('10:00', '12:00', null)]);
    expect(await check('12:00', '13:00')).toMatchObject({ valid: true });
    policy.bookingBufferMinutes = 60;
    expect(await check('12:00', '13:00')).toMatchObject({ valid: false });
  });

  it('pads holds by their saved buffer and keeps the "reserved" message', async () => {
    withBookings([]);
    capacity.holds.mockResolvedValue([{ id: 'h', operatingDate: '2099-10-06', windowStartTime: '08:00', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }], bufferMinutesSnapshot: 60 }]);
    expect(await check('11:00', '12:00')).toMatchObject({ valid: false, code: 'buffer', error: expect.stringContaining('reserved') });
    expect(await check('11:00', '12:00', { excludeHoldId: 'h' })).toMatchObject({ valid: true });
  });

  it('a grouped hold is excluded by its group id from any of its rows', async () => {
    withBookings([]);
    capacity.holds.mockResolvedValue([{ id: 'row-2', groupId: 'head', operatingDate: '2099-10-06', windowStartTime: '08:00', selectedSlots: [{ startTime: '10:00', endTime: '11:00' }] }]);
    expect(await check('10:00', '11:00')).toMatchObject({ valid: false, code: 'held' });
    expect(await check('10:00', '11:00', { excludeHoldId: 'head' })).toMatchObject({ valid: true });
  });
});

describe('kitchen override: spacing only, never from a chef', () => {
  it('a trusted kitchen override waives spacing but not actual overlap', async () => {
    withBookings([booking('10:00', '12:00', 120)]);
    const override = kitchenRuleOverride({ actorId: 8, actorRole: 'manager', scope: 'test', ignoreBuffer: true, reason: 'Our own cleaning crew' })!;
    expect(await check('12:00', '13:00', { override })).toMatchObject({ valid: true });
    expect(await check('11:00', '12:00', { override })).toMatchObject({ valid: false, code: 'booked' });
  });
  it('a forged plain object (request JSON) is ignored', async () => {
    withBookings([booking('10:00', '12:00', 120)]);
    const forged = JSON.parse(JSON.stringify(kitchenRuleOverride({ actorId: 8, actorRole: 'manager', scope: 'test', ignoreBuffer: true, reason: 'x' })));
    expect(await check('12:00', '13:00', { override: forged })).toMatchObject({ valid: false, code: 'buffer' });
    expect(() => kitchenRuleOverride({ actorId: 3, actorRole: 'chef', scope: 'test', ignoreBuffer: true, reason: 'please' })).toThrow('Only the kitchen');
    expect(() => kitchenRuleOverride({ actorId: 8, actorRole: 'manager', scope: 'test', ignoreBuffer: true })).toThrow('reason');
  });
});

describe('later dated days block like any other day', () => {
  const dated = booking('10:00', '11:00', 0, { bookingDate: new Date('2099-10-01T12:00:00Z'), scheduleRevision: 1, selectedSlots: [
    { date: '2099-10-01', windowStartTime: '08:00', startTime: '10:00', endTime: '11:00' },
    { date: '2099-10-06', windowStartTime: '08:00', startTime: '15:00', endTime: '16:00' }] });
  it('hourly slots, the full-day guard, the slot list and the month map all see the later day', async () => {
    withBookings([dated]);
    expect(await check('15:00', '16:00')).toMatchObject({ valid: false, code: 'booked' });
    expect(await check('08:00', '18:00', { fullDay: true })).toMatchObject({ valid: false, code: 'booked' });
    const slots = await bookingService.getAllTimeSlotsWithBookingInfo(4, date);
    expect(slots.find(slot => slot.time === '15:00')).toMatchObject({ isFullyBooked: true, reason: 'booked' });
    expect(slots.find(slot => slot.time === '10:00')).toMatchObject({ isFullyBooked: false });
    const status = await bookingService.getMonthDateStatus(4, 2099, 9);
    expect(status['2099-10-06']).toMatchObject({ hourly: true, fullDay: false, fullDayReason: 'booked' });
  });
});

describe('per-date status for the picker', () => {
  it('gives reasons and keeps the legacy boolean map unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2099-10-06T13:30:00Z')); // 11:00 in St. John's
    policy.maxAdvanceBookingDays = 20; policy.bookingBufferMinutes = 60; policy.minimumBookingWindowHours = 8;
    try {
      withBookings([booking('08:00', '18:00', 60, { bookingDate: new Date('2099-10-07T12:00:00Z'), selectedSlots: undefined }),
        booking('10:00', '11:00', 60, { id: 2, bookingDate: new Date('2099-10-08T12:00:00Z') })]);
      const status = await bookingService.getMonthDateStatus(4, 2099, 9);
      const legacy = await bookingService.getMonthBookableAvailability(4, 2099, 9);
      expect(status['2099-10-04']).toMatchObject({ hourly: false, reason: 'closed' }); // Sunday
      expect(status['2099-10-06']).toMatchObject({ hourly: false, reason: 'notice' }); // only slots inside the 8 h notice remain
      expect(legacy['2099-10-06']).toBe(true); // the old map never knew about notice
      expect(status['2099-10-07']).toMatchObject({ hourly: false, fullDay: false, reason: 'booked' });
      expect(status['2099-10-08']).toMatchObject({ hourly: true, fullDay: false, fullDayReason: 'booked' });
      expect(status['2099-10-30']).toMatchObject({ hourly: false, reason: 'beyond_advance_window' });
      const slots = await bookingService.getAllTimeSlotsWithBookingInfo(4, new Date('2099-10-08T12:00:00Z'));
      expect(slots.find(slot => slot.time === '11:00')).toMatchObject({ isFullyBooked: true, reason: 'buffer' });
      expect(slots.find(slot => slot.time === '12:00')).toMatchObject({ isFullyBooked: false });
    } finally { policy.maxAdvanceBookingDays = 100000; policy.minimumBookingWindowHours = 1; vi.useRealTimers(); }
  });

  it('adds the chef\'s own access and weekly hours only for that chef', async () => {
    withBookings([]);
    policy.weeklyChefHoursLimit = 8;
    capacity.counted = new Map([['2099-10-05', 8 * 60], ['2099-10-12', 4 * 60]]);
    const chef = await bookingService.getMonthDateStatus(4, 2099, 9, { chefId: 3 });
    expect(chef['2099-10-06']).toMatchObject({ hourly: false, reason: 'weekly_limit' });
    expect(chef['2099-10-13']).toMatchObject({ hourly: true, fullDay: false, fullDayReason: 'weekly_limit' });
    const publicView = await bookingService.getMonthDateStatus(4, 2099, 9);
    expect(publicView['2099-10-06']).toMatchObject({ hourly: true, fullDay: true });
    capacity.canBook = false;
    expect((await bookingService.getMonthDateStatus(4, 2099, 9, { chefId: 3 }))['2099-10-13']).toMatchObject({ reason: 'not_open_to_you' });
  });
});
