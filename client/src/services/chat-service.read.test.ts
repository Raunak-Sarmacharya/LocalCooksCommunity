import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { uid: 'actual-chef', getIdToken: async () => 'test-token' } } }));
import { markAsRead, sendMessage, getUnreadCount, getAllConversations, createConversation } from './chat-service';
const request = vi.fn();
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
const ok = (data: any) => ({ ok: true, json: async () => data });
describe('server participant protocol', () => {
  it('acknowledges shared admin messages for managers while keeping legacy admin messages chef-only', async () => {
    request.mockResolvedValue(ok({ ok: true }));
    await markAsRead('thread', 2, 'manager', [
      { id: 'shared', senderRole: 'admin', adminAudience: 'both' }, { id: 'legacy', senderRole: 'admin' },
      { id: 'chef', senderRole: 'chef' }, { id: 'read', senderRole: 'admin', adminAudience: 'both', readAt: new Date() }
    ] as any);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ messageIds: ['shared', 'chef'] });
  });
  it('keeps two tour-only locations distinct with authoritative labels and original timestamp/archive values', async () => {
    request.mockResolvedValue(ok({ conversations: [1, 2].map(locationId => ({ conversationId: 'original-' + locationId,
      chefId: 3, managerId: 2, locationId, chefName: 'Ada Chef', managerName: 'Real Manager', locationName: 'Kitchen ' + locationId,
      linkedApplicationIds: [], eligibleViewingIds: [20], conversation: { unreadChefCount: 2, unreadManagerCount: 0,
        createdAt: '2026-10-01T00:00:00Z', lastMessageAt: '2026-10-02T00:00:00Z', archivedChefAt: '2026-10-02T00:00:00Z' } })) }));
    const rows = await getAllConversations(3, 'chef');
    expect(rows.map(row => row.id)).toEqual(['original-1', 'original-2']);
    expect(rows[0]).toMatchObject({ applicationId: undefined, chefName: 'Ada Chef', managerName: 'Real Manager', archivedChefAt: new Date('2026-10-02T00:00:00Z') });
    expect(await getUnreadCount(3, 'chef')).toBe(4);
  });
  it('reports list/provisioning errors instead of returning an empty inbox or badge', async () => {
    request.mockResolvedValue({ ok: false, json: async () => ({ error: 'Messaging needs retry' }) });
    await expect(getAllConversations(3, 'chef')).rejects.toThrow('needs retry');
    await expect(getUnreadCount(3, 'chef')).rejects.toThrow('needs retry');
  });
  it('retains shared history when application context arrives', async () => {
    request.mockResolvedValue(ok({ id: 'original-history', applicationId: 8 }));
    expect(await createConversation(8, 99, 98, 97)).toBe('original-history');
    expect(request.mock.calls[0][0]).toBe('/api/firebase/chat/applications/8/conversation');
  });
  it('sends only body/context, with identity established on the server', async () => {
    request.mockResolvedValue(ok({ id: 'persisted-message' }));
    expect(await sendMessage('thread', 999, 'manager', 'Kitchen coordination', 'text', undefined, undefined, 10)).toBe('persisted-message');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ content: 'Kitchen coordination', type: 'text', bookingId: 10 });
  });
  it('acknowledges only visible incoming IDs and never chooses the read role for the server', async () => {
    request.mockResolvedValue(ok({ ok: true }));
    await markAsRead('thread', 3, 'chef', [{ id: 'one', senderRole: 'manager' }, { id: 'two', senderRole: 'admin' }, { id: 'own', senderRole: 'chef' }] as any);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ messageIds: ['one', 'two'] });
    request.mockClear(); await markAsRead('thread', 1, 'admin', [{ id: 'one', senderRole: 'manager' }] as any);
    expect(request).not.toHaveBeenCalled();
  });
});
