import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cap: 90, location: {} as any, kitchen: {} as any, writes: [] as any[] }));
vi.mock('../services/booking-policy-settings', () => ({ bookingWindowCap: async () => state.cap }));
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
    insert: () => ({ values: (value: any) => ({ onConflictDoUpdate: async () => { state.writes.push(value); state.cap = Number(value.value); } }) }),
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
  state.cap = 90; state.writes = [];
  state.location = { id: 1, managerId: 2, maxAdvanceBookingDays: 30, turnoverBufferEnabled: false };
  state.kitchen = { id: 4, locationId: 1, minimumBookingHours: 0, maxAdvanceBookingDays: null, turnoverBufferEnabled: null };
});
const workspace = '/kitchens/:kitchenId/workspace-settings';
it.each([0, -1, 91, 1.5, '30'])('rejects invalid kitchen advance window %s without writes', async value => {
  const res = await call('put', workspace, { maxAdvanceBookingDays: value });
  expect(res.status).toHaveBeenCalledWith(400); expect(state.writes).toEqual([]);
});
it('saves and independently resets both per-kitchen overrides', async () => {
  const saved = await call('put', workspace, { maxAdvanceBookingDays: 60, turnoverBufferEnabled: true });
  expect(saved.json).toHaveBeenCalledWith(expect.objectContaining({ effective: expect.objectContaining({ maxAdvanceBookingDays: 60, turnoverBufferEnabled: true, maxAdvanceBookingDaysCap: 90 }) }));
  await call('put', workspace, { maxAdvanceBookingDays: null, turnoverBufferEnabled: null });
  expect(state.kitchen).toMatchObject({ maxAdvanceBookingDays: null, turnoverBufferEnabled: null });
});
it('reads old values above a lowered cap while exposing the effective cap', async () => {
  state.kitchen.maxAdvanceBookingDays = 60; state.cap = 20;
  const res = await call('get', workspace);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ kitchen: expect.objectContaining({ maxAdvanceBookingDays: 60 }), effective: expect.objectContaining({ maxAdvanceBookingDays: 20, maxAdvanceBookingDaysCap: 20 }) }));
  expect(state.writes).toEqual([]);
});
it('applies location policies and clears the matching kitchen overrides', async () => {
  await call('put', '/locations/:locationId/kitchen-booking-policies', { maxAdvanceBookingDays: 45, turnoverBufferEnabled: true });
  expect(state.location).toMatchObject({ maxAdvanceBookingDays: 45, turnoverBufferEnabled: true });
  expect(state.kitchen).toMatchObject({ maxAdvanceBookingDays: null, turnoverBufferEnabled: null });
});

it('accepts window and buffer on the contracted location PUT and ignores a client-supplied cap', async () => {
  const res = await call('put', '/locations/:locationId', { maxAdvanceBookingDays: 60, turnoverBufferEnabled: true, maxAdvanceBookingDaysCap: 999 });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ maxAdvanceBookingDays: 60, turnoverBufferEnabled: true, maxAdvanceBookingDaysCap: 90 }));
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
