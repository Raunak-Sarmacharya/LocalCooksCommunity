import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ location: { id: 5, managerId: 2 } as any, users: [] as any[], apps: [] as any[], tours: [] as any[], booking: [] as any[],
  conversation: {} as any, mapping: 'history', historicalIds: ['history'], messages: {} as Record<string, any>, writes: [] as any[], locks: [] as any[], inTransaction: false, activeTransactions: 0, nextId: 0, firestoreTail: Promise.resolve(), localEmail: vi.fn(), logError: vi.fn() }));
vi.mock('./local-chat-emails', () => ({ queueLocalChatMessageEmail: state.localEmail }));
vi.mock('../logger', () => ({ logger: { error: state.logError } }));
afterEach(() => vi.unstubAllEnvs());
vi.mock('../db', () => {
  const database: any = { transaction: async (action: any) => { state.activeTransactions++; state.inTransaction = true; try { return await action(database); } finally { state.inTransaction = --state.activeTransactions > 0; } },
    select: () => {
      let table: string;
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
        where: () => chain, innerJoin: () => chain, limit: () => chain,
        for: (kind: string) => { state.locks.push([table, kind]); return chain; },
        then: (resolve: any) => resolve(table === 'locations' ? [state.location] : table === 'users' ? state.users : table === 'chef_kitchen_applications' ? state.apps.filter(app => app.status === 'approved') : table === 'kitchen_viewings' ? state.tours : state.booking) };
      return chain;
    } };
  return { db: database };
});
vi.mock('../chat-service', () => ({ getAdminDb: async () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => ({ doc: (id?: string) => ref(path + '/' + name + '/' + (id || (state.nextId++ ? `new-message-${state.nextId}` : 'new-message'))) }),
    get: async () => ({ exists: path.startsWith('chatRelationships') ? !!state.mapping : true, ref: ref(path), data: () => path.startsWith('chatRelationships') ? { conversationId: state.mapping } : path.includes('/messages/') ? state.messages[path.split('/').at(-1)!] : state.conversation }) });
  const write = (kind: string, target: any, data: any) => { expect(state.inTransaction).toBe(true); state.writes.push({ kind, path: target.path, data }); };
  return { collection: (name: string) => ({ doc: (id: string) => ref(name + '/' + id), where: () => ({ get: async () => ({ docs: state.historicalIds.map(id => ({ id, data: () => state.conversation })) }) }) }),
    batch: () => ({ set: (target: any, data: any) => write('message', target, data), update: (target: any, data: any) => write('badge', target, data), commit: async () => {} }),
    runTransaction: async (action: any) => {
      // Model Firestore's serializable document transaction commits.
      const run = state.firestoreTail.then(() => action({ get: (target: any) => target.get(),
      set: (target: any, data: any) => { write('message', target, data); state.messages[target.id] = data; },
      update: (target: any, data: any) => {
        write(data.lastMessageAt ? 'badge' : 'read', target, data);
        const saved = target.path.includes('/messages/') ? state.messages[target.id] : state.conversation;
        for (const [key, value] of Object.entries(data)) {
          if (value === 'delete') delete saved[key];
          else saved[key] = typeof value === 'object' && value && 'increment' in value ? (saved[key] || 0) + (value as any).increment : value;
        }
      } })); state.firestoreTail = run.then(() => undefined, () => undefined); return run;
    } };
} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now', increment: (value: number) => ({ increment: value }), delete: () => 'delete' } }));
import { withParticipantChat, sendParticipantMessage, persistChatMessage, readParticipantMessages, orphanChatHistory } from './participant-chat';
const chef = { id: 3, role: 'chef', firebaseUid: 'chef-uid' }, manager = { id: 2, role: 'manager', firebaseUid: 'manager-uid' };
beforeEach(() => {
  vi.clearAllMocks(); state.localEmail.mockImplementation(async () => { expect(state.inTransaction).toBe(false); });
  state.users = [chef, manager]; state.location = { id: 5, managerId: 2 }; state.apps = [];
  state.tours = [{ status: 'pending', adminReviewDecision: 'approved' }];
  state.conversation = { chefId: 3, locationId: 5, managerId: 2, unreadChefCount: 3 };
  state.mapping = 'history'; state.historicalIds = ['history']; state.writes = []; state.locks = []; state.booking = [];
  state.nextId = 0; state.activeTransactions = 0; state.firestoreTail = Promise.resolve();
  state.messages = { one: { senderRole: 'manager', readAt: null }, two: { senderRole: 'admin', readAt: null }, own: { senderRole: 'chef', readAt: null } };
});
describe('server-mediated participant chat', () => {
  it.each([chef, manager])('queues local email only after the $role message and authorization transaction commit', async actor => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', '');
    const sent = await sendParticipantMessage(actor, actor.firebaseUid, 'history', { content: 'hello', type: 'text' });
    expect(state.localEmail).toHaveBeenCalledWith('history', sent.id, actor.id);
    expect(state.messages[sent.id].content).toBe('hello');
  });
  it('keeps a saved message successful if local email setup fails, without asking the chef to resend', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', '');
    state.localEmail.mockRejectedValueOnce(Error('Queue unavailable'));
    expect(await sendParticipantMessage(chef, chef.firebaseUid, 'history', { content: 'hello', type: 'text' })).toEqual({ id: 'new-message' });
    expect(state.logError).toHaveBeenCalled();
    expect(state.writes.filter(write => write.kind === 'message')).toHaveLength(1);
  });
  it.each([['production', ''], ['development', '1'], ['test', '']])('does not start local delivery in %s with Vercel=%s', async (environment, vercel) => {
    vi.stubEnv('NODE_ENV', environment); vi.stubEnv('VERCEL', vercel);
    await sendParticipantMessage(chef, chef.firebaseUid, 'history', { content: 'hello', type: 'text' });
    expect(state.localEmail).not.toHaveBeenCalled();
  });
  it('gives simultaneous sends one starting message and an exact unread count under serializable commits', async () => {
    const sent = await Promise.all(Array.from({ length: 5 }, () => sendParticipantMessage(chef, chef.firebaseUid, 'history', { content: 'hello', type: 'text' })));
    const episodes = new Set(sent.map(({ id }) => state.messages[id].emailEpisodeId));
    expect(episodes.size).toBe(1); expect(sent.filter(({ id }) => state.messages[id].emailEpisodeId === id)).toHaveLength(1);
    expect(state.conversation.unreadManagerCount).toBe(5);
  });
  it.each([['chef', chef, manager], ['manager', manager, chef]] as const)('starts one %s email episode, keeps consecutive sends together, and rearms on reply', async (role, sender, recipient) => {
    const send = (actor: typeof chef) => sendParticipantMessage(actor, actor.firebaseUid, 'history', { content: 'hello', type: 'text' });
    const first = await send(sender), second = await send(sender);
    expect(state.messages[first.id]).toMatchObject({ emailEpisodeId: first.id, emailRecipientId: recipient.id });
    expect(state.messages[second.id].emailEpisodeId).toBe(first.id);
    await send(recipient);
    const next = await send(sender);
    expect(state.messages[next.id].emailEpisodeId).toBe(next.id);
    const ownField = role === 'chef' ? 'emailChefEpisode' : 'emailManagerEpisode';
    expect(state.conversation[ownField]).toBeUndefined();
  });
  it('keeps an episode after a partial read and rearms after the last incoming message is read', async () => {
    const send = () => sendParticipantMessage(chef, chef.firebaseUid, 'history', { content: 'hello', type: 'text' });
    const first = await send(), second = await send();
    await readParticipantMessages(manager, manager.firebaseUid, 'history', [first.id]);
    expect(state.conversation.emailManagerEpisode.id).toBe(first.id);
    await readParticipantMessages(manager, manager.firebaseUid, 'history', [second.id]);
    expect(state.conversation.emailManagerEpisode).toBeUndefined();
    const next = await send(); expect(state.messages[next.id].emailEpisodeId).toBe(next.id);
  });
  it('creates a fresh recipient episode after reassignment rather than keeping the former manager marker', async () => {
    state.conversation.emailManagerEpisode = { id: 'old', recipientId: 2 };
    state.location.managerId = 4; state.users.push({ id: 4, role: 'manager', firebaseUid: 'replacement' });
    const sent = await sendParticipantMessage(chef, chef.firebaseUid, 'history', { content: 'hello', type: 'text' });
    expect(state.messages[sent.id]).toMatchObject({ emailEpisodeId: sent.id, emailRecipientId: 4 });
  });
  it('keeps Local Cooks replies in the chef recipient episode without acknowledging the manager', async () => {
    const first = await sendParticipantMessage(manager, manager.firebaseUid, 'history', { content: 'hello', type: 'text' });
    state.conversation.emailManagerEpisode = { id: 'chef-first', recipientId: 2 };
    await withParticipantChat(manager, manager.firebaseUid, 'history', async ({ firestore, ref }) => {
      const sent = await persistChatMessage(firestore, ref, { senderId: 1, senderRole: 'admin', senderFirebaseUid: 'admin-uid',
        content: 'support reply', type: 'text', fileUrl: null, fileName: null }, 3);
      expect(state.messages[sent.id].emailEpisodeId).toBe(first.id);
    });
    expect(state.conversation.emailManagerEpisode.id).toBe('chef-first');
  });
  it('sends a tour-only chef message with trusted identity and coupled badge/archive changes', async () => {
    expect(await sendParticipantMessage(chef, 'chef-uid', 'history', { content: ' hello ', type: 'text' })).toEqual({ id: 'new-message' });
    expect(state.writes).toEqual([
      expect.objectContaining({ kind: 'message', data: expect.objectContaining({ senderId: 3, senderRole: 'chef', senderFirebaseUid: 'chef-uid', content: 'hello', readAt: null }) }),
      expect.objectContaining({ kind: 'badge', data: expect.objectContaining({ unreadManagerCount: { increment: 1 }, archivedManagerAt: 'delete' }) }),
    ]);
    expect(state.locks).toEqual([['locations', 'share'], ['users', 'share'], ['chef_kitchen_applications', 'share'], ['kitchen_viewings', 'share']]);
  });
  it('revokes a former manager on the next read/send even with stale conversation metadata', async () => {
    state.location.managerId = 4; state.users.push({ id: 4, role: 'manager', firebaseUid: 'replacement' });
    const action = vi.fn();
    await expect(withParticipantChat(manager, 'manager-uid', 'history', action)).rejects.toThrow('unavailable');
    await expect(sendParticipantMessage(manager, 'manager-uid', 'history', { content: 'forbidden', type: 'text' })).rejects.toThrow('unavailable');
    expect(action).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
    expect(await sendParticipantMessage(state.users[2], 'replacement', 'history', { content: 'current', type: 'text' })).toEqual({ id: 'new-message' });
    expect(state.writes[0].data.senderId).toBe(4);
  });
  it.each(['senderId', 'senderRole', 'chefId', 'managerId', 'applicationId', 'readAt', 'createdAt'])('rejects client %s overrides', async key => {
    await expect(sendParticipantMessage(chef, 'chef-uid', 'history', { content: 'x', type: 'text', [key]: 'forged' })).rejects.toThrow('Invalid message');
    expect(state.writes).toEqual([]);
  });
  it('denies wrong UID, wrong role, foreign history and unsafe IDs', async () => {
    for (const [actor, uid, id] of [[chef, 'old-uid', 'history'], [{ ...chef, role: 'manager' }, 'chef-uid', 'history'], [chef, 'chef-uid', 'foreign']]) {
      if (id === 'foreign') state.mapping = 'history-original';
      await expect(withParticipantChat(actor as any, uid as string, id as string, async () => true)).rejects.toThrow();
    }
    await expect(withParticipantChat(chef, 'chef-uid', 'bad/id', async () => true)).rejects.toThrow('Invalid conversation');
  });
  it('marks only visible incoming messages; own sent messages and racing arrivals keep their state', async () => {
    await readParticipantMessages(chef, 'chef-uid', 'history', ['one', 'two', 'own']);
    expect(state.writes.map(write => write.path)).toEqual(['conversations/history/messages/one', 'conversations/history/messages/two', 'conversations/history']);
    expect(state.writes[2].data).toEqual({ unreadChefCount: 1 });
  });
  it('retains deleted-participant history but refuses a new send', async () => {
    state.users = [manager];
    expect(await withParticipantChat(manager, 'manager-uid', 'history', async context => context.live)).toBe(false);
    await expect(sendParticipantMessage(manager, 'manager-uid', 'history', { content: 'x', type: 'text' })).rejects.toThrow('no longer available');
    expect(state.writes).toEqual([]);
  });
  it('preserves a sole orphan history but refuses to guess among unmapped legacy duplicates', async () => {
    state.users = [manager]; state.mapping = '';
    expect(await withParticipantChat(manager, 'manager-uid', 'history', async context => context.live)).toBe(false);
    state.historicalIds.push('duplicate');
    await expect(withParticipantChat(manager, 'manager-uid', 'history', async () => true)).rejects.toThrow('Multiple historical threads');
  });
  it('rejects foreign booking context even for a real participant', async () => {
    state.apps = [{ id: 8, status: 'approved' }]; state.booking = [{ chefId: 99, locationId: 5 }];
    await expect(sendParticipantMessage(chef, 'chef-uid', 'history', { content: 'x', type: 'text', bookingId: 10 })).rejects.toThrow('Booking context');
    expect(state.writes).toEqual([]);
  });
  it.each(['rejected', 'cancelled'])('denies all operation callbacks after the last application is %s without a qualifying tour', async status => {
    state.apps = [{ id: 8, status }]; state.tours = [];
    for (const operation of ['metadata', 'messages', 'archive', 'upload', 'download']) {
      const action = vi.fn();
      await expect(withParticipantChat(chef, 'chef-uid', 'history', action)).rejects.toThrow('qualifying tour');
      expect(action, operation).not.toHaveBeenCalled();
    }
    await expect(sendParticipantMessage(manager, 'manager-uid', 'history', { content: 'x', type: 'text' })).rejects.toThrow('qualifying tour');
    await expect(readParticipantMessages(chef, 'chef-uid', 'history', ['one'])).rejects.toThrow('qualifying tour');
    expect(state.writes).toEqual([]);
  });
  it.each([
    { status: 'pending_local_cooks', adminReviewDecision: null },
    { status: 'cancelled', adminReviewDecision: 'denied', outcomeHistory: [{ from: 'confirmed' }] },
    { status: 'completed', adminReviewDecision: null },
  ])('excludes ungranted tours $status/$adminReviewDecision despite a canonical mapping', async tour => {
    state.tours = [tour];
    await expect(withParticipantChat(manager, 'manager-uid', 'history', vi.fn())).rejects.toThrow('qualifying tour');
  });
  it.each([
    { status: 'completed', adminReviewDecision: 'approved' },
    { status: 'cancelled', adminReviewDecision: 'approved' },
    { status: 'no_show', adminReviewDecision: 'approved' },
    { status: 'confirmed', adminReviewDecision: null },
    { status: 'cancelled', adminReviewDecision: null, outcomeHistory: [{ from: 'confirmed', to: 'cancelled' }] },
  ])('retains terminal approved/explicit legacy tour access $status/$adminReviewDecision', async tour => {
    state.tours = [tour];
    expect(await withParticipantChat(chef, 'chef-uid', 'history', async context => context.live)).toBe(true);
  });
  it('accepts another independently approved application or tour after the original source loses approval', async () => {
    state.apps = [{ id: 8, status: 'rejected' }, { id: 9, status: 'approved' }]; state.tours = [];
    expect(await withParticipantChat(chef, 'chef-uid', 'history', async context => context.applicationIds)).toEqual([9]);
    state.apps = [{ id: 8, status: 'cancelled' }];
    state.tours = [{ status: 'cancelled', adminReviewDecision: 'denied' }, { status: 'pending', adminReviewDecision: 'approved' }];
    expect(await sendParticipantMessage(chef, 'chef-uid', 'history', { content: 'still eligible', type: 'text' })).toEqual({ id: 'new-message' });
  });
  it('omits live ineligible discovery rows but retains deleted-counterpart history without qualifying sources', async () => {
    state.tours = []; state.apps = [];
    expect(await orphanChatHistory(manager, 'manager-uid')).toEqual([]);
    state.users = [manager];
    expect(await orphanChatHistory(manager, 'manager-uid')).toEqual([expect.objectContaining({ conversationId: 'history', conversation: expect.objectContaining({ unavailable: true }) })]);
    await expect(sendParticipantMessage(manager, 'manager-uid', 'history', { content: 'x', type: 'text' })).rejects.toThrow('no longer available');
    state.mapping = ''; state.historicalIds.push('duplicate');
    await expect(orphanChatHistory(manager, 'manager-uid')).rejects.toThrow('Multiple historical threads');
  });
  it('leaves live threads to the C1 resolver: unmapped/duplicate live rows do not fail discovery, direct duplicate access stays denied', async () => {
    state.tours = []; state.mapping = '';
    expect(await orphanChatHistory(manager, 'manager-uid')).toEqual([]);
    state.tours = [{ status: 'pending', adminReviewDecision: 'approved' }];
    expect(await orphanChatHistory(manager, 'manager-uid')).toEqual([]);
    state.mapping = 'canonical';
    expect(await orphanChatHistory(manager, 'manager-uid')).toEqual([]);
    await expect(withParticipantChat(manager, 'manager-uid', 'history', vi.fn())).rejects.toThrow('repair this conversation');
  });
  it('ignores a retained deleted-counterpart duplicate when its mapped canonical exists', async () => {
    state.users = [manager]; state.mapping = 'canonical';
    expect(await orphanChatHistory(manager, 'manager-uid')).toEqual([]);
  });
});
