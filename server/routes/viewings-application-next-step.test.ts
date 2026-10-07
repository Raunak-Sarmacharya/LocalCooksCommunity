import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ tour: undefined as any, tours: [] as any[], clause: undefined as any, next: vi.fn(), funnel: vi.fn() }));
vi.mock('../db', () => ({ db: { select: () => {
  const chain: any = { from: () => chain, where: (clause: any) => { state.clause = clause; return chain; }, limit: async () => state.tour ? [state.tour] : [],
    orderBy: () => chain, then: (resolve: any) => resolve(state.tours) };
  return chain;
} } }));
vi.mock('../services/tour-application-service', () => ({ resolveTourApplicationNextStep: state.next }));
vi.mock('../services/tour-funnel-service', () => ({ getTourFunnel: state.funnel }));
vi.mock('../chat-service', () => ({ initializeSharedConversation: vi.fn() }));
vi.mock('../services/tour-delivery-service', () => ({ queueTourEvent: vi.fn(), attemptTourDelivery: vi.fn() }));
vi.mock('../services/kitchen-checkout-service', () => ({ getCheckinSettings: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/tour-confirmation-pdf', () => ({ buildTourConfirmationPdf: vi.fn(), tourReference: vi.fn() }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import router from './viewings';
import { DomainError } from '../shared/errors/domain-error';
async function get(path: string, overrides: any = {}) {
  const handler = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods.get).route.stack.at(-1).handle;
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ neonUser: { id: 8, role: 'chef' }, params: { id: '83' }, query: {}, ...overrides }, res);
  return res;
}
beforeEach(() => { vi.clearAllMocks(); state.tours = []; state.tour = { id: 83, chefId: 8 }; state.next.mockResolvedValue({ action: 'apply' }); state.funnel.mockResolvedValue({ stages: {} }); });
describe('completion link and funnel route boundaries', () => {
  it('finds authorized reusable tour information for every application entry point', async () => {
    state.tours = [{ id: 84, chefId: 8, locationId: 4 }, { id: 83, chefId: 8, locationId: 4 }];
    state.next.mockResolvedValueOnce({ action: 'unavailable' }).mockResolvedValueOnce({ action: 'apply', sourceTourId: 83 });
    const res = await get('/chef/application-reference/:locationId', { params: { locationId: '4' } });
    expect(new PgDialect().sqlToQuery(state.clause).params).toEqual([8, 4, 'completed', 'confirmed']);
    expect(state.next).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith({ action: 'apply', sourceTourId: 83 });
  });
  it('returns no prefill when the chef has no qualifying completed tour', async () => {
    expect((await get('/chef/application-reference/:locationId', { params: { locationId: '4' } })).json).toHaveBeenCalledWith(null);
    expect(state.next).not.toHaveBeenCalled();
  });
  it('resolves only owned tours and disables caching of authorization-dependent defaults', async () => {
    const res = await get('/chef/:id/application-next-step');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(new PgDialect().sqlToQuery(state.clause).params).toEqual([83, 8]);
    expect(state.next).toHaveBeenCalledWith(expect.anything(), state.tour, { id: 8, role: 'chef' });
    expect(res.json).toHaveBeenCalledWith({ action: 'apply' });
  });
  it.each([undefined, { id: 83, chefId: 9 }])('does not disclose another chef’s answers: %j', async tour => {
    state.tour = tour; expect((await get('/chef/:id/application-next-step')).status).toHaveBeenCalledWith(404);
    expect(state.next).not.toHaveBeenCalled();
  });
  it('rejects malformed IDs before querying', async () => {
    expect((await get('/chef/:id/application-next-step', { params: { id: 'nope' } })).status).toHaveBeenCalledWith(400);
    expect(state.next).not.toHaveBeenCalled();
  });
  it('restricts funnel to current staff and scalar filters', async () => {
    expect((await get('/funnel')).status).toHaveBeenCalledWith(403);
    expect((await get('/funnel', { neonUser: { id: 2, role: 'manager' }, query: { locationId: ['4'] } })).status).toHaveBeenCalledWith(400);
    expect(state.funnel).not.toHaveBeenCalled();
  });
  it('passes current manager identity and raw filters to the scoped aggregate service', async () => {
    const res = await get('/funnel', { neonUser: { id: 2, role: 'manager' }, query: { from: '2026-10-01', to: '2026-10-07', locationId: '4' } });
    expect(state.funnel).toHaveBeenCalledWith({ role: 'manager', userId: 2, from: '2026-10-01', to: '2026-10-07', locationId: '4' });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('propagates rejected scope without returning another kitchen’s report', async () => {
    state.funnel.mockRejectedValue(new DomainError('FORBIDDEN', 'Location is unavailable', 403));
    expect((await get('/funnel', { neonUser: { id: 2, role: 'manager' } })).status).toHaveBeenCalledWith(403);
  });
});
