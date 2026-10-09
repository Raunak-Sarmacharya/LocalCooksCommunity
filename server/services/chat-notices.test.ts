import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ logs: [] as any[], messages: {} as Record<string, any>, conversation: {} as any,
  person: {} as any, mapping: undefined as any, bookingExists: true, accepted: new Set<string>(), send: vi.fn(), reads: vi.fn(), updates: [] as any[], notices: [] as any[] }));
vi.mock('../email', async importOriginal => ({ ...await importOriginal<typeof import('../email')>(), sendEmail: state.send }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async (id: number) => id === 3 ? 'Ada Chef' : 'Morgan Manager' }));
vi.mock('../chat-service', () => ({ getAdminDb: async () => ({
  collection: () => ({ doc: (id: string) => ({ id, get: async () => ({ exists: !!state.mapping, data: () => state.mapping }),
    collection: () => ({ doc: (id: string) => ({ id, message: true }) }) }) }),
  getAll: async (...refs: any[]) => { state.reads(); return refs.map(ref => ({ exists: ref.message ? !!state.messages[ref.id] : true,
    data: () => ref.message ? state.messages[ref.id] : state.conversation })); },
}) }));
vi.mock('../db', () => {
  const parsed = (statement: any) => new PgDialect().sqlToQuery(statement);
  const tx = {
    select: () => {
      let condition: any, limit = Infinity;
      const rows = () => {
        const { sql, params } = parsed(condition);
        expect(sql).not.toContain('::jsonb'); expect(sql).not.toContain('::timestamptz');
        if (!sql.includes('"status" in')) {
          const key = params.find((p: any) => typeof p === 'string' && p.startsWith('chat-message:'));
          return sql.includes('"status" =') ? typeof key === 'string' && state.accepted.has(key) ? [{ id: 99 }] : []
            : state.logs.filter(row => row.trackingId === key);
        }
        const dueIndex = /::timestamptz <= \$(\d+)/.exec(sql);
        const retryIndex = /"retried_at" <= \$(\d+)/.exec(sql);
        const due = dueIndex ? params[Number(dueIndex[1]) - 1] as Date : undefined;
        const retry = retryIndex ? params[Number(retryIndex[1]) - 1] as Date : undefined;
        const afterMatch = /"id" > \$(\d+)/.exec(sql);
        const after = afterMatch ? params[Number(afterMatch[1]) - 1] as number : 0;
        const onlyMatch = /"id" = \$(\d+)/.exec(sql);
        const only = onlyMatch ? params[Number(onlyMatch[1]) - 1] as number : undefined;
        const recipientMatch = /"recipient_user_id" = \$(\d+)/.exec(sql);
        const recipient = recipientMatch ? params[Number(recipientMatch[1]) - 1] as number : undefined;
        const excluded = /"id" NOT IN \(([^)]+)\)/.exec(sql)?.[1].match(/\d+/g)?.map(index => params[Number(index) - 1]) || [];
        return state.logs.filter(row => ['scheduled', 'failed'].includes(row.status) &&
          row.id > after && (only === undefined || row.id === only) && (recipient === undefined || row.recipientUserId === recipient) && !excluded.includes(row.id) &&
          (!due || Date.parse(JSON.parse(row.textBody).dueAt) <= due.getTime()) &&
          (!row.retriedAt || !retry || row.retriedAt.getTime() <= retry.getTime())).slice(0, limit);
      };
      const chain: any = { from: () => chain, where: (value: any) => { condition = value; return chain; }, orderBy: () => chain,
        limit: (value: number) => { limit = value; return chain; }, for: () => chain, then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
      return chain;
    },
    execute: async (statement: any) => {
      const { sql, params } = parsed(statement);
      if (sql.includes('pg_try_advisory')) return { rows: [{ owned: true }] };
      if (sql.includes('FROM locations l')) return { rows: state.person ? [state.person] : [] };
      if (sql.includes('FROM kitchen_bookings')) return { rows: state.bookingExists ? [{ id: 10 }] : [] };
      if (sql.startsWith('SELECT id FROM email_logs')) return { rows: state.logs.filter(row => row.trackingId === params[0]).map(row => ({ id: row.id })) };
      if (sql.startsWith('INSERT INTO manager_notifications') || sql.startsWith('INSERT INTO chef_notifications')) state.notices.push({ sql, params });
      if (sql.startsWith('INSERT INTO email_logs')) state.logs.push({ id: state.logs.length + 1, recipientEmail: params[0], recipientUserId: params[1],
        recipientRole: params[2], status: params[5], trackingId: params[6], textBody: params[7], retryCount: 0, retriedAt: null, category: 'chat_digest' });
      return { rows: [] };
    },
    update: () => ({ set: (values: any) => ({ where: async (condition: any) => {
      const { params } = parsed(condition); const row = state.logs.find(row => row.id === params[0]);
      Object.assign(row, values); state.updates.push({ id: row.id, ...values });
    } }) }),
  };
  return { db: { ...tx, transaction: async (run: any) => run(tx) } };
});
import { dispatchChatDigests, parseChatDigest, notifyPersistedChatMessage, deliverStartingChatMessage } from './chat-notices';
import { workerContext } from './worker-context';
const now = new Date('2026-10-04T09:00:00Z');
function log(id: number, dueAt = now.toISOString()) {
  return { id, recipientUserId: 2, recipientEmail: 'old@example.test', recipientRole: 'manager', status: 'scheduled', category: 'chat_digest',
    trackingId: `chat-message:thread:m${id}:2`, retryCount: 0, retriedAt: null,
    textBody: JSON.stringify({ conversationId: 'thread', messageId: `m${id}`, applicationId: 8, bookingId: 10,
      senderId: 3, senderRole: 'chef', dueAt, path: '/old-stored-destination' }) };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0'); state.logs = [log(1), log(2)]; state.updates = []; state.notices = []; state.accepted.clear();
  state.conversation = { applicationId: 8, chefId: 3, managerId: 2, locationId: 5, chefFirebaseUid: 'actual-chef', managerFirebaseUid: 'actual-manager' };
  state.mapping = { chefId: 3, locationId: 5, conversationId: 'thread' };
  state.person = { chef_id: 3, manager_id: 2, location_id: 5, location_name: 'Awesome Kitchen', chef_uid: 'actual-chef', manager_uid: 'actual-manager',
    chef_role: 'chef', manager_role: 'manager', sender_uid: 'actual-chef', sender_profile: { displayName: 'Ada Chef' },
    chef_email: 'chef@example.test', manager_email: 'current-manager@example.test', sender_role: 'chef', apps_count: '1' };
  state.messages = { m1: { senderId: 3, senderRole: 'chef', senderFirebaseUid: 'actual-chef', type: 'text', bookingId: 10 }, m2: { senderId: 3, senderRole: 'chef', senderFirebaseUid: 'actual-chef', type: 'file', bookingId: 10 } };
  for (const message of Object.values(state.messages)) message.createdAt = { toDate: () => new Date('2026-10-04T08:00:00Z') };
  state.bookingExists = true; state.send.mockResolvedValue(true);
});
describe('actual durable unread dispatcher with controlled Firestore/SMTP sinks', () => {
  function episode(phase: 'initial' | 'reminder' = 'initial') {
    const row = log(1, phase === 'initial' ? '2026-10-04T08:00:15.000Z' : now.toISOString());
    row.trackingId += phase === 'reminder' ? ':reminder' : '';
    row.textBody = JSON.stringify({ ...JSON.parse(row.textBody), episodeId: 'm1', phase });
    state.logs = [row];
    Object.assign(state.messages.m1, { emailEpisodeId: 'm1', emailRecipientId: 2, content: 'Where should we meet? <script>bad</script>' });
    Object.assign(state.conversation, { emailManagerEpisode: { id: 'm1', recipientId: 2 }, unreadManagerCount: 3 });
    return row;
  }
  it('connects the event wakeup to the original initial intent without delivering the reminder or duplicating a retry', async () => {
    episode(); state.logs = [];
    await deliverStartingChatMessage('thread', 'm1', 3);
    expect(state.logs).toHaveLength(2); expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs[0].status).toBe('sent'); expect(state.logs[1].status).toBe('scheduled');
    await deliverStartingChatMessage('thread', 'm1', 3);
    expect(state.send).toHaveBeenCalledTimes(1);
    Object.assign(state.messages.m2, { emailEpisodeId: 'm1', emailRecipientId: 2 });
    await deliverStartingChatMessage('thread', 'm2', 3);
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.logs[2].status).toBe('suppressed');
  });
  it('waits 15 seconds for the first-message alert, uses names and escaped preview, and acknowledges it once', async () => {
    episode();
    await dispatchChatDigests(1, 20000, undefined, new Date('2026-10-04T08:00:14Z'));
    expect(state.send).not.toHaveBeenCalled();
    await dispatchChatDigests(1, 20000, undefined, new Date('2026-10-04T08:00:15Z'));
    expect(state.send).toHaveBeenCalledTimes(1);
    const email = state.send.mock.calls[0][0];
    expect(email.subject).toBe('New message from Ada Chef — Awesome Kitchen');
    expect(email.text).toContain('Hi Morgan Manager'); expect(email.text).toContain('Where should we meet?');
    expect(email.html).toContain('&lt;script&gt;'); expect(email.html).not.toContain('<script>');
    await dispatchChatDigests(1, 20000, undefined, now); expect(state.send).toHaveBeenCalledTimes(1);
  });
  it.each(['read', 'reply', 'next-episode', 'recipient', 'context'])('suppresses an initial alert after %s', async kind => {
    episode();
    if (kind === 'read') state.messages.m1.readAt = now;
    if (kind === 'reply') delete state.conversation.emailManagerEpisode;
    if (kind === 'next-episode') state.conversation.emailManagerEpisode.id = 'new-first';
    if (kind === 'recipient') state.person.manager_id = 7;
    if (kind === 'context') state.bookingExists = false;
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).not.toHaveBeenCalled(); expect(state.logs[0].status).toBe('suppressed');
  });
  it('sends the one-hour reminder for newer unread messages even if the first was read, then stays quiet', async () => {
    episode('reminder'); state.messages.m1.readAt = now;
    await dispatchChatDigests(1, 20000, undefined, new Date(now.getTime() - 1)); expect(state.send).not.toHaveBeenCalled();
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.send.mock.calls[0][0].text).toContain('3 unread messages');
    state.conversation.unreadManagerCount = 5;
    await dispatchChatDigests(1, 20000, undefined, new Date(now.getTime() + 3600000)); expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('suppresses the reminder after a full read or reply, and preserves one retry key for failed delivery', async () => {
    episode('reminder'); state.conversation.unreadManagerCount = 0;
    await dispatchChatDigests(1, 20000, undefined, now); expect(state.send).not.toHaveBeenCalled();
    episode('reminder'); delete state.conversation.emailManagerEpisode;
    await dispatchChatDigests(1, 20000, undefined, now); expect(state.send).not.toHaveBeenCalled();
    episode(); state.send.mockResolvedValueOnce(false);
    await dispatchChatDigests(1, 20000, undefined, now);
    await dispatchChatDigests(1, 20000, undefined, new Date(now.getTime() + 61000));
    expect(state.send).toHaveBeenCalledTimes(2); expect(state.logs[0].status).toBe('sent');
    expect(state.send.mock.calls[0][1].trackingId).toBe(state.send.mock.calls[1][1].trackingId);
  });
  it('routes a manager starting message and attachment notice to the current chef', async () => {
    const row = episode();
    Object.assign(row, { recipientUserId: 3, recipientRole: 'chef' });
    row.textBody = JSON.stringify({ ...JSON.parse(row.textBody), senderId: 2, senderRole: 'manager' });
    Object.assign(state.person, { sender_uid: 'actual-manager', sender_role: 'manager' });
    Object.assign(state.messages.m1, { senderId: 2, senderRole: 'manager', senderFirebaseUid: 'actual-manager', emailRecipientId: 3, type: 'file', fileName: 'tour.pdf' });
    Object.assign(state.conversation, { emailChefEpisode: { id: 'm1', recipientId: 3 }, unreadChefCount: 1 });
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send.mock.calls[0][0]).toMatchObject({ to: 'chef@example.test', subject: 'New message from Morgan Manager — Awesome Kitchen' });
    expect(state.send.mock.calls[0][0].text).toContain('Sent an attachment: tour.pdf');
    expect(state.send.mock.calls[0][0].text).toContain('/dashboard?view=messages&conversation=thread');
  });
  it('never mixes a new initial alert/reminder into a legacy digest', async () => {
    episode(); const initial = state.logs[0]; state.logs = [log(2), initial];
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(initial.status).toBe('scheduled'); expect(state.logs[0].status).toBe('sent');
  });
  it('groups multiple unread messages, reloads current recipient/context and suppresses repeated dispatch', async () => {
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toMatchObject({ to: 'current-manager@example.test', text: expect.stringContaining('2 unread messages') });
    expect(state.send.mock.calls[0][0].text).toContain('/manager/dashboard?view=messages&conversation=thread');
    expect(state.send.mock.calls[0][0].text).toContain('- Booking #10');
    expect(state.logs.every(row => row.status === 'sent')).toBe(true);
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('does not send early, then includes newer messages in the oldest due digest', async () => {
    state.logs = [log(1, '2026-10-04T10:00:00Z')];
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).not.toHaveBeenCalled();
    state.logs = [log(1), log(2, '2026-10-04T09:30:00Z')];
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send.mock.calls[0][0].text).toContain('2 unread');
  });
  it.each(['read', 'cancelled', 'participant', 'mapping', 'missing-mapping', 'deleted', 'authorship'])('suppresses stale %s digest', async kind => {
    if (kind === 'read') { state.messages.m1.readAt = now; state.messages.m2.readAt = now; }
    if (kind === 'cancelled') state.bookingExists = false;
    if (kind === 'participant') { state.person.manager_id = 7; state.person.manager_uid = 'reassigned'; }
    if (kind === 'mapping') state.mapping.conversationId = 'other-canonical';
    if (kind === 'missing-mapping') state.mapping = undefined;
    if (kind === 'deleted') state.person = undefined;
    if (kind === 'authorship') { delete state.messages.m1.senderFirebaseUid; delete state.messages.m2.senderFirebaseUid; }
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).not.toHaveBeenCalled(); expect(state.logs.every(row => row.status === 'suppressed')).toBe(true);
  });
  it('retries temporary mail failure after backoff with the original key and per-message acknowledgments', async () => {
    state.send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.logs.every(row => row.status === 'failed')).toBe(true);
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1);
    await dispatchChatDigests(1, 20000, undefined, new Date(now.getTime() + 61000));
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.send.mock.calls[0][1].trackingId).toBe(state.send.mock.calls[1][1].trackingId);
    expect(state.logs.every(row => row.status === 'sent' && row.retryCount === 2)).toBe(true);
  });
  it('does not resend a durable SMTP acceptance after an interrupted acknowledgment', async () => {
    state.logs = [log(1)]; state.accepted.add(state.logs[0].trackingId);
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).not.toHaveBeenCalled(); expect(state.logs[0].status).toBe('sent');
  });
  it('retains an owned failed read and lets another pending message progress', async () => {
    state.reads.mockImplementationOnce(() => { throw Error('temporary Firestore failure'); });
    const result = await dispatchChatDigests(2, 20000, undefined, now);
    expect(result).toMatchObject({ completed: 1, errors: 1 });
    expect(state.logs[0].status).toBe('failed'); expect(state.logs[1].status).toBe('sent');
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed identities instead of mailing stored JSON', () => {
    expect(() => parseChatDigest('{"conversationId":"foreign/path"}')).toThrow('Invalid chat intent');
  });
  it('invalid JSON and invalid/missing date ahead of valid due work cannot poison every run or starve it', async () => {
    state.logs = [
      { ...log(1), textBody: 'not-json' },
      { ...log(2), textBody: JSON.stringify({ conversationId: 'thread', messageId: 'm1', dueAt: 'not-a-date' }) },
      log(3) // Valid due work
    ];
    state.messages.m3 = state.messages.m2;
    const result = await dispatchChatDigests(1, 20000, undefined, now);
    expect(result.completed).toBe(1);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs[0].status).toBe('suppressed');
    expect(state.logs[1].status).toBe('suppressed');
    expect(state.logs[2].status).toBe('sent');
  });
  it('keeps original shared conversation when genuine application metadata changes', async () => {
    state.conversation.applicationId = 9;
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.logs.every(row => row.status === 'sent')).toBe(true);
  });
  it('sends tour-only terminal-approved digest with no application or invented booking', async () => {
    delete state.conversation.applicationId; state.person.apps_count = 0; state.person.tours = [{ status: 'cancelled', admin_review_decision: 'approved' }];
    for (const row of state.logs) { const intent = JSON.parse(row.textBody); delete intent.applicationId; delete intent.bookingId; row.textBody = JSON.stringify(intent); }
    for (const message of Object.values(state.messages)) delete message.bookingId;
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0].text).not.toContain('Booking');
  });
  it('does not starve due records behind a full future page', async () => {
    state.logs = Array.from({ length: 21 }, (_, index) => log(index + 1, index < 20 ? '2026-10-04T10:00:00Z' : now.toISOString()));
    for (const row of state.logs) state.messages['m' + row.id] = { ...state.messages.m1 };
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.logs.at(-1).status).toBe('sent');
  });
  it('includes selected due row when unrelated threads fill the group page', async () => {
    state.logs = Array.from({ length: 51 }, (_, index) => {
      const row = log(index + 1, index < 50 ? '2026-10-04T10:00:00Z' : now.toISOString());
      if (index < 50) row.textBody = row.textBody.replace('"conversationId":"thread"', '"conversationId":"other"');
      return row;
    });
    state.messages.m51 = state.messages.m1;
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.logs[50].status).toBe('sent');
    expect(state.logs.slice(0, 50).every(row => row.status === 'scheduled')).toBe(true);
  });
  it('preserves a targeted retry without processing a different log', async () => {
    await dispatchChatDigests(1, 20000, 2, now);
    expect(state.send.mock.calls[0][1].retryOfId).toBe(2);
  });
  it('checkpoints bounded scans across worker ticks so more than 60 future records do not starve due work', async () => {
    state.logs = Array.from({ length: 61 }, (_, index) => log(index + 1, index < 60 ? '2026-10-04T10:00:00Z' : now.toISOString()));
    state.messages.m61 = state.messages.m1;
    const cursors: Record<string, number> = {};
    const tick = () => workerContext.run({ database: {} as any, deadline: performance.now() + 18000, taskDeadline: performance.now() + 18000,
      cursors, checkpoint: async (key, id) => { cursors[key] = id; } }, () => dispatchChatDigests(1, 18000, undefined, now));
    await tick(); expect(state.send).not.toHaveBeenCalled(); expect(cursors.chatDigests).toBe(60);
    await tick(); expect(state.send).toHaveBeenCalledTimes(1); expect(state.logs[60].status).toBe('sent');
    await tick(); expect(cursors.chatDigests).toBe(0);
  });
  it('connects persisted message, idempotent alias receipt, due digest, exact link and saved read suppression', async () => {
    state.logs = [];
    await notifyPersistedChatMessage('thread', 'm1', 3); await notifyPersistedChatMessage('thread', 'm1', 3);
    expect(state.notices).toHaveLength(1); expect(state.logs).toHaveLength(1);
    expect(state.notices[0].params[0]).toBe(2);
    expect(state.notices[0].params[4]).toBe('/manager/dashboard?view=messages&conversation=thread&booking=10');
    await dispatchChatDigests(1, 20000, undefined, new Date(now.getTime() - 1)); expect(state.send).not.toHaveBeenCalled();
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0].text).toContain('/manager/dashboard?view=messages&conversation=thread');
    await notifyPersistedChatMessage('thread', 'm2', 3);
    state.messages.m2.readAt = now; // Actual C2 visible-read path persists this field; client/participant checks verify that writer separately.
    await dispatchChatDigests(1, 20000, undefined, now);
    expect(state.logs[1].status).toBe('suppressed'); expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('aliases reject actor mismatch and cannot queue noncanonical persisted copies', async () => {
    state.logs = [];
    await expect(notifyPersistedChatMessage('thread', 'm1', 99)).rejects.toThrow('not owned');
    state.mapping.conversationId = 'different'; await notifyPersistedChatMessage('thread', 'm1', 3);
    expect(state.logs).toEqual([]); expect(state.notices).toEqual([]);
  });
});

describe('admin broadcast delivery isolation', () => {
  function broadcast() {
    state.logs = [];
    Object.assign(state.person, { sender_uid: 'actual-admin', sender_role: 'admin' });
    state.messages.m1 = { senderId: 1, senderRole: 'admin', senderFirebaseUid: 'actual-admin', type: 'text', content: 'Tour update',
      createdAt: { toDate: () => new Date('2026-10-04T08:00:00Z') }, adminAudience: 'both',
      recipientStates: { chef: { recipientId: 3, episodeId: 'm1', readAt: null }, manager: { recipientId: 2, episodeId: 'm1', readAt: null } } };
    Object.assign(state.conversation, { emailChefEpisode: { id: 'm1', recipientId: 3 }, emailManagerEpisode: { id: 'm1', recipientId: 2 }, unreadChefCount: 1, unreadManagerCount: 1 });
  }
  it('role events deliver each original intent once without stealing the other target', async () => {
    broadcast();
    await deliverStartingChatMessage('thread', 'm1', 1, 'manager');
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs.find(row => row.recipientRole === 'chef' && !row.trackingId.endsWith(':reminder')).status).toBe('scheduled');
    await deliverStartingChatMessage('thread', 'm1', 1, 'chef');
    await deliverStartingChatMessage('thread', 'm1', 1, 'manager');
    expect(state.send).toHaveBeenCalledTimes(2);
  });
  it.each(['chef', 'manager'] as const)('a %s read does not suppress the other email', async role => {
    broadcast(); state.messages.m1.recipientStates[role].readAt = new Date();
    delete state.conversation[role === 'chef' ? 'emailChefEpisode' : 'emailManagerEpisode'];
    await deliverStartingChatMessage('thread', 'm1', 1);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs.find(row => row.recipientRole === role && !row.trackingId.endsWith(':reminder')).status).toBe('suppressed');
    expect(state.logs.find(row => row.recipientRole !== role && !row.trackingId.endsWith(':reminder')).status).toBe('sent');
  });
  it.each(['chef', 'manager'] as const)('a %s reply only obsoletes that episode', async role => {
    broadcast(); delete state.conversation[role === 'chef' ? 'emailChefEpisode' : 'emailManagerEpisode'];
    await deliverStartingChatMessage('thread', 'm1', 1);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs.find(row => row.recipientRole === role && !row.trackingId.endsWith(':reminder')).status).toBe('suppressed');
  });
  it('suppresses a manager intent after reassignment while delivering the chef intent', async () => {
    broadcast(); await notifyPersistedChatMessage('thread', 'm1', 1);
    state.person.manager_id = 7;
    for (const row of state.logs.filter(row => !row.trackingId.endsWith(':reminder'))) await dispatchChatDigests(1, 20000, row.id);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs.find(row => row.recipientRole === 'manager' && !row.trackingId.endsWith(':reminder')).status).toBe('suppressed');
  });
});
