import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ location: { id: 5, managerId: 2 } as any, users: [] as any[], apps: [] as any[], tours: [] as any[], booking: [] as any[],
  conversation: {} as any, mapping: 'history', historicalIds: ['history'], messages: {} as Record<string, any>, writes: [] as any[], locks: [] as any[], inTransaction: false }));
vi.mock('../db', () => {
  const database: any = { transaction: async (action: any) => { state.inTransaction = true; try { return await action(database); } finally { state.inTransaction = false; } },
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
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => ({ doc: (id = 'new-message') => ref(path + '/' + name + '/' + id) }),
    get: async () => ({ exists: path.startsWith('chatRelationships') ? !!state.mapping : true, ref: ref(path), data: () => path.startsWith('chatRelationships') ? { conversationId: state.mapping } : path.includes('/messages/') ? state.messages[path.split('/').at(-1)!] : state.conversation }) });
  const write = (kind: string, target: any, data: any) => { expect(state.inTransaction).toBe(true); state.writes.push({ kind, path: target.path, data }); };
  return { collection: (name: string) => ({ doc: (id: string) => ref(name + '/' + id), where: () => ({ get: async () => ({ docs: state.historicalIds.map(id => ({ id, data: () => state.conversation })) }) }) }),
    batch: () => ({ set: (target: any, data: any) => write('message', target, data), update: (target: any, data: any) => write('badge', target, data), commit: async () => {} }),
    runTransaction: async (action: any) => action({ get: (target: any) => target.get(), update: (target: any, data: any) => write('read', target, data) }) };
} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'now', increment: (value: number) => ({ increment: value }), delete: () => 'delete' } }));
import { withParticipantChat, sendParticipantMessage, readParticipantMessages, orphanChatHistory } from './participant-chat';
const chef = { id: 3, role: 'chef', firebaseUid: 'chef-uid' }, manager = { id: 2, role: 'manager', firebaseUid: 'manager-uid' };
beforeEach(() => {
  state.users = [chef, manager]; state.location = { id: 5, managerId: 2 }; state.apps = [];
  state.tours = [{ status: 'pending', adminReviewDecision: 'approved' }];
  state.conversation = { chefId: 3, locationId: 5, managerId: 2, unreadChefCount: 3 };
  state.mapping = 'history'; state.historicalIds = ['history']; state.writes = []; state.locks = []; state.booking = [];
  state.messages = { one: { senderRole: 'manager', readAt: null }, two: { senderRole: 'admin', readAt: null }, own: { senderRole: 'chef', readAt: null } };
});
describe('server-mediated participant chat', () => {
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
