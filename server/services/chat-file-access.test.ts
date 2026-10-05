import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ receipt: null as any }));
vi.mock('../chat-service', () => ({ getAdminDb: async () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: !!state.receipt, data: () => state.receipt }) }) }) }) }));
vi.mock('../db', () => ({ db: { select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain, innerJoin: () => chain, then: (resolve: any) => resolve([]) }; return chain;
} } }));
import { authorizeChatAttachment, storedFileUrl } from './chat-file-access';
import { canReadPrivateFile } from './private-file-access';
const actor = { id: 3, role: 'chef', firebaseUid: 'actual' }, url = '/api/files/chat-attachments/00000000-0000-0000-0000-000000000000';
beforeEach(() => { state.receipt = null; });
describe('scoped attachments', () => {
  it('allows the actual uploader receipt only in its owning conversation', async () => {
    state.receipt = { conversationId: 'original', uploaderId: 3 };
    await expect(authorizeChatAttachment(actor, 'original', {}, [], url)).resolves.toBeUndefined();
    await expect(authorizeChatAttachment(actor, 'foreign', {}, [], url)).rejects.toThrow('Upload a chat attachment');
    await expect(authorizeChatAttachment({ ...actor, id: 4 }, 'original', {}, [], url)).rejects.toThrow('Upload a chat attachment');
  });
  it('does not turn tour-only access into arbitrary private/application file access', async () => {
    const privateUrl = 'https://files.localcooks.ca/documents/99_file_1_private.pdf';
    await expect(authorizeChatAttachment(actor, 'original', {}, [], privateUrl)).rejects.toThrow('permitted application');
    expect(await canReadPrivateFile(actor, privateUrl)).toBe(false);
    expect(await canReadPrivateFile({ id: 2, role: 'manager', firebaseUid: 'manager' }, privateUrl)).toBe(false);
    expect(await canReadPrivateFile(actor, url)).toBe(false);
  });
  it('rejects foreign hosts, traversal and caller-selected signing endpoints', () => {
    for (const value of ['https://attacker.test/private.pdf', '/api/files/documents/../private.pdf', '/api/files/r2-presigned?url=anything'])
      expect(storedFileUrl(value)).toBe(false);
  });
});
