import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ row: null as any, application: null as any, initialize: vi.fn(), queries: [] as any[] }));
vi.mock('../db', () => ({ pool: {}, db: { select: () => {
  let table: any;
  const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => chain,
    where: (condition: any) => { state.queries.push(condition); return chain; }, orderBy: () => chain, limit: () => chain,
    then: (resolve: any) => Promise.resolve(table[Symbol.for('drizzle:Name')] === 'storage_bookings'
      ? state.row ? [state.row] : [] : state.application ? [state.application] : []).then(resolve) };
  return chain;
} } }));
vi.mock('../chat-service', () => ({ initializeConversation: state.initialize }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
import router from './storage-rentals';
import { requireFirebaseAuthWithUser } from '../firebase-auth-middleware';
import { PgDialect } from 'drizzle-orm/pg-core';
const route = (router as any).stack.find((entry: any) => entry.route?.path === '/storage-rentals/:id/conversation').route;
async function open(userId = 3, id = '10') {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route.stack.at(-1).handle({ params: { id }, neonUser: { id: userId }, path: `/storage-rentals/${id}/conversation` }, response);
  return response;
}
beforeEach(() => {
  vi.clearAllMocks(); state.queries = [];
  state.row = { rental: { id: 10, chefId: 3, rentalState: 'reserved', rentalTerms: { version: 'storage-v1' } }, locationId: 5, managerId: 2 };
  state.application = { id: 8, chefId: 3, locationId: 5, status: 'approved' };
  state.initialize.mockResolvedValue('existing/thread');
});
describe('storage rental conversation', () => {
  it.each([3, 2])('opens the existing application conversation for participant %s', async userId => {
    expect(route.stack[0].handle).toBe(requireFirebaseAuthWithUser);
    const response = await open(userId);
    expect(state.initialize).toHaveBeenCalledWith(state.application);
    expect(response.json).toHaveBeenCalledWith({ conversationId: 'existing/thread', rentalId: 10, applicationId: 8,
      path: `${userId === 2 ? '/manager' : ''}/dashboard?view=messages&conversation=existing%2Fthread` });
    const query = new PgDialect().sqlToQuery(state.queries[1]);
    expect(query.params).toEqual([3, 5, 'approved']);
    expect(query.sql).toContain('"chef_kitchen_applications"."location_id"');
  });
  it('rejects a stranger before looking up or initializing chat', async () => {
    expect((await open(99)).status).toHaveBeenCalledWith(404);
    expect(state.queries).toHaveLength(1);
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it.each(['requested', 'reserved', 'active', 'move_out_requested', 'removal_review', 'ended'])('supports %s rentals', async rentalState => {
    state.row.rental.rentalState = rentalState;
    expect((await open()).json).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'existing/thread' }));
  });
  it.each(['declined', 'expired', 'withdrawn'])('refuses %s rentals', async rentalState => {
    state.row.rental.rentalState = rentalState;
    expect((await open()).status).toHaveBeenCalledWith(409);
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it('handles absent rentals, legacy rentals, invalid ids and missing applications', async () => {
    expect((await open(3, '10junk')).status).toHaveBeenCalledWith(400);
    state.row.rental.rentalTerms = null;
    expect((await open()).status).toHaveBeenCalledWith(404);
    state.row = null;
    expect((await open()).status).toHaveBeenCalledWith(404);
    state.row = { rental: { chefId: 3, rentalState: 'ended', rentalTerms: {} }, locationId: 5, managerId: 2 };
    state.application = null;
    expect((await open()).status).toHaveBeenCalledWith(409);
    expect(state.initialize).not.toHaveBeenCalled();
  });
  it('reports unavailable chat without exposing provider errors', async () => {
    state.initialize.mockResolvedValue(null);
    expect((await open()).status).toHaveBeenCalledWith(409);
    state.initialize.mockRejectedValue(new Error('private provider details'));
    const response = await open();
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json.mock.calls[0][0].error).not.toContain('private provider details');
  });
});
