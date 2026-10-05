import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ setup: {} as any, writes: [] as any[], kitchen: {} as any, transactions: 0 }));
vi.mock('../db', () => {
  const database: any = {
    select: () => {
      let table: any;
      const rows = () => {
        const name = table[Symbol.for('drizzle:Name')];
        if (name === 'locations') return [{ id: 33 }];
        if (name === 'kitchens') return [{ kitchen: state.kitchen, location: { id: 33, managerId: 2 } }];
        return [state.setup];
      };
      const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => chain,
        where: () => chain, limit: () => chain, then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
      return chain;
    },
    insert: () => ({ values: (patch: any) => ({ onConflictDoUpdate: () => ({ returning: async () => {
      state.writes.push(patch); Object.assign(state.setup, patch); return [state.setup];
    } }) }) }),
    update: (table: any) => ({ set: (patch: any) => ({ where: () => {
      state.writes.push({ table: table[Symbol.for('drizzle:Name')], ...patch });
      const row = table[Symbol.for('drizzle:Name')] === 'kitchens' ? state.kitchen : state.setup;
      Object.assign(row, patch);
      return { returning: async () => [row], then: (resolve: any) => Promise.resolve([]).then(resolve) };
    } }) }),
    transaction: async (run: any) => { state.transactions++; return run(database); },
  };
  return { db: database, pool: {} };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../services/kitchen-checkout-service', async original => ({
  ...await original<typeof import('../services/kitchen-checkout-service')>(),
  getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 20, noShowGraceMinutes: 40, checkoutReviewWindowMinutes: 90 }),
}));
vi.mock('../services/damage-claim-limits-service', async original => ({
  ...await original<typeof import('../services/damage-claim-limits-service')>(),
  getStorageCheckoutSettings: async () => ({ reviewWindowHours: 3 }),
}));
import manager from './manager';

const handler = (path: string) => (manager as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods.put).route.stack.at(-1).handle;
const call = async (body: any, workspace = false) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(workspace ? '/kitchens/:kitchenId/workspace-settings' : '/locations/:locationId/checkin-checkout-settings')({
    method: 'PUT', params: { kitchenId: '40', locationId: '33' }, body, neonUser: { id: 2, role: 'manager' },
  }, res);
  return res;
};
beforeEach(() => {
  state.setup = { id: 1, locationId: 33, checkinEnabled: false, checkoutEnabled: false,
    checkinInstructions: null, checkoutInstructions: null, storageCheckinEnabled: false, storageCheckoutEnabled: false,
    checkinItems: [], checkoutItems: [], storageCheckinItems: [], storageCheckoutItems: [] };
  state.kitchen = { id: 40, locationId: 33, checkinCheckoutEnabled: false };
  state.writes = []; state.transactions = 0;
});

it.each([false, true])('rejects enabling without saved notes at the actual route (storage: %s)', async storage => {
  const res = await call(storage ? { storageCheckinEnabled: true } : { checkinEnabled: true });
  expect(res.status).toHaveBeenCalledWith(400); expect(state.writes).toEqual([]);
});
it('saves notes and both kitchen stages with empty duties, leaving storage alone', async () => {
  const res = await call({ checkinEnabled: true, checkinInstructions: 'Use the main door.', checkoutInstructions: 'Lock the door.', checkinItems: [], checkoutItems: [] });
  expect(res.status).not.toHaveBeenCalled();
  expect(state.writes[0]).toMatchObject({ checkinEnabled: true, checkoutEnabled: true, checkinItems: [], checkoutItems: [] });
  expect(state.writes[0]).not.toHaveProperty('storageCheckinEnabled');
});
it('rejects clearing notes for enabled storage and conflicting stage switches before upsert', async () => {
  Object.assign(state.setup, { storageCheckinEnabled: true, storageCheckoutEnabled: true, storageCheckinInstructions: 'Use shelf A.', storageCheckoutInstructions: 'Empty shelf A.' });
  expect((await call({ storageCheckoutInstructions: '  ' })).status).toHaveBeenCalledWith(400);
  expect((await call({ storageCheckinEnabled: true, storageCheckoutEnabled: false })).status).toHaveBeenCalledWith(400);
  expect(state.writes).toEqual([]);
});
it('blocks the per-kitchen enable switch until notes are saved, then enables both shared stages in the same transaction', async () => {
  expect((await call({ checkinCheckoutEnabled: true }, true)).status).toHaveBeenCalledWith(400);
  expect(state.writes).toEqual([]); expect(state.transactions).toBe(0);
  Object.assign(state.setup, { checkinInstructions: 'Use the door.', checkoutInstructions: 'Lock the door.' });
  const res = await call({ checkinCheckoutEnabled: true }, true);
  expect(res.status).not.toHaveBeenCalled(); expect(state.transactions).toBe(1);
  expect(state.writes[0]).toMatchObject({ checkinEnabled: true, checkoutEnabled: true });
  expect(state.kitchen.checkinCheckoutEnabled).toBe(true);
  expect(state.setup.checkinItems).toEqual([]);
});

it('returns the actual configurable kitchen and independent storage review windows for manager help', async () => {
  const get = (manager as any).stack.find((entry: any) => entry.route?.path === '/locations/:locationId/checkin-checkout-settings' && entry.route.methods.get).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await get({ params: { locationId: '33' }, neonUser: { id: 2, role: 'manager' } }, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    platformDefaults: { checkinWindowMinutesBefore: 20, noShowGraceMinutes: 40, checkoutReviewWindowMinutes: 90 },
    storageDefaults: { checkoutReviewWindowMinutes: 180 },
  }));
  expect(state.writes).toEqual([]);
});
