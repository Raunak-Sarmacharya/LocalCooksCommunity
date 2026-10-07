import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], transaction: vi.fn() }));
vi.mock('../services/tour-delivery-service', () => ({ queueTourEvent: vi.fn(), attemptTourDelivery: vi.fn(async () => ({ failed: false })), deliverTourEvents: vi.fn() }));
vi.mock('../services/kitchen-checkout-service', () => ({ getCheckinSettings: vi.fn(async () => ({ checkinWindowMinutesBefore: 20 })) }));
vi.mock("../db", () => ({
  db: { select: () => {
    const chain: any = { from: () => chain, innerJoin: () => chain, leftJoin: () => chain, orderBy: () => chain, where: () => chain,
      limit: () => Promise.resolve(mocks.rows.shift() ?? []),
      then: (resolve: (value: unknown) => void) => resolve(mocks.rows.shift() ?? []) };
    return chain;
  }, transaction: mocks.transaction },
}));
vi.mock("../firebase-auth-middleware", () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("./middleware", () => ({ requireChef: vi.fn() }));
vi.mock("../services/notification.service", () => ({ notificationService: {} }));
vi.mock("../services/tour-confirmation-pdf", () => ({ buildTourConfirmationPdf: vi.fn(), tourReference: vi.fn() }));
vi.mock("../email", () => ({}));
vi.mock("../utils/user-display", () => ({ getUserDisplayName: vi.fn() }));
vi.mock("../phone-utils", () => ({ getChefPhone: vi.fn() }));

import router from "./viewings";
const settings = { isActive: true, defaultDurationMinutes: 30, bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15, advanceNoticeHours: 0, maxAdvanceBookingDays: 7 };
function handler(path: string, method: string) {
  return (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
}
function response() { return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }; }

describe('kitchen tour guidance settings', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rows.length = 0; });
  it('persists validated notes through the existing owned-kitchen settings route and allows clearing them', async () => {
    let saved: any = { ...settings, kitchenId: 40 };
    const tx = { execute: vi.fn(), select: () => ({ from: () => ({ where: () => ({ limit: async () => [saved] }) }) }),
      update: () => ({ set: (value: any) => ({ where: () => ({ returning: async () => { saved = { ...saved, ...value }; return [saved]; } }) }) }) };
    mocks.transaction.mockImplementation(async run => run(tx));
    const put = (body: unknown) => {
      mocks.rows.push([{ id: 40 }]);
      const res = response();
      return handler('/settings/:kitchenId', 'put')({ params: { kitchenId: '40' }, neonUser: { id: 2 }, body }, res).then(() => res);
    };
    const result = await put({ arrivalNotes: '  Meet at reception\nAsk for Sam  ', departureNotes: 'Return your badge' });
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ arrivalNotes: 'Meet at reception\nAsk for Sam', departureNotes: 'Return your badge' }));
    mocks.rows.push([{ id: 40 }], [saved], [], []);
    const read = response();
    await handler('/settings/:kitchenId', 'get')({ params: { kitchenId: '40' }, neonUser: { id: 2 } }, read);
    expect(read.json).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ arrivalNotes: 'Meet at reception\nAsk for Sam' }) }));
    expect((await put({ arrivalNotes: '', departureNotes: '' })).json).toHaveBeenCalledWith(expect.objectContaining({ arrivalNotes: '', departureNotes: '' }));
    const writeCount = mocks.transaction.mock.calls.length;
    expect((await put({ arrivalNotes: 123 })).status).toHaveBeenCalledWith(400);
    expect((await put({ departureNotes: 'x'.repeat(2001) })).status).toHaveBeenCalledWith(400);
    expect(mocks.transaction).toHaveBeenCalledTimes(writeCount);
    mocks.rows.push([]);
    const denied = response();
    await handler('/settings/:kitchenId', 'put')({ params: { kitchenId: '40' }, neonUser: { id: 99 }, body: { arrivalNotes: 'Unauthorized' } }, denied);
    expect(denied.status).toHaveBeenCalledWith(404);
    expect(mocks.transaction).toHaveBeenCalledTimes(writeCount);
  });
  it('only exposes arrival notes for confirmed tours, retaining departure guidance after an arrived tour ends', async () => {
    const notes = { arrivalNotes: 'Side entrance', departureNotes: 'Return badge' };
    const base = { id: 10, locationId: 33, targetedKitchenId: 40, scheduledAt: new Date('2099-10-05T12:30:00Z'), durationMinutes: 30, updatedAt: new Date() };
    mocks.rows.push([
      { viewing: { ...base, status: 'pending' }, ...notes },
      { viewing: { ...base, id: 11, status: 'confirmed' }, ...notes },
      { viewing: { ...base, id: 12, status: 'completed', checkedInAt: new Date('2099-10-05T12:30:00Z') }, ...notes },
    ]);
    const res = response();
    await handler('/chef', 'get')({ neonUser: { id: 8 }, query: {} }, res);
    const rows = res.json.mock.calls[0][0];
    expect(rows[0]).toMatchObject({ arrivalNotes: null, departureNotes: null });
    expect(rows[1]).toMatchObject(notes);
    expect(rows[2]).toMatchObject({ arrivalNotes: null, departureNotes: 'Return badge' });
  });
});
function chefRequest(date: Date, durationMinutes = 30) {
  return { neonUser: { id: 8 }, firebaseUser: { email_verified: true },
    body: { locationId: 33, targetedKitchenId: 40, scheduledAt: date.toISOString(), durationMinutes,
      intakeData: { intendedUse: 'Catering', estimatedWeeklyHours: '5-10', hasLicense: false, targetStartDate: 'not_decided' } } };
}
function primeKitchen() {
  mocks.rows.push([{ name: "Kitchen", managerId: 1, timezone: "UTC" }], [], [settings]);
}

describe("tour availability enforcement", () => {
  it('rejects foreign self-exclusion before reading public choices', async () => {
    mocks.rows.push([{ id: 99, chefId: 9, targetedKitchenId: 40, status: 'confirmed', scheduledAt: new Date('2099-10-05') }]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2099-10-05', viewingId: '99' }, neonUser: { id: 8 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ slots: expect.anything() }));
  });
  it('offers the authorized customer their own buffered slot but retains a competing reservation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const config = { ...settings, bufferAfterMinutes: 0 };
    mocks.rows.push([{ id: 9, chefId: 8, targetedKitchenId: 40, status: 'confirmed', scheduledAt: new Date('2026-10-03T12:30:00Z'), durationMinutes: 30 }], [config],
      [{ timezone: 'America/St_Johns' }], [config], [{ dayOfWeek: 6, startTime: '10:00', endTime: '11:00', isAvailable: true }], [],
      [{ id: 10, status: 'confirmed', scheduledAt: '2026-10-03T13:00:00Z', durationMinutes: 30 }], [config]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2026-10-03', viewingId: '9' }, neonUser: { id: 8 } }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json.mock.calls[0][0].slots.map((slot: any) => slot.startTime)).toEqual(['10:00']);
  });
  it('offers the current manager self-exclusion without trusting the historical tour manager', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const config = { ...settings, bufferAfterMinutes: 0 };
    mocks.rows.push([{ id: 9, chefId: 8, managerId: 1, locationId: 33, targetedKitchenId: 40, status: 'confirmed', scheduledAt: new Date('2026-10-03T12:30:00Z'), durationMinutes: 30 }], [{ managerId: 2 }], [config],
      [{ timezone: 'America/St_Johns' }], [config], [{ dayOfWeek: 6, startTime: '10:00', endTime: '11:00', isAvailable: true }], [],
      [{ id: 10, status: 'confirmed', scheduledAt: '2026-10-03T13:00:00Z', durationMinutes: 30 }], [config]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2026-10-03', viewingId: '9' }, neonUser: { id: 2, role: 'manager' } }, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json.mock.calls[0][0].slots.map((slot: any) => slot.startTime)).toEqual(['10:00']);
  });
  it('rejects the former manager from self-exclusion even when recorded on the tour', async () => {
    mocks.rows.push([{ id: 9, chefId: 8, managerId: 1, locationId: 33, targetedKitchenId: 40, status: 'confirmed', scheduledAt: new Date('2099-10-05') }], [{ managerId: 2 }]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2099-10-05', viewingId: '9' }, neonUser: { id: 1, role: 'manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('filters the original tour and active booking overlaps from manager replacement choices', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const config = { ...settings, bufferAfterMinutes: 0 };
    const tour = { id: 9, chefId: 8, managerId: 2, locationId: 33, targetedKitchenId: 40, status: 'confirmed', scheduledAt: new Date('2026-10-03T12:30:00Z'), durationMinutes: 30 };
    const booking = { id: 11, kitchenId: 40, referenceCode: 'KB-11', status: 'confirmed', bookingDate: '2026-10-03', startTime: '10:30', endTime: '11:00' };
    mocks.rows.push([tour], [{ managerId: 2 }], [config], [{ timezone: 'America/St_Johns' }], [config],
      [{ dayOfWeek: 6, startTime: '10:00', endTime: '12:00', isAvailable: true }], [], [], [tour], [booking], [config]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2026-10-03', viewingId: '9', proposal: 'true' }, neonUser: { id: 2, role: 'manager' } }, res);
    expect(res.json.mock.calls[0][0].slots.map((slot: any) => slot.startTime)).toEqual(['11:00', '11:30']);
    expect(mocks.rows).toHaveLength(0);
  });
  it('limits manager replacement discovery to an authenticated owned tour', async () => {
    for (const req of [
      { query: { date: '2026-10-03', proposal: 'true' } },
      { query: { date: '2026-10-03', viewingId: '9', proposal: 'true' }, neonUser: { id: 8, role: 'chef' } },
      { query: { date: '2026-10-03', proposal: 'true' }, neonUser: { id: 2, role: 'manager' } },
    ]) {
      const res = response();
      await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, ...req }, res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mocks.rows).toHaveLength(0);
  });
  it('excludes that same authorized tour from fully-booked calendar dates', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const config = { ...settings, bufferAfterMinutes: 0 };
    const tour = { id: 9, chefId: 8, targetedKitchenId: 40, status: 'confirmed', scheduledAt: new Date('2026-10-03T12:30:00Z'), durationMinutes: 30 };
    mocks.rows.push([tour], [config], [{ timezone: 'America/St_Johns' }], [config],
      [{ dayOfWeek: 6, startTime: '10:00', endTime: '10:30', isAvailable: true }], [], [tour]);
    const res = response();
    await handler('/calendar-availability/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { viewingId: '9' }, neonUser: { id: 8 } }, res);
    expect(res.json.mock.calls[0][0].fullyBookedDates).not.toContain('2026-10-03');
  });
  it.each(['pending_local_cooks', 'pending'])('lets the chef exclude their %s request during a time revision', async status => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const config = { ...settings, bufferAfterMinutes: 0 };
    const tour = { id: 9, chefId: 8, targetedKitchenId: 40, status, scheduledAt: new Date('2026-10-03T12:30:00Z'), durationMinutes: 30 };
    mocks.rows.push([tour], [config], [{ timezone: 'America/St_Johns' }], [config],
      [{ dayOfWeek: 6, startTime: '10:00', endTime: '10:30', isAvailable: true }], [], [tour]);
    const res = response();
    await handler('/calendar-availability/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { viewingId: '9' }, neonUser: { id: 8, role: 'chef' } }, res);
    expect(res.json.mock.calls[0][0].fullyBookedDates).not.toContain('2026-10-03');
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.rows.length = 0; });
  afterEach(() => { vi.useRealTimers(); });
  async function slotsOn(date: string, hours: unknown[], blackouts: unknown[] = [], reservations: unknown[] = []) {
    const config = { ...settings, bufferAfterMinutes: 0 };
    mocks.rows.push([{ timezone: 'America/St_Johns' }], [config], hours, blackouts, reservations, [config]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date } }, res);
    return res.json.mock.calls[0][0].slots;
  }
  it('offers an overnight tail only on the actual Newfoundland start date', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const hours = [{ dayOfWeek: 6, startTime: '23:00', endTime: '01:00', isAvailable: true }];
    expect((await slotsOn('2026-10-03', hours)).map((slot: any) => slot.startTime)).toEqual(['23:00', '23:30']);
    expect((await slotsOn('2026-10-04', hours)).map((slot: any) => slot.startTime)).toEqual(['00:00', '00:30']);
  });
  it('blocks a cross-midnight tour against a next-date blackout or reserved tour', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const hours = [{ dayOfWeek: 6, startTime: '23:45', endTime: '01:00', isAvailable: true }];
    const blackout = [{ startDate: '2026-10-04T02:30:00Z', endDate: '2026-10-04T03:30:00Z' }];
    expect(await slotsOn('2026-10-03', hours, blackout)).toEqual([]);
    const reserved = [{ id: 9, status: 'confirmed', scheduledAt: '2026-10-04T02:30:00Z', durationMinutes: 30 }];
    expect(await slotsOn('2026-10-03', hours, [], reserved)).toEqual([]);
  });
  it('offers real DST instants without nonexistent spring times or duplicate reservation instants', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-06T12:00:00Z'));
    const hours = [{ dayOfWeek: 6, startTime: '23:00', endTime: '04:00', isAvailable: true }];
    const spring = await slotsOn('2026-03-08', hours);
    expect(spring.map((slot: any) => slot.startTime)).toEqual(['00:00', '00:30', '01:00', '01:30', '03:00', '03:30']);
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    const fall = await slotsOn('2026-11-01', hours);
    expect(fall.filter((slot: any) => slot.startTime === '01:00')).toHaveLength(2);
    expect(new Set(fall.map((slot: any) => slot.scheduledAt)).size).toBe(fall.length);
  });
  it('protects a tour buffer that extends into a next-date reservation or blackout', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const hours = [{ dayOfWeek: 6, startTime: '23:30', endTime: '01:00', isAvailable: true }];
    for (const blackout of [false, true]) {
      mocks.rows.push([{ timezone: 'America/St_Johns' }], [settings], hours,
        blackout ? [{ startDate: '2026-10-04T02:40:00Z', endDate: '2026-10-04T03:30:00Z' }] : [],
        blackout ? [] : [{ id: 9, status: 'confirmed', scheduledAt: '2026-10-04T02:40:00Z', durationMinutes: 30 }], [settings]);
      const res = response();
      await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2026-10-03' } }, res);
      expect(res.json.mock.calls[0][0].slots).toEqual([]);
    }
  });
  it('keeps same-day Newfoundland slots and HH:mm labels across UTC/browser midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T01:00:00Z')); // Still Oct 7 in Newfoundland.
    mocks.rows.push([{ timezone: 'Asia/Kolkata' }], [settings],
      [{ dayOfWeek: 3, startTime: '23:00', endTime: '23:45', isAvailable: true }], [], [], [settings]);
    const res = response();
    await handler('/available-slots/:kitchenId', 'get')({ params: { kitchenId: '40' }, query: { date: '2026-10-07' } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'America/St_Johns',
      slots: [{ startTime: '23:00', endTime: '23:30', scheduledAt: '2026-10-08T01:30:00.000Z' }] }));
  });
  it("returns no slots beyond the configured advance calendar", async () => {
    mocks.rows.push([{ timezone: "UTC" }], [settings], [settings]);
    const res = response();
    await handler("/available-slots/:kitchenId", "get")({
      params: { kitchenId: "40" }, query: { date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) },
    }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ slots: [] }));
  });
  it("rejects a requested duration that differs from the manager's setting", async () => {
    primeKitchen();
    const res = response();
    await handler("/book", "post")(chefRequest(new Date(Date.now() + 86400000), 60), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects requests outside the kitchen's weekly tour hours", async () => {
    primeKitchen();
    mocks.rows.push([], [settings], []);
    const res = response();
    await handler("/book", "post")(chefRequest(new Date(Date.now() + 86400000)), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "That tour time is no longer available" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not copy booking hours over an existing open tour day", async () => {
    const deleted = vi.fn();
    const tx: any = { execute: vi.fn(), select: () => {
      const chain: any = { from: () => chain, where: () => chain,
        limit: () => Promise.resolve(mocks.rows.shift() ?? []),
        then: (resolve: (value: unknown) => void) => resolve(mocks.rows.shift() ?? []) };
      return chain;
    }, delete: deleted };
    mocks.rows.push([{ id: 40, timezone: "America/St_Johns" }], [settings],
      [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: true }], [{ id: 10 }]);
    mocks.transaction.mockImplementation((run) => run(tx));
    const res = response();
    await handler("/setup/:kitchenId", "put")({ params: { kitchenId: "40" }, neonUser: { id: 1 },
      body: { scheduleSource: "booking" } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Tour hours are already set for this kitchen" });
    expect(deleted).not.toHaveBeenCalled();
  });
  it("adds a tour-only blackout without cancelling scheduled tours", async () => {
    const insert = vi.fn(() => ({ values: () => ({ returning: async () => [{ id: 9, kitchenId: 40 }] }) }));
    const tx: any = { execute: vi.fn(), select: () => {
      const chain: any = { from: () => chain, where: () => Promise.resolve([]) };
      return chain;
    }, insert };
    mocks.rows.push([{ id: 40, locationId: 3, timezone: "UTC" }]);
    mocks.transaction.mockImplementation((run) => run(tx));
    const res = response();
    await handler("/blackouts/:kitchenId", "post")({ params: { kitchenId: "40" }, neonUser: { id: 1 },
      body: { startDate: "2028-02-28", endDate: "2028-03-01", scope: "tour-kitchen" } }, res);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ appliedKitchenIds: [40] }));
  });
  it("copies a facility blackout to bookings while leaving existing date exceptions alone", async () => {
    const values = vi.fn((_value: any) => ({ returning: async () => [{ id: 9, kitchenId: 40 }],
      then: (resolve: (value: unknown) => void) => resolve(undefined) }));
    const tx: any = { execute: vi.fn(), select: () => {
      const chain: any = { from: () => chain, where: () => Promise.resolve(mocks.rows.shift() ?? []) };
      return chain;
    }, insert: () => ({ values }) };
    mocks.rows.push([{ id: 40, locationId: 3, timezone: "UTC" }], [{ id: 40 }, { id: 47 }],
      [], [], [], [],
      [], [], [{ id: 22, kitchenId: 47, specificDate: new Date("2028-02-28T12:00:00Z"),
        isAvailable: true, startTime: "10:00", endTime: "13:00", reason: "Private event" }], []);
    mocks.transaction.mockImplementation((run) => run(tx));
    const res = response();
    await handler("/blackouts/:kitchenId", "post")({ params: { kitchenId: "40" }, neonUser: { id: 1 },
      body: { startDate: "2028-02-28", endDate: "2028-02-28", scope: "facility" } }, res);
    const bookingWrites = values.mock.calls.map(([value]) => value).filter((value: any) => value.specificDate);
    expect(bookingWrites).toHaveLength(1);
    expect(bookingWrites[0].kitchenId).toBe(40);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ skippedBookingDates: 1 }));
  });
});
