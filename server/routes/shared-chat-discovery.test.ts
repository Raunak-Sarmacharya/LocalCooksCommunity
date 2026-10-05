import { beforeEach, describe, expect, it, vi } from 'vitest';
// Connected list regression: the real route, real participant-chat discovery and
// helper run against an in-memory Firestore/SQL model. Only C1 provisioning is
// modelled (adopt oldest pair history when unmapped, else return the mapping).
const state = vi.hoisted(() => ({ users: [] as any[], docs: {} as Record<string, any>, mappings: {} as Record<string, string>,
  pairs: [] as any[], provisionFails: false, location: { id: 5, name: 'Real location', managerId: 2 } }));
vi.mock('../db', () => {
  const database: any = { transaction: async (action: any) => action(database), select: () => {
    let table: string;
    const chain: any = { from: (value: any) => { table = value?.[Symbol.for('drizzle:Name')]; return chain; },
      where: () => chain, innerJoin: () => chain, limit: () => chain, for: () => chain,
      then: (resolve: any) => resolve(table === 'locations' ? [state.location] : table === 'users' ? state.users :
        table === 'kitchen_viewings' ? [{ status: 'pending', adminReviewDecision: 'approved' }] : []) };
    return chain;
  } };
  return { pool: {}, db: database };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../domains/locations/location.service', () => ({ LocationService: class { getLocationById() { return Promise.resolve(state.location); } } }));
vi.mock('../domains/applications/chef-application.service', () => ({ chefApplicationService: { getApplicationById: () => null } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: (id: number) => `Participant ${id}` }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now', increment: (n: number) => n, delete: () => 'delete' } }));
vi.mock('../chat-service', () => {
  const doc = (collection: string, id: string): any => ({ id, get: async () => collection === 'chatRelationships'
    ? { exists: id in state.mappings, data: () => ({ conversationId: state.mappings[id] }) }
    : { id, exists: id in state.docs, data: () => state.docs[id] } });
  const firestore = { collection: (name: string) => ({ doc: (id: string) => doc(name, id),
    where: (field: string, _op: string, value: any) => ({ get: async () => ({ docs: Object.entries(state.docs)
      .filter(([, data]) => data[field] === value).map(([id, data]) => ({ id, data: () => data })) }) }) }) };
  const initializeSharedConversation = async (chefId: number, locationId: number) => {
    if (state.provisionFails) return null;
    const key = `chef-${chefId}-location-${locationId}`;
    if (!(key in state.mappings)) {
      const oldest = Object.entries(state.docs).filter(([, d]) => d.chefId === chefId && d.locationId === locationId)
        .sort(([, a], [, b]) => a.createdAt - b.createdAt)[0];
      if (!oldest) return null;
      state.mappings[key] = oldest[0];
    }
    return state.mappings[key];
  };
  return { getAdminDb: async () => firestore, initializeSharedConversation, initializeConversation: vi.fn(),
    sendSystemNotification: vi.fn(), notifyTierTransition: vi.fn() };
});
vi.mock('../services/shared-chat-access', async importOriginal => ({ ...await importOriginal<any>(),
  sharedChatEligibility: async () => ({ applications: [], viewingIds: [20] }), participantChatRelationships: async () => state.pairs }));
import { kitchenApplicationsRouter as router } from './firebase/kitchen-applications';
import { withParticipantChat } from '../services/participant-chat';
const chef = { id: 3, role: 'chef', firebaseUid: 'chef-uid' }, manager = { id: 2, role: 'manager', firebaseUid: 'manager-uid' };
async function list(actor: any = manager) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await (router as any).stack.find((e: any) => e.route?.path === '/firebase/chat/conversations').route.stack.at(-1)
    .handle({ neonUser: actor, firebaseUser: { uid: actor.firebaseUid } }, response);
  return response;
}
const thread = (createdAt: number, extra = {}) => ({ chefId: 3, locationId: 5, managerId: 2, createdAt, unreadManagerCount: 4, archivedManagerAt: 'kept', ...extra });
beforeEach(() => {
  state.users = [chef, manager]; state.mappings = {}; state.pairs = [{ chefId: 3, locationId: 5 }]; state.provisionFails = false;
  state.docs = { legacy: thread(1) };
});
describe('connected inbox discovery and C1 repair', () => {
  it('adopts an unmapped eligible legacy thread through C1 and lists it with original unread/archive state', async () => {
    const response = await list();
    expect(response.status).not.toHaveBeenCalled();
    expect(state.mappings['chef-3-location-5']).toBe('legacy');
    expect(response.json).toHaveBeenCalledWith({ conversations: [expect.objectContaining({ conversationId: 'legacy',
      conversation: expect.objectContaining({ unreadManagerCount: 4, archivedManagerAt: 'kept', unavailable: false }) })] });
  });
  it('lists only the canonical thread beside a retained live duplicate and denies direct duplicate access', async () => {
    state.docs.duplicate = thread(0, { unreadManagerCount: 9 }); state.mappings['chef-3-location-5'] = 'legacy';
    const response = await list();
    const rows = response.json.mock.calls[0][0].conversations;
    expect(rows.map((row: any) => row.conversationId)).toEqual(['legacy']);
    await expect(withParticipantChat(manager, 'manager-uid', 'duplicate', vi.fn())).rejects.toThrow('repair this conversation');
  });
  it('reports a recoverable error for a poisoned canonical mapping or failed provisioning', async () => {
    state.mappings['chef-3-location-5'] = 'missing-doc';
    expect((await list()).status).toHaveBeenCalledWith(409);
    state.mappings = {}; state.provisionFails = true;
    expect((await list()).status).toHaveBeenCalledWith(409);
  });
  it('keeps deleted-counterpart history read-only and blocks ambiguous unmapped survivors', async () => {
    state.users = [manager]; state.pairs = [];
    expect((await list()).json.mock.calls[0][0].conversations).toEqual([expect.objectContaining({ conversationId: 'legacy',
      conversation: expect.objectContaining({ unavailable: true }) })]);
    state.docs.other = thread(2);
    expect((await list()).status).toHaveBeenCalledWith(409);
    state.mappings['chef-3-location-5'] = 'legacy';
    expect((await list()).json.mock.calls[0][0].conversations.map((row: any) => row.conversationId)).toEqual(['legacy']);
  });
});
