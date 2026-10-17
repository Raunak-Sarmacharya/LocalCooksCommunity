import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cap: 90, daysCap: 14, location: {} as any, kitchen: {} as any, writes: [] as any[] }));
vi.mock('../services/booking-policy-settings', () => ({
  bookingWindowCap: async () => state.cap,
  bookingDaysCap: async () => state.daysCap,
  bookingMultidayEnabled: async () => false,
}));
vi.mock('../db', () => {
  const db: any = {
    select: (fields?: any) => {
      let table = '';
      const q: any = { from: (t: any) => { table = t[Symbol.for('drizzle:Name')]; return q; }, innerJoin: () => q, where: () => q, limit: () => q,
        then: (resolve: any) => resolve(table === 'kitchens' ? fields?.kitchen ? [{ kitchen: state.kitchen, location: state.location }] : [state.kitchen] : table === 'locations' ? [state.location] : []) };
      return q;
    },
    update: (table: any) => ({ set: (patch: any) => ({ where: () => {
      state.writes.push(patch);
      const row = table[Symbol.for('drizzle:Name')] === 'locations' ? state.location : state.kitchen;
      Object.assign(row, patch);
      return { returning: async () => [row], then: (resolve: any) => resolve([row]) };
    } }) }),
    insert: () => ({ values: (value: any) => ({ onConflictDoUpdate: async () => {
      state.writes.push(value);
      if (value.key === 'booking_max_days_cap') state.daysCap = Number(value.value);
      else state.cap = Number(value.value);
    } }) }),
    transaction: async (run: any) => run(db),
  };
  return { db, pool: {}, getDbError: (error: unknown) => error };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn(), getAdminDb: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationsByManagerId: async () => [state.location], getLocationById: async () => state.location, updateLocation: async (patch: any) => { state.writes.push(patch); Object.assign(state.location, patch); return state.location; } } }));
import manager from './manager';
import admin from './admin';
const call = async (method: string, path: string, body = {}) => {
  const entry = (manager as any).stack.find((e: any) => e.route?.path === path);
  const handler = entry.route.stack.filter((e: any) => e.method === method).at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ method: method.toUpperCase(), params: { kitchenId: '4', locationId: '1', id: '1' }, neonUser: { id: 2, role: 'manager' }, body }, res);
  return res;
};
beforeEach(() => {
  state.cap = 90; state.daysCap = 14; state.writes = [];
  state.location = {
    id: 1, managerId: 2, maxAdvanceBookingDays: 30, turnoverBufferEnabled: false,
    bookingBufferMinutes: 0, maxBookingDays: 7, allowMultiDayBookings: true,
  };
  state.kitchen = {
    id: 4, locationId: 1, minimumBookingHours: 0, maxAdvanceBookingDays: null, turnoverBufferEnabled: null,
    bookingBufferMinutes: null, maxBookingDays: null, allowMultiDayBookings: null, weeklyChefHoursLimit: null,
  };
});
const workspace = '/kitchens/:kitchenId/workspace-settings';
it.each([0, -1, 91, 1.5, '30'])('rejects invalid kitchen advance window %s without writes', async value => {
  const res = await call('put', workspace, { maxAdvanceBookingDays: value });
  expect(res.status).toHaveBeenCalledWith(400); expect(state.writes).toEqual([]);
});
it('saves and independently resets both per-kitchen overrides', async () => {
  const saved = await call('put', workspace, { maxAdvanceBookingDays: 60, bookingBufferMinutes: 60 });
  expect(saved.json).toHaveBeenCalledWith(expect.objectContaining({
    effective: expect.objectContaining({
      maxAdvanceBookingDays: 60, turnoverBufferEnabled: true, bookingBufferMinutes: 60, maxAdvanceBookingDaysCap: 90,
    }),
  }));
  await call('put', workspace, { maxAdvanceBookingDays: null, bookingBufferMinutes: null });
  expect(state.kitchen).toMatchObject({ maxAdvanceBookingDays: null, bookingBufferMinutes: null, turnoverBufferEnabled: null });
});
it('inherits On/7 multi-day defaults and keeps stored N when toggled Off', async () => {
  const res = await call('get', workspace);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    effective: expect.objectContaining({ allowMultiDayBookings: true, maxBookingDays: 7, maxBookingDaysCap: 14 }),
  }));
  await call('put', workspace, { allowMultiDayBookings: false, maxBookingDays: 10 });
  expect(state.kitchen).toMatchObject({ allowMultiDayBookings: false, maxBookingDays: 10 });
  expect((await call('get', workspace)).json).toHaveBeenCalledWith(expect.objectContaining({
    kitchen: expect.objectContaining({ maxBookingDays: 10 }),
    effective: expect.objectContaining({ allowMultiDayBookings: false, maxBookingDays: 10 }),
  }));
});
it('saves numeric buffer 0/60/120 and optional weekly limit', async () => {
  await call('put', workspace, { bookingBufferMinutes: 120, weeklyChefHoursLimit: 8 });
  expect(state.kitchen).toMatchObject({ bookingBufferMinutes: 120, turnoverBufferEnabled: true, weeklyChefHoursLimit: 8 });
  await call('put', workspace, { weeklyChefHoursLimit: null });
  expect(state.kitchen.weeklyChefHoursLimit).toBeNull();
  const bad = await call('put', workspace, { bookingBufferMinutes: 90 });
  expect(bad.status).toHaveBeenCalledWith(400);
});
it('stale boolean On does not erase a 2 h kitchen buffer', async () => {
  state.kitchen.bookingBufferMinutes = 120; state.kitchen.turnoverBufferEnabled = true;
  await call('put', workspace, { turnoverBufferEnabled: true });
  expect(state.kitchen).toMatchObject({ bookingBufferMinutes: 120, turnoverBufferEnabled: true });
});
it('reads old values above a lowered cap while exposing the effective cap', async () => {
  state.kitchen.maxAdvanceBookingDays = 60; state.kitchen.maxBookingDays = 12; state.cap = 20; state.daysCap = 5;
  const res = await call('get', workspace);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    kitchen: expect.objectContaining({ maxAdvanceBookingDays: 60, maxBookingDays: 12 }),
    effective: expect.objectContaining({ maxAdvanceBookingDays: 20, maxAdvanceBookingDaysCap: 20, maxBookingDays: 5, maxBookingDaysCap: 5 }),
  }));
  expect(state.writes).toEqual([]);
});
it('applies location policies and clears the matching kitchen overrides', async () => {
  await call('put', '/locations/:locationId/kitchen-booking-policies', {
    maxAdvanceBookingDays: 45, bookingBufferMinutes: 60, maxBookingDays: 5, allowMultiDayBookings: true,
  });
  expect(state.location).toMatchObject({
    maxAdvanceBookingDays: 45, bookingBufferMinutes: 60, turnoverBufferEnabled: true, maxBookingDays: 5, allowMultiDayBookings: true,
  });
  expect(state.kitchen).toMatchObject({
    maxAdvanceBookingDays: null, bookingBufferMinutes: null, turnoverBufferEnabled: null, maxBookingDays: null, allowMultiDayBookings: null,
  });
});

it('accepts window and buffer on the contracted location PUT and ignores a client-supplied cap', async () => {
  const res = await call('put', '/locations/:locationId', { maxAdvanceBookingDays: 60, bookingBufferMinutes: 60, maxAdvanceBookingDaysCap: 999 });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    maxAdvanceBookingDays: 60, turnoverBufferEnabled: true, bookingBufferMinutes: 60, maxAdvanceBookingDaysCap: 90, maxBookingDaysCap: 14,
  }));
  expect(state.writes[0]).not.toHaveProperty('maxAdvanceBookingDaysCap');
});
it.each([0, 91])('rejects invalid location advance window %s before writing', async value => {
  const res = await call('put', '/locations/:locationId', { maxAdvanceBookingDays: value });
  expect(res.status).toHaveBeenCalledWith(400); expect(state.writes).toEqual([]);
});

it('admin reads the cap and can lower it without rewriting kitchen policy values', async () => {
  const route = (method: string) => (admin as any).stack.find((e: any) => e.route?.path === '/booking-window-cap' && e.route.methods[method]).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route('get')({}, res);
  expect(res.json).toHaveBeenCalledWith({ maxAdvanceBookingDaysCap: 90 });
  await route('put')({ neonUser: { id: 7 }, body: { maxAdvanceBookingDaysCap: 20 } }, res);
  expect(state.cap).toBe(20); expect(state.location.maxAdvanceBookingDays).toBe(30);
  expect(state.writes[0]).toMatchObject({ key: 'booking_max_advance_days_cap', value: '20', updatedBy: 7 });
});
it.each([0, -1, 1.5, '90'])('admin rejects invalid cap %s without writing', async cap => {
  const handler = (admin as any).stack.find((e: any) => e.route?.path === '/booking-window-cap' && e.route.methods.put).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ neonUser: { id: 7 }, body: { maxAdvanceBookingDaysCap: cap } }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(state.writes).toEqual([]);
});
it('admin booking-days-cap is bounded 1..14 and protected from generic settings writes', async () => {
  const route = (method: string, path: string) => (admin as any).stack.find((e: any) => e.route?.path === path && e.route.methods[method]).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route('get', '/booking-days-cap')({}, res);
  expect(res.json).toHaveBeenCalledWith({ maxBookingDaysCap: 14 });
  await route('put', '/booking-days-cap')({ neonUser: { id: 7 }, body: { maxBookingDaysCap: 10 } }, res);
  expect(state.daysCap).toBe(10);
  expect(state.writes.at(-1)).toMatchObject({ key: 'booking_max_days_cap', value: '10' });
  const bad = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route('put', '/booking-days-cap')({ neonUser: { id: 7 }, body: { maxBookingDaysCap: 15 } }, bad);
  expect(bad.status).toHaveBeenCalledWith(400);
  const blocked = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route('patch', '/settings/:key')({ neonUser: { id: 7 }, params: { key: 'booking_max_days_cap' }, body: { value: '1' } }, blocked);
  expect(blocked.status).toHaveBeenCalledWith(400);
});
