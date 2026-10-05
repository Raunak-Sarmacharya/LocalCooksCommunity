import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ weekly: [] as any[], overrides: [] as any[], bookings: [] as any[], writes: [] as any[], recovery: vi.fn(), tours: vi.fn() }));
vi.mock('../services/commitment-problems', () => ({ queueScheduleProblems: state.recovery, affectedTours: state.tours }));
vi.mock('../services/facility-exceptions', async original => ({ ...await original<typeof import('../services/facility-exceptions')>(), syncTourClosure: vi.fn() }));
vi.mock('../db', () => {
  const database: any = {
    execute: vi.fn(), transaction: async (run: any) => { const count = state.writes.length; try { return await run(database); } catch (error) { state.writes.length = count; throw error; } },
    select: () => {
      let table = '';
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; }, innerJoin: () => chain,
        where: () => chain, limit: () => chain, orderBy: () => chain, for: () => chain, then: (resolve: any) => resolve(
          table === 'kitchens' ? [{ id: 40, managerId: 2, locationId: 33, timezone: 'America/St_Johns' }]
            : table === 'locations' ? [{ id: 33, managerId: 2 }]
            : table === 'kitchen_availability' ? state.weekly : table === 'kitchen_date_overrides' ? state.overrides
            : table === 'kitchen_bookings' ? state.bookings : []) };
      return chain;
    },
    insert: (table: any) => ({ values: (value: any) => { const chain: any = { returning: async () => { state.writes.push({ table: table[Symbol.for('drizzle:Name')], value }); return [{ id: 77, ...value }]; },
      then: (resolve: any) => { state.writes.push({ table: table[Symbol.for('drizzle:Name')], value }); resolve([]); } }; return chain; } }),
    update: (table: any) => ({ set: (value: any) => ({ where: () => { const chain: any = { returning: async () => { state.writes.push({ table: table[Symbol.for('drizzle:Name')], value }); return [{ id: 77, ...value }]; },
      then: (resolve: any) => { state.writes.push({ table: table[Symbol.for('drizzle:Name')], value }); resolve([]); } }; return chain; } }) }),
  };
  return { db: database, pool: {} };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
import manager from './manager';
const handler = (path: string, method: string) => (manager as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
async function call(path: string, method: string, body: any) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(path,method)({ params: { kitchenId:'40', id:'77' }, neonUser:{ id:2, role:'manager' }, body },res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks(); state.writes=[]; state.overrides=[];
  state.weekly = Array.from({ length:7 }, (_,dayOfWeek) => ({ id:dayOfWeek+1,kitchenId:40,dayOfWeek,isAvailable:true,startTime:'08:00',endTime:'18:00' }));
  state.bookings=[{ id:10,kitchenId:40,bookingDate:new Date('2099-10-05T12:00:00Z'),status:'confirmed' }];
  state.tours.mockResolvedValue([20]); state.recovery.mockResolvedValue(undefined);
});
it('date closure preserves exact acknowledgment and commits both booking and tour recovery in the mutation transaction', async () => {
  const body = { specificDate:'2099-10-05',isAvailable:false,reason:'Maintenance' };
  const rejected = await call('/kitchens/:kitchenId/date-overrides','post',body);
  expect(rejected.status).toHaveBeenCalledWith(409); expect(state.writes).toEqual([]); expect(state.recovery).not.toHaveBeenCalled();
  const saved = await call('/kitchens/:kitchenId/date-overrides','post',{ ...body,acknowledgedBookingIds:[10] });
  expect(saved.status).not.toHaveBeenCalled();
  expect(state.recovery).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ bookingIds:[10],tourIds:[20],actorId:2,kitchenId:40 }));
  expect(state.writes.map(row => row.table)).toEqual(['kitchen_date_overrides']);
});
it('stale closure acknowledgment rejects changed affected identities without scheduling contact', async () => {
  state.bookings.push({ ...state.bookings[0],id:11 });
  const res = await call('/kitchens/:kitchenId/date-overrides','post',{ specificDate:'2099-10-05',isAvailable:false,acknowledgedBookingIds:[10] });
  expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ bookingIds:[10,11] }));
  expect(state.writes).toEqual([]); expect(state.recovery).not.toHaveBeenCalled();
});
it('also rejects stale acknowledgment when no affected commitment remains', async () => {
  state.bookings=[];
  const res = await call('/kitchens/:kitchenId/date-overrides','post',{ specificDate:'2099-10-05',isAvailable:false,acknowledgedBookingIds:[10] });
  expect(res.status).toHaveBeenCalledWith(409); expect(state.writes).toEqual([]);
});
it('narrower open-date updates produce an outstanding recovery task without changing the booking', async () => {
  state.overrides=[{ id:77,kitchenId:40,specificDate:new Date('2099-10-05T12:00:00Z'),isAvailable:true,startTime:'08:00',endTime:'18:00',reason:null }];
  await call('/date-overrides/:id','put',{ isAvailable:true,startTime:'10:00',endTime:'12:00',acknowledgedBookingIds:[10] });
  expect(state.recovery).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ bookingIds:[10],tourIds:[20] }));
  expect(state.writes.map(row => row.table)).toEqual(['kitchen_date_overrides']);
});
it('weekly and legacy single-day material changes use the same acknowledged recovery producer', async () => {
  const dayOfWeek = state.bookings[0].bookingDate.getUTCDay();
  const days=state.weekly.map(day => ({ ...day,isAvailable:day.dayOfWeek!==dayOfWeek }));
  await call('/availability/weekly','put',{ kitchenId:40,days,acknowledgedBookingIds:[10] });
  expect(state.recovery).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ bookingIds:[10],tourIds:[20] }));
  state.recovery.mockClear(); state.writes=[];
  await call('/availability','post',{ kitchenId:40,dayOfWeek,isAvailable:false,acknowledgedBookingIds:[10] });
  expect(state.recovery).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ bookingIds:[10],tourIds:[20] }));
  expect(state.writes.every(row => row.table==='kitchen_availability')).toBe(true);
});
it('a recovery persistence failure prevents a successful material change handoff', async () => {
  state.recovery.mockRejectedValueOnce(Error('Outbox unavailable'));
  const res=await call('/kitchens/:kitchenId/date-overrides','post',{ specificDate:'2099-10-05',isAvailable:false,acknowledgedBookingIds:[10] });
  expect(res.status).toHaveBeenCalledWith(500); expect(state.writes).toEqual([]);
});
