import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ applications: [] as any[], tours: [] as any[], uids: true,
  docs: {} as Record<string, any>, sets: [] as any[], updates: [] as any[], tail: Promise.resolve() }));
vi.mock('./firebase-setup', () => ({ initializeFirebaseAdmin: () => ({}) }));
vi.mock('firebase-admin/firestore', () => {
  const doc = (collection: string, id: string): any => ({ id,
    get: async () => ({ id, exists: !!state.docs[`${collection}/${id}`], data: () => state.docs[`${collection}/${id}`], ref: doc(collection, id) }),
    set: (values: any) => { state.sets.push({ collection, id, values }); state.docs[`${collection}/${id}`] = { ...state.docs[`${collection}/${id}`], ...values }; } });
  return { FieldValue: { serverTimestamp: () => 'server-time' }, getFirestore: () => ({ settings: vi.fn(),
    collection: (collection: string) => ({ doc: (id: string) => doc(collection, id), where: (_field: string, _op: string, value: number) => ({
      get: async () => ({ docs: Object.keys(state.docs).filter(key => key.startsWith('conversations/') && state.docs[key].applicationId === value)
        .map(key => ({ id: key.split('/')[1] })) }) }) }),
    // Serialized mock transactions model mapping selection, not Firestore contention/retry guarantees.
    runTransaction: (run: any) => { const result = state.tail.then(() => run({ get: (ref: any) => ref.get(), set: (ref: any, values: any) => ref.set(values) }));
      state.tail = result.catch(() => {}); return result; },
  }) };
});
vi.mock('./db', () => ({ db: { select: () => {
  let table: any; const chain: any = { from: (value: any) => { table = value; return chain; }, where: () => chain, limit: () => chain,
    then: (resolve: any) => Promise.resolve(table[Symbol.for('drizzle:Name')] === 'locations' ? [{ id: 5, managerId: 2 }] :
      table[Symbol.for('drizzle:Name')] === 'users' ? [{ id: 3, firebaseUid: state.uids ? 'actual-chef' : null }, { id: 2, firebaseUid: 'actual-manager' }] :
      table[Symbol.for('drizzle:Name')] === 'kitchen_viewings' ? state.tours : state.applications).then(resolve) }; return chain;
}, update: () => ({ set: (values: any) => ({ where: async () => state.updates.push(values) }) }) } }));
import { initializeConversation, initializeSharedConversation } from './chat-service';
import { tourGrantsChat } from './services/shared-chat-access';
const app = { id: 8, chefId: 3, locationId: 5, status: 'approved', chat_conversation_id: 'original-history' };
const key = 'chef-3-location-5';
beforeEach(() => { state.applications = [{ ...app }]; state.tours = []; state.uids = true; state.tail = Promise.resolve();
  state.docs = { 'conversations/arbitrary-duplicate': { applicationId: 8 }, 'conversations/original-history': { applicationId: 8, unreadChefCount: 7, archivedByChef: true } };
  state.sets = []; state.updates = []; });
describe('shared server identity and application compatibility', () => {
  it('retains recorded history/unread/archive while healing real current participants', async () => {
    expect(await initializeConversation(app)).toBe('original-history');
    expect(state.docs['conversations/original-history']).toMatchObject({ chefFirebaseUid: 'actual-chef', managerFirebaseUid: 'actual-manager', unreadChefCount: 7, archivedByChef: true });
    expect(state.docs['conversations/arbitrary-duplicate']).toEqual({ applicationId: 8 });
  });
  it('allocates one stable relationship across concurrent opens and a later application', async () => {
    state.applications = []; state.docs = {}; state.tours = [{ id: 20, status: 'pending', adminReviewDecision: 'approved' }];
    expect(await Promise.all([initializeSharedConversation(3, 5), initializeSharedConversation(3, 5)])).toEqual([key, key]);
    expect(state.docs[`conversations/${key}`].applicationId).toBeUndefined();
    state.docs[`conversations/${key}`].unreadChefCount = 2;
    state.applications = [{ ...app, chat_conversation_id: null }];
    expect(await initializeConversation(app)).toBe(key);
    expect(state.docs[`conversations/${key}`]).toMatchObject({ unreadChefCount: 2, applicationId: 8, linkedApplicationIds: [8] });
    expect(state.updates.at(-1)).toEqual({ chat_conversation_id: key });
  });
  it('never adopts or heals a foreign stored pointer', async () => {
    state.docs = { 'conversations/original-history': { applicationId: 8, chefId: 99, locationId: 6 } };
    expect(await initializeConversation(app)).toBe(key);
    expect(state.docs['conversations/original-history']).toEqual({ applicationId: 8, chefId: 99, locationId: 6 });
  });
  it('fails closed for a poisoned mapping instead of replacing history', async () => {
    state.docs[`chatRelationships/${key}`] = { chefId: 3, locationId: 5, conversationId: 'foreign' };
    state.docs['conversations/foreign'] = { chefId: 99, locationId: 6 };
    expect(await initializeConversation(app)).toBeNull(); expect(state.sets).toEqual([]);
  });
  it('does not provision with a missing real participant UID or unapproved/forged application', async () => {
    state.uids = false; expect(await initializeConversation(app)).toBeNull();
    state.uids = true; expect(await initializeConversation({ ...app, chefId: 99 })).toBeNull();
    state.applications[0].status = 'pending'; expect(await initializeConversation(app)).toBeNull(); expect(state.sets).toEqual([]);
  });
  it.each(['pending_local_cooks', 'pending', 'cancelled'])('rejects unapproved %s tours without confirmation evidence', async status => {
    state.applications = []; state.tours = [{ id: 20, status, adminReviewDecision: null }];
    expect(await initializeSharedConversation(3, 5)).toBeNull(); expect(state.sets).toEqual([]);
  });
  it.each(['pending', 'confirmed', 'completed', 'cancelled', 'no_show'])('retains approved %s tour-only access', async status => {
    state.applications = []; state.docs = {}; state.tours = [{ id: 20, status, adminReviewDecision: 'approved' }];
    expect(await initializeSharedConversation(3, 5)).toBe(key);
  });
  it('uses explicit legacy confirmation evidence and never a denied tour', () => {
    expect(tourGrantsChat({ status: 'confirmed', adminReviewDecision: null })).toBe(true);
    expect(tourGrantsChat({ status: 'cancelled', adminReviewDecision: null, outcomeHistory: [{ from: 'confirmed' }] })).toBe(true);
    expect(tourGrantsChat({ status: 'confirmed', adminReviewDecision: 'denied' })).toBe(false);
  });
});
