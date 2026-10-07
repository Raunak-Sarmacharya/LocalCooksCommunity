import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), conversation: {} as any, message: {} as any,
  mapping: undefined as any, person: {} as any, keys: new Set<string>(), firestore: vi.fn(), pools: [] as any[], fetch: vi.fn(), diagnostics: vi.fn() }));
vi.mock('../../functions/node_modules/firebase-admin', () => ({ initializeApp: vi.fn() }));
vi.mock('../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js', () => ({ getFirestore: state.firestore }));
state.firestore.mockImplementation(() => ({ collection: (name: string) => ({ doc: () => ({
  get: async () => ({ exists: name === 'chatRelationships' ? !!state.mapping : true, data: () => name === 'chatRelationships' ? state.mapping : state.conversation }),
  collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => state.message }) }) }),
}) }) }));
vi.mock('../../functions/node_modules/pg', () => ({ Pool: class {
  constructor(options: any) { state.pools.push(options); }
  connect = async () => ({ query: state.query, release: state.release });
} }));
import { onNewChatMessage } from '../../functions/src/index';
import * as staging from '../../functions/src/staging';
const fire = (authType = 'service_account', snapshot = state.message) => (onNewChatMessage as any).run({ data: { data: () => snapshot },
  params: { conversationId: 'thread', messageId: 'm1' }, authId: 'server-service-account', authType });
beforeEach(() => {
  vi.clearAllMocks(); state.keys.clear();
  vi.spyOn(console, 'info').mockImplementation(state.diagnostics);
  vi.stubEnv('INNGEST_EVENT_KEY', 'fixture-production-key'); vi.stubEnv('STAGING_INNGEST_EVENT_KEY', 'fixture-staging-key');
  vi.stubGlobal('fetch', state.fetch); state.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ status: 200, ids: ['event-id'] }) });
  state.conversation = { chefId: 3, managerId: 2, locationId: 5, chefFirebaseUid: 'actual-chef', managerFirebaseUid: 'actual-manager' };
  state.mapping = { chefId: 3, locationId: 5, conversationId: 'thread' };
  state.message = { senderId: 3, senderRole: 'chef', senderFirebaseUid: 'actual-chef', type: 'text', content: 'Tour coordination',
    createdAt: { toDate: () => new Date('2026-10-04T08:00:00Z') } };
  state.person = { chef_id: 3, manager_id: 2, location_id: 5, location_name: 'Harbour Kitchen', chef_role: 'chef', manager_role: 'manager',
    chef_uid: 'actual-chef', manager_uid: 'actual-manager', sender_uid: 'actual-chef', sender_role: 'chef', sender_profile: { displayName: 'Ada Chef' },
    chef_email: 'chef@example.test', manager_email: 'manager@example.test', apps_count: 0, tours: [{ status: 'completed', admin_review_decision: 'approved' }] };
  state.query.mockReset().mockImplementation(async (sql: string, values: any[] = []) => {
    if (sql.includes('FROM locations l')) return { rows: [state.person] };
    if (sql.startsWith('SELECT id FROM email_logs')) return { rows: state.keys.has(values[0]) ? [{ id: 1 }] : [] };
    if (sql.includes('INSERT INTO email_logs')) state.keys.add(values[6]);
    return { rows: [] };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const inserts = () => state.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
describe('actual service-account trigger wired to real canonical transactional producer', () => {
  it('diagnoses auth skips, committed outcomes and retry failures without exposing private values', async () => {
    await fire('unknown');
    let entries = state.diagnostics.mock.calls.map(([value]) => JSON.parse(value));
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'skipped', reason: 'untrusted-auth-type', authType: 'unknown', conversationId: 'thread', messageId: 'm1' }));
    expect(state.query).not.toHaveBeenCalled();
    Object.assign(state.message, { emailEpisodeId: 'm1', emailRecipientId: 2 });
    await fire();
    entries = state.diagnostics.mock.calls.map(([value]) => JSON.parse(value));
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'committed', result: 'queued', starting: true }));
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'published' }));
    const commitIndex = state.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    const logIndex = state.diagnostics.mock.calls.findIndex(([value]) => JSON.parse(value).stage === 'committed');
    expect(state.query.mock.invocationCallOrder[commitIndex]).toBeLessThan(state.diagnostics.mock.invocationCallOrder[logIndex]);
    const failure = Object.assign(Error('private content https://inn.gs/e/private-key actual-chef'), { code: 'ECONNRESET' });
    state.fetch.mockRejectedValueOnce(failure);
    await expect(fire()).rejects.toBe(failure);
    entries = state.diagnostics.mock.calls.map(([value]) => JSON.parse(value));
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'error', failedStage: 'publish-start', code: 'ECONNRESET' }));
    const output = JSON.stringify(entries);
    for (const privateValue of ['private content', 'private-key', 'actual-chef', 'actual-manager', 'Tour coordination', 'fixture-production-key'])
      expect(output).not.toContain(privateValue);
  });
  it('commits a starting-message alert/reminder before publishing an idempotent wakeup; consecutive messages stay quiet', async () => {
    Object.assign(state.message, { emailEpisodeId: 'm1', emailRecipientId: 2 });
    await fire(); await fire();
    expect(inserts()).toHaveLength(3); expect(state.fetch).toHaveBeenCalledTimes(2);
    const [url, request] = state.fetch.mock.calls[0];
    expect(url).toBe('https://inn.gs/e/fixture-production-key');
    expect(JSON.parse(request.body)).toEqual({ id: 'chat-start:thread:m1', name: 'localcooks/chat.message.start', data: { conversationId: 'thread', messageId: 'm1', senderId: 3 } });
    expect(state.query.mock.invocationCallOrder[state.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT')]).toBeLessThan(state.fetch.mock.invocationCallOrder[0]);
    state.message.emailEpisodeId = 'earlier-start'; state.keys.clear(); state.fetch.mockClear();
    await fire(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it('retries a rejected event after SQL commit without duplicating durable intents', async () => {
    Object.assign(state.message, { emailEpisodeId: 'm1', emailRecipientId: 2 });
    state.fetch.mockResolvedValueOnce({ ok: false });
    await expect(fire()).rejects.toThrow('not accepted');
    expect(state.release).toHaveBeenCalledTimes(1); expect(inserts()).toHaveLength(3);
    await fire(); expect(inserts()).toHaveLength(3); expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it('publishes independently retryable admin wakeups for both canonical recipients after committing', async () => {
    Object.assign(state.person, { sender_role: 'admin', sender_uid: 'actual-admin' });
    Object.assign(state.message, { senderId: 1, senderRole: 'admin', senderFirebaseUid: 'actual-admin', adminAudience: 'both',
      recipientStates: { chef: { recipientId: 3, episodeId: 'm1', readAt: null }, manager: { recipientId: 2, episodeId: 'm1', readAt: null } } });
    // A partial event publication retries using the same durable recipient keys.
    state.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 200, ids: ['event'] }) }).mockResolvedValueOnce({ ok: false });
    await expect(fire()).rejects.toThrow('not accepted');
    const count = inserts().length;
    await fire();
    expect(inserts()).toHaveLength(count);
    expect(state.fetch).toHaveBeenCalledTimes(4);
    const payloads = state.fetch.mock.calls.map(([, request]) => JSON.parse(request.body));
    expect(payloads.map(p => p.id)).toEqual(['chat-start:thread:m1:chef', 'chat-start:thread:m1:manager', 'chat-start:thread:m1:chef', 'chat-start:thread:m1:manager']);
    expect(payloads.map(p => p.data.recipientRole)).toEqual(['chef', 'manager', 'chef', 'manager']);
    expect(state.query.mock.invocationCallOrder[state.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT')]).toBeLessThan(state.fetch.mock.invocationCallOrder[0]);
  });
  it('publishes staging starts only with the staging event key', async () => {
    Object.assign(state.message, { emailEpisodeId: 'm1', emailRecipientId: 2 });
    vi.stubEnv('STAGING_DATABASE_URL', 'postgresql://fixture@staging.invalid/fixture');
    await (staging.onNewStagingChatMessage as any).run({ data: { data: () => state.message }, params: { conversationId: 'thread', messageId: 'm1' }, authType: 'service_account' });
    expect(state.fetch.mock.calls[0][0]).toBe('https://inn.gs/e/fixture-staging-key');
  });
  it.each(['firebase-adminsdk-fbsvc@formauth-9e620.iam.gserviceaccount.com', '104768754596329400480'])('accepts an unknown staging auth type only for its pinned server writer %s', async authId => {
    Object.assign(state.message, { emailEpisodeId: 'm1', emailRecipientId: 2 });
    await (staging.onNewStagingChatMessage as any).run({ data: { data: () => state.message }, params: { conversationId: 'thread', messageId: 'm1' }, authType: 'unknown', authId });
    expect(inserts()).toHaveLength(3);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe('https://inn.gs/e/fixture-staging-key');
    expect(JSON.stringify(state.diagnostics.mock.calls)).not.toContain(authId);
  });
  it.each([
    ['unknown', undefined], ['unknown', 'unrelated-service-account'], ['api_key', 'firebase-adminsdk-fbsvc@formauth-9e620.iam.gserviceaccount.com'],
    ['unauthenticated', '104768754596329400480'], ['system', '104768754596329400480'],
  ])('rejects staging auth type %s with an absent, foreign or inappropriate writer identity', async (authType, authId) => {
    await (staging.onNewStagingChatMessage as any).run({ data: { data: () => state.message }, params: { conversationId: 'thread', messageId: 'm1' }, authType, authId });
    expect(state.query).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('still validates SQL authorship for the pinned unknown staging writer', async () => {
    state.message.senderFirebaseUid = 'forged';
    await (staging.onNewStagingChatMessage as any).run({ data: { data: () => state.message }, params: { conversationId: 'thread', messageId: 'm1' }, authType: 'unknown', authId: '104768754596329400480' });
    expect(inserts()).toHaveLength(0);
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('exports only a staging trigger, pinned to staging Firestore and its separate SQL secret', async () => {
    expect(Object.keys(staging)).toEqual(['onNewStagingChatMessage']);
    const fn = staging.onNewStagingChatMessage as any;
    expect(fn.__endpoint.eventTrigger.eventFilters.database).toBe('staging');
    expect(fn.__endpoint.secretEnvironmentVariables).toEqual([{ key: 'STAGING_DATABASE_URL' }, { key: 'STAGING_INNGEST_EVENT_KEY' }]);
    expect(fn.__endpoint.serviceAccountEmail).toBe('localcooks-staging-chat@formauth-9e620.iam.gserviceaccount.com');
    const previous = process.env.STAGING_DATABASE_URL;
    process.env.STAGING_DATABASE_URL = 'postgresql://fixture@staging.invalid/fixture';
    try {
      await fn.run({ data: { data: () => state.message }, params: { conversationId: 'thread', messageId: 'm1' }, authType: 'service_account' });
      expect(state.firestore).toHaveBeenCalledWith(undefined, 'staging');
      expect(state.pools).toContainEqual(expect.objectContaining({ connectionString: process.env.STAGING_DATABASE_URL }));
      expect(inserts()).toHaveLength(2);
    } finally {
      if (previous === undefined) delete process.env.STAGING_DATABASE_URL;
      else process.env.STAGING_DATABASE_URL = previous;
    }
  });
  it('binds the SQL secret to the deployed message trigger', () => {
    expect((onNewChatMessage as any).__endpoint.secretEnvironmentVariables).toContainEqual({ key: 'DATABASE_URL' });
  });
  it('delivers C2 server-written tour-only chef message with persisted one-hour intent and deduplicates retry', async () => {
    await fire(); await fire();
    expect(inserts()).toHaveLength(2);
    expect(inserts()[0][1][0]).toBe(2);
    expect(JSON.parse(inserts()[1][1][7])).toMatchObject({ dueAt: '2026-10-04T09:00:00.000Z', path: '/manager/dashboard?view=messages&conversation=thread' });
    expect(state.query.mock.calls.map(([sql]) => sql).filter(sql => ['BEGIN', 'COMMIT'].includes(sql))).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  });
  it('delivers current manager after reassignment despite old stored manager fields', async () => {
    state.message = { ...state.message, senderId: 7, senderRole: 'manager', senderFirebaseUid: 'new-manager' };
    Object.assign(state.person, { manager_id: 7, manager_uid: 'new-manager', sender_uid: 'new-manager', sender_role: 'manager' });
    await fire(); expect(inserts()[0][0]).toContain('chef_notifications'); expect(inserts()[0][1][0]).toBe(3);
  });
  it('keeps verified Local Cooks replies distinct', async () => {
    state.message = { ...state.message, senderId: 1, senderRole: 'admin', senderFirebaseUid: 'actual-admin' };
    Object.assign(state.person, { sender_role: 'admin', sender_uid: 'actual-admin' });
    await fire(); expect(inserts()[0][1][1]).toBe('New message from Local Cooks');
  });
  it.each(['unknown', 'api_key', 'system'])('rejects untrusted/direct client event auth type %s', async authType => {
    await fire(authType); expect(state.query).not.toHaveBeenCalled();
  });
  it.each(['mapping', 'foreign', 'uid', 'role', 'former-manager', 'system', 'old-authorship'])('does not produce notices for %s', async kind => {
    if (kind === 'mapping') state.mapping = undefined;
    if (kind === 'foreign') state.mapping.chefId = 99;
    if (kind === 'uid') state.message.senderFirebaseUid = 'forged';
    if (kind === 'role') state.person.chef_role = 'admin';
    if (kind === 'former-manager') { state.message = { ...state.message, senderId: 2, senderRole: 'manager', senderFirebaseUid: 'actual-manager' };
      Object.assign(state.person, { manager_id: 7, manager_uid: 'new-manager', sender_role: 'manager', sender_uid: 'actual-manager' }); }
    if (kind === 'system') state.message.type = 'system';
    if (kind === 'old-authorship') delete state.message.senderFirebaseUid;
    await fire(); expect(inserts()).toHaveLength(0);
  });
  it('rejects changed persisted authorship against the event snapshot', async () => {
    await fire('service_account', { ...state.message, senderFirebaseUid: 'different' }); expect(state.query).not.toHaveBeenCalled();
  });
  it('rereads actual read state and keeps intent suppressed without fresh receipt', async () => {
    const snapshot = { ...state.message }; state.message.readAt = new Date(); await fire('service_account', snapshot);
    expect(inserts()).toHaveLength(1); expect(inserts()[0][1][5]).toBe('suppressed');
  });
  it('rolls back and rethrows temporary SQL failure; retries actual producer', async () => {
    state.query.mockRejectedValueOnce(Error('temporary database failure'));
    await expect(fire()).rejects.toThrow('temporary database failure');
    expect(state.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    await fire(); expect(inserts()).toHaveLength(2); expect(state.release).toHaveBeenCalledTimes(2);
  });
});
