import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tour: {} as any, location: {} as any, eligible: {} as any,
  pairs: [] as any[], provision: vi.fn(), eligibility: vi.fn(), application: {} as any }));
vi.mock('../db', () => ({ pool: {}, db: { select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain,
    then: (resolve: any) => Promise.resolve(state.tour ? [state.tour] : []).then(resolve) }; return chain;
} } }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../services/participant-chat', () => ({
  serializeChat: (value: any) => value, orphanChatHistory: async () => [],
  withParticipantChat: async (_actor: any, _uid: any, id: string, action: any) => action({ live: true, role: _actor.role,
    ref: { id, get: async () => ({ data: () => ({ chefId: 3, locationId: 5 }) }), collection: () => {
      const chain: any = { orderBy: () => chain, limit: () => chain, get: async () => ({ docs: [
        { id: 'shared', data: () => ({ senderRole: 'admin', adminAudience: 'both', readAt: null,
          recipientStates: { chef: { readAt: 'chef-read' }, manager: { readAt: null } } }) }
      ] }) }; return chain;
    } } }),
}));
vi.mock('../domains/locations/location.service', () => ({ LocationService: class { getLocationById() { return Promise.resolve(state.location); } } }));
vi.mock('../domains/applications/chef-application.service', () => ({ chefApplicationService: { getApplicationById: () => state.application } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: (id: number) => `Participant ${id}` }));
vi.mock('../chat-service', () => ({ initializeSharedConversation: state.provision, initializeConversation: state.provision,
  getAdminDb: async () => ({ collection: () => ({ doc: () => ({ get: async () => ({ id: 'history', exists: true, data: () => ({ chefId: 3, locationId: 5 }) }) }) }) }),
  sendSystemNotification: vi.fn(), notifyTierTransition: vi.fn() }));
vi.mock('../services/shared-chat-access', async importOriginal => ({ ...await importOriginal<any>(),
  sharedChatEligibility: state.eligibility, participantChatRelationships: async () => state.pairs }));
import { kitchenApplicationsRouter as router } from './firebase/kitchen-applications';
const route = (path: string) => (router as any).stack.find((entry: any) => entry.route?.path === path).route;
async function open(path: string, actor = { id: 3, role: 'chef' }, params = { viewingId: '20', chefId: '3', locationId: '5', applicationId: '8' }) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route(path).stack.at(-1).handle({ params, neonUser: actor, firebaseUser: { uid: 'test-uid' } }, response); return response;
}
const exact = '/firebase/chat/viewings/:viewingId/conversation';
beforeEach(() => { vi.clearAllMocks(); state.tour = { id: 20, chefId: 3, locationId: 5, status: 'pending', adminReviewDecision: 'approved', managerNotes: 'secret' };
  state.location = { id: 5, name: 'Real location', managerId: 2 };
  state.eligible = { applications: [], viewingIds: [20] }; state.eligibility.mockResolvedValue(state.eligible);
  state.provision.mockResolvedValue('history'); state.pairs = [{ chefId: 3, locationId: 5 }];
  state.application = { id: 8, chefId: 3, locationId: 5, status: 'approved' };
});
describe('participant shared chat routes', () => {
  it('opens exact tour chat through the admin route with current manager context', async () => {
    const path = '/firebase/admin/chat/viewings/:viewingId/conversation';
    const response = await open(path, { id: 9, role: 'admin' });
    expect(response.json).toHaveBeenCalledWith({ conversationId: 'history', chefId: 3, managerId: 2, locationId: 5, chefName: 'Participant 3' });
    expect(state.provision).toHaveBeenCalledWith(3, 5);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret');
    expect(route(path).stack).toHaveLength(3);
  });
  it('rejects non-admins and unforwarded tours before admin chat provisioning', async () => {
    const path = '/firebase/admin/chat/viewings/:viewingId/conversation';
    expect((await open(path)).status).toHaveBeenCalledWith(403);
    expect(state.provision).not.toHaveBeenCalled();
    state.tour.status = 'pending_local_cooks';
    expect((await open(path, { id: 9, role: 'admin' })).status).toHaveBeenCalledWith(409);
    expect(state.provision).not.toHaveBeenCalled();
  });
  it.each([{ id: 3, role: 'chef' }, { id: 2, role: 'manager' }])('opens the exact approved tour for $role with server labels and exact return', async actor => {
    const response = await open(exact, actor);
    expect(state.provision).toHaveBeenCalledWith(3, 5);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'history', viewingId: 20,
      locationName: 'Real location', chefName: 'Participant 3', linkedApplicationIds: [],
      path: `${actor.role === 'manager' ? '/manager' : ''}/dashboard?view=messages&conversation=history&tour=20` }));
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret');
  });
  it.each([{ id: 99, role: 'chef' }, { id: 7, role: 'manager' }, { id: 3, role: 'admin' }])('denies foreign/former/wrong-role actors before provisioning', async actor => {
    expect((await open(exact, actor)).status).toHaveBeenCalledWith(404);
    expect(state.provision).not.toHaveBeenCalled(); expect(state.eligibility).not.toHaveBeenCalled();
  });
  it.each(['pending_local_cooks', 'denied'])('denies %s exact tours even when another relationship qualifies', async value => {
    state.tour = { ...state.tour, status: value === 'pending_local_cooks' ? value : 'cancelled', adminReviewDecision: value === 'denied' ? 'denied' : null };
    expect((await open(exact)).status).toHaveBeenCalledWith(409); expect(state.provision).not.toHaveBeenCalled();
  });
  it('rejects unsafe IDs and retains the authentication middleware', async () => {
    expect((await open(exact, undefined, { viewingId: '9007199254740992' } as any)).status).toHaveBeenCalledWith(400);
    expect(state.provision).not.toHaveBeenCalled(); expect(route(exact).stack).toHaveLength(2);
  });
  it('lists eligible tour-only threads and reports recoverable provisioning failure', async () => {
    expect((await open('/firebase/chat/conversations')).json).toHaveBeenCalledWith({ conversations: [expect.objectContaining({ conversationId: 'history' })] });
    state.provision.mockResolvedValue(null);
    const failed = await open(exact); expect(failed.status).toHaveBeenCalledWith(409);
    expect(failed.json.mock.calls[0][0].conversationId).toBeUndefined();
  });
  it('guards location resolution before healing and preserves the approved application route', async () => {
    const locationPath = '/firebase/chat/locations/:locationId/chefs/:chefId/conversation';
    expect((await open(locationPath, { id: 7, role: 'manager' })).status).toHaveBeenCalledWith(404);
    expect(state.provision).not.toHaveBeenCalled();
    const response = await open('/firebase/chat/applications/:applicationId/conversation');
    expect(state.provision).toHaveBeenCalledWith(state.application);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'history' }));
  });
  it.each([{ id: 3, role: 'chef', readAt: 'chef-read' }, { id: 2, role: 'manager', readAt: null }])('projects only the $role read receipt for shared admin messages', async actor => {
    const response = await open('/firebase/chat/conversations/:conversationId/messages', actor, { conversationId: 'history' } as any);
    expect(response.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'shared', readAt: actor.readAt })]);
  });
});
