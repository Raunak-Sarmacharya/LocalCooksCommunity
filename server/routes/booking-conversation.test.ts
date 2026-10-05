import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ row: {} as any, application: {} as any, initialize: vi.fn() }));
vi.mock('../db', () => ({ pool: {}, db: { select: () => {
  let table: any;
  const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => chain,
    where: () => chain, orderBy: () => chain, limit: () => chain,
    then: (resolve: any) => Promise.resolve(table[Symbol.for('drizzle:Name')] === 'kitchen_bookings' ? [state.row] : state.application ? [state.application] : []).then(resolve) };
  return chain;
} } }));
vi.mock('../chat-service', () => ({ initializeConversation: state.initialize }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('./middleware', () => ({ requireChef: vi.fn(), requireNoUnpaidPenalties: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import router from './bookings';
const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/bookings/:id/conversation').route.stack.at(-1).handle;
async function open(id = 3) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params: { id: '10' }, neonUser: { id } }, response); return response;
}
beforeEach(() => { vi.clearAllMocks(); state.row = { booking: { id: 10, chefId: 3, status: 'confirmed' }, locationId: 5, managerId: 2 };
  state.application = { id: 8, chefId: 3, locationId: 5, status: 'approved' }; state.initialize.mockResolvedValue('existing-thread'); });
describe('real booking conversation route', () => {
  it.each([3, 2])('opens the existing authorized application conversation for participant %s', async id => {
    const response = await open(id);
    expect(state.initialize).toHaveBeenCalledWith(state.application);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'existing-thread', bookingId: 10,
      path: `${id === 2 ? '/manager' : ''}/dashboard?view=messages&conversation=existing-thread&booking=10` }));
  });
  it('rejects foreign participants before conversation creation/healing', async () => {
    expect((await open(99)).status).toHaveBeenCalledWith(404); expect(state.initialize).not.toHaveBeenCalled();
  });
  it('protects unconfirmed bookings and reports the exact missing legacy application prerequisite', async () => {
    state.row.booking.status = 'pending'; expect((await open()).status).toHaveBeenCalledWith(409);
    state.row.booking.status = 'confirmed'; state.application = null;
    expect((await open()).json).toHaveBeenCalledWith({ error: 'The kitchen application conversation is unavailable. Contact Local Cooks for help.' });
    expect(state.initialize).not.toHaveBeenCalled();
  });
});
