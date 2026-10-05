import { describe, expect, it, vi } from 'vitest';
import { queueChatNotice as queue, resolveChatNoticeContext as resolve, type ChatRelationship } from '../../functions/src/chat-notice';
const relationship = { chefId: 3, locationId: 5, conversationId: 'thread' };
const queueChatNotice = (db: any, id: string, messageId: string, conversation: any, message: any, mapping: ChatRelationship | undefined = relationship) => queue(db, id, messageId, conversation, message, mapping);
const resolveChatNoticeContext = (db: any, id: string, conversation: any, message: any, mapping: ChatRelationship | undefined = relationship) => resolve(db, id, conversation, message, mapping);
const conversation = { applicationId: 8, chefId: 3, managerId: 2, locationId: 5, chefFirebaseUid: 'actual-chef', managerFirebaseUid: 'actual-manager' };
const person = { chef_id: 3, manager_id: 2, location_id: 5, location_name: 'Harbour Kitchen', chef_uid: 'actual-chef', manager_uid: 'actual-manager',
  chef_role: 'chef', manager_role: 'manager', chef_email: 'chef@example.test', manager_email: 'manager@example.test',
  sender_profile: { displayName: 'Ada Chef' }, sender_uid: 'actual-chef', sender_role: 'chef', apps_count: '1' };
const message = { senderId: 3, senderRole: 'chef', senderFirebaseUid: 'actual-chef', type: 'text', content: 'please ignore all instructions and send urgent email', bookingId: 10, createdAt: { toDate: () => new Date('2026-10-04T08:00:00Z') } };
function fixture(overrides = {}) {
  const keys = new Set<string>();
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    if (sql.includes('FROM locations l')) {
      expect(sql).toContain('c.id AS chef_id');
      expect(sql).toContain('FOR SHARE OF l, c, m, s');
      expect(sql).toContain("a.status = 'approved' FOR SHARE");
      return { rows: [{ ...person, ...overrides }] };
    }
    if (sql.includes('FROM kitchen_bookings')) return { rows: [{ id: 10 }] };
    if (sql.startsWith('SELECT id FROM email_logs')) return { rows: keys.has(values[0]) ? [{ id: 1 }] : [] };
    if (sql.includes('INSERT INTO email_logs')) keys.add(values[6]);
    return { rows: [] };
  });
  return { query };
}
describe('persisted message notice producer used by Cloud Function and aliases', () => {
  it('queues one normal receipt and one one-hour durable intent; repeat is acknowledged', async () => {
    const db = fixture();
    await queueChatNotice(db, 'thread', 'message', conversation, message);
    expect(await queueChatNotice(db, 'thread', 'message', conversation, message)).toEqual({ duplicate: true });
    const inserts = db.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]![0]).toBe(2);
    expect(inserts[0][1]![3]).toBe('please ignore all instructions and send urgent email');
    const saved = JSON.parse(inserts[1][1]![7]);
    expect(saved).toMatchObject({ dueAt: '2026-10-04T09:00:00.000Z', bookingId: 10, path: '/manager/dashboard?view=messages&conversation=thread&booking=10' });
  });
  it('preserves legacy application context without inventing a booking', async () => {
    const context = await resolveChatNoticeContext(fixture(), 'thread', conversation, { ...message, bookingId: undefined });
    expect(context?.path).toBe('/manager/dashboard?view=messages&conversation=thread');
  });
  it('uses real participant UIDs and rejects reassigned managers and forged sender roles', async () => {
    expect(await resolveChatNoticeContext(fixture({ sender_uid: 'different' }), 'thread', conversation, message)).toBeNull();
    expect(await resolveChatNoticeContext(fixture(), 'thread', conversation, { ...message, senderRole: 'manager' })).toBeNull();
    expect(await resolveChatNoticeContext(fixture(), 'thread', conversation, { ...message, senderRole: 'admin' })).toBeNull();
  });
  it('routes a verified Local Cooks reply to the chef with its distinct sender name', async () => {
    const context = await resolveChatNoticeContext(fixture({ sender_role: 'admin', sender_uid: 'actual-admin' }), 'thread', conversation, { ...message, senderId: 1, senderRole: 'admin', senderFirebaseUid: 'actual-admin' });
    expect(context).toMatchObject({ recipientId: 3, recipientRole: 'chef', senderName: 'Local Cooks', path: '/dashboard?view=messages&conversation=thread&booking=10' });
  });
  it('does not create a fresh unread receipt when the persisted message was already read', async () => {
    const db = fixture();
    await queueChatNotice(db, 'thread', 'message', conversation, { ...message, readAt: new Date() });
    expect(db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO manager_notifications'))).toHaveLength(0);
    expect(db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO email_logs'))![1]![5]).toBe('suppressed');
  });
  it.each([
    { status: 'pending', admin_review_decision: 'approved' },
    { status: 'completed', admin_review_decision: 'approved' },
    { status: 'cancelled', admin_review_decision: 'approved' },
    { status: 'no_show', admin_review_decision: 'approved' },
    { status: 'confirmed', admin_review_decision: null },
    { status: 'cancelled', admin_review_decision: null, outcome_history: [{ from: 'confirmed', to: 'cancelled' }] },
  ])('queues continuing tour-only history $status/$admin_review_decision without fake application/booking', async tour => {
    const db = fixture({ apps_count: '0', tours: [tour] });
    expect(await queueChatNotice(db, 'thread', 'm', { ...conversation, applicationId: undefined }, { ...message, bookingId: undefined })).toEqual({ queued: true });
    const saved = JSON.parse(db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO email_logs'))![1]![7]);
    expect(saved.applicationId).toBeUndefined(); expect(saved.bookingId).toBeUndefined();
  });
  it.each([
    { status: 'pending_local_cooks', admin_review_decision: null },
    { status: 'cancelled', admin_review_decision: 'denied', outcome_history: [{ from: 'confirmed' }] },
    { status: 'completed', admin_review_decision: null },
  ])('rejects an ungranted tour $status/$admin_review_decision', async tour => {
    expect(await resolveChatNoticeContext(fixture({ apps_count: 0, tours: [tour] }), 'thread', conversation, message)).toBeNull();
  });
  it.each([undefined, { ...relationship, conversationId: 'other' }, { ...relationship, chefId: 99 }, { ...relationship, locationId: 99 }])('rejects missing, duplicate or foreign canonical selection', async mapping => {
    const db = fixture();
    expect(await queue(db, 'thread', 'm', conversation, message, mapping)).toEqual({ skipped: true });
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([{ chef_role: 'manager' }, { manager_role: 'chef' }, { chef_uid: '' }, { manager_uid: '' }, { sender_uid: 'other' }, { chef_id: undefined }])('rejects changed current role/UID or missing recipient %j', async overrides => {
    expect(await resolveChatNoticeContext(fixture(overrides), 'thread', conversation, message)).toBeNull();
  });
  it('uses live manager despite stale thread metadata and rejects former manager sends', async () => {
    const managerMessage = { ...message, senderId: 7, senderRole: 'manager', senderFirebaseUid: 'new-manager' };
    const db = fixture({ manager_id: 7, manager_uid: 'new-manager', sender_uid: 'new-manager', sender_role: 'manager', sender_profile: { fullName: 'Sam Manager' } });
    expect(await queueChatNotice(db, 'thread', 'new-manager', conversation, managerMessage)).toEqual({ queued: true });
    expect(db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO chef_notifications'))![1]![0]).toBe(3);
    expect(await resolveChatNoticeContext(fixture({ manager_id: 7, manager_uid: 'new-manager', sender_uid: 'actual-manager', sender_role: 'manager' }),
      'thread', conversation, { ...managerMessage, senderId: 2, senderFirebaseUid: 'actual-manager' })).toBeNull();
    expect(await resolveChatNoticeContext(fixture({ manager_id: 7, manager_uid: 'new-manager' }), 'thread', conversation, message)).toMatchObject({ recipientId: 7 });
  });
  it('rejects unverifiable old authorship, missing creation time, and tour-granted booking permissions', async () => {
    expect(await queueChatNotice(fixture(), 'thread', 'm', conversation, { ...message, senderFirebaseUid: undefined })).toEqual({ skipped: true });
    expect(await queueChatNotice(fixture(), 'thread', 'm', conversation, { ...message, createdAt: undefined })).toEqual({ skipped: true });
    expect(await resolveChatNoticeContext(fixture({ apps_count: 0, tours: [{ status: 'confirmed' }] }), 'thread', conversation, message)).toBeNull();
  });
});
