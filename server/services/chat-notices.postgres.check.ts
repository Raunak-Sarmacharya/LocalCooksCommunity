import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import * as schema from '@shared/schema';
import { workerContext } from './worker-context';
import { queueChatNotice } from '../../functions/src/chat-notice';
const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY') throw Error('Explicit isolated Supabase schema authorization required; no connection attempted');
const endpoint = new URL(url);
if (!/(?:^|\.)supabase\.(?:co|com)$/.test(endpoint.hostname) || endpoint.port === '6543') throw Error('Only authorized Supabase session connections allowed; no connection attempted');
process.env.DATABASE_URL = url; process.env.E2E_SUPPRESS_OUTBOUND = '0';
const state = vi.hoisted(() => ({ send: vi.fn(), read: false }));
vi.mock('../email', async importOriginal => ({ ...await importOriginal<typeof import('../email')>(), sendEmail: state.send }));
const conversation = { applicationId: 8, chefId: 3, managerId: 2, locationId: 5, chefFirebaseUid: 'isolated-chef', managerFirebaseUid: 'isolated-manager' };
const relationship = { chefId: 3, locationId: 5, conversationId: 'thread' };
const message = { senderId: 3, senderRole: 'chef', senderFirebaseUid: 'isolated-chef', type: 'text', content: 'Isolated kitchen coordination', bookingId: 10,
  createdAt: { toDate: () => new Date('2026-10-04T08:00:00Z') } };
vi.mock('../chat-service', () => ({ getAdminDb: async () => ({ collection: () => ({ doc: (id: string) => ({ id,
  get: async () => ({ exists: true, data: () => relationship }),
  collection: () => ({ doc: (id: string) => ({ id, message: true }) }) }) }),
  getAll: async (...refs: any[]) => refs.map(ref => ({ exists: true, data: () => ref.message ? { ...message, readAt: state.read ? new Date() : null } : conversation })),
}) }));
const namespace = `chat_4a_${randomUUID().replaceAll('-', '')}`;
const clients = [new Client({ connectionString: url, connectionTimeoutMillis: 10000 }), new Client({ connectionString: url, connectionTimeoutMillis: 10000 })];
let created = false;
const first = clients[0], second = clients[1];
async function scoped<T>(client: Client, operation: () => Promise<T>) {
  const deadline = performance.now() + 20000;
  return workerContext.run({ database: drizzle(client, { schema }), deadline, taskDeadline: deadline, cursors: {}, checkpoint: async () => {} }, operation);
}
async function produce(client: Client, id: string, persisted = message) {
  await client.query('BEGIN');
  try { const result = await queueChatNotice(client, 'thread', id, conversation, persisted, relationship); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
}
beforeAll(async () => {
  await first.connect(); await second.connect();
  for (const client of clients) await client.query("SELECT set_config('statement_timeout','1000',false), set_config('lock_timeout','500',false), set_config('idle_in_transaction_session_timeout','10000',false)");
  await first.query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const table of ['users', 'locations', 'kitchens', 'kitchen_bookings', 'chef_kitchen_applications', 'kitchen_viewings', 'manager_notifications', 'chef_notifications', 'email_logs']) {
    await first.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`);
    const defaults = await first.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_default LIKE 'nextval(%'`, [namespace, table]);
    for (const { column_name: column } of defaults.rows) {
      await first.query(`CREATE SEQUENCE "${namespace}"."${table}_${column}_seq"`);
      await first.query(`ALTER TABLE "${namespace}"."${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('"${namespace}"."${table}_${column}_seq"')`);
    }
  }
  for (const client of clients) await client.query(`SET search_path TO "${namespace}", public`);
  await first.query(`INSERT INTO users (id, username, password, role, firebase_uid) VALUES
    (1,'owner@example.test','test-only','admin','isolated-owner'), (2,'host@example.test','test-only','manager','isolated-manager'), (3,'chef@example.test','test-only','chef','isolated-chef')`);
  await first.query(`INSERT INTO locations (id,name,address,manager_id) VALUES (5,'Isolated kitchen','Test-only address',2)`);
  await first.query(`INSERT INTO kitchens (id,name,location_id) VALUES (4,'Isolated kitchen',5)`);
  await first.query(`INSERT INTO kitchen_bookings (id,chef_id,kitchen_id,booking_date,start_time,end_time,status) VALUES (10,3,4,CURRENT_DATE,'08:00','12:00','confirmed')`);
  await first.query(`INSERT INTO chef_kitchen_applications (id,chef_id,location_id,full_name,email,phone,kitchen_preference,food_safety_license,food_establishment_cert,status,chat_conversation_id)
    VALUES (8,3,5,'Isolated chef','chef@example.test','test-only','commercial','yes','no','approved','thread')`);
});
afterAll(async () => {
  try { if (created) await first.query(`DROP SCHEMA "${namespace}" CASCADE`); }
  finally { await Promise.all(clients.map(client => client.end())); const { pool } = await import('../db'); await pool.end(); }
});
describe('real isolated PostgreSQL chat producer and dispatcher', () => {
  it('serializes repeated producers across connections and persists one notice/recipient intent', async () => {
    const outcomes = await Promise.allSettled([produce(first, 'm1'), produce(second, 'm1')]);
    expect(outcomes.some(result => result.status === 'fulfilled')).toBe(true);
    for (let i = 0; i < outcomes.length; i++) if (outcomes[i].status === 'rejected') {
      expect(['55P03','57014']).toContain((outcomes[i] as PromiseRejectedResult).reason.code); await produce(clients[i], 'm1');
    }
    expect((await first.query(`SELECT id FROM manager_notifications`)).rows).toHaveLength(1);
    expect((await first.query(`SELECT id FROM email_logs`)).rows).toHaveLength(1);
    await produce(first, 'm2');
  });
  it('claims a multi-message digest once across real row/advisory locks and retains acknowledgments', async () => {
    const { dispatchChatDigests } = await import('./chat-notices');
    let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
    state.send.mockImplementationOnce(async () => { await gate; return true; });
    const now = new Date('2026-10-04T09:00:00Z');
    const run = scoped(first, () => dispatchChatDigests(1,20000,undefined,now));
    try {
      await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1), { timeout: 10000 });
      expect((await scoped(second, () => dispatchChatDigests(1,20000,undefined,now))).completed).toBe(0);
    } finally { release(); }
    expect((await run).completed).toBe(1);
    expect((await first.query(`SELECT status FROM email_logs`)).rows.every(row => row.status === 'sent')).toBe(true);
    expect((await scoped(second, () => dispatchChatDigests(1,20000,undefined,now))).completed).toBe(0);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('suppresses actual read/cancelled context without an SMTP attempt and cleans up only its schema', async () => {
    await produce(first,'m3'); state.read = true;
    const { dispatchChatDigests } = await import('./chat-notices');
    await scoped(first, () => dispatchChatDigests(1,20000,undefined,new Date('2026-10-04T09:00:00Z')));
    state.read = false; await produce(first,'m4'); await first.query(`UPDATE kitchen_bookings SET status = 'cancelled' WHERE id = 10`);
    await scoped(first, () => dispatchChatDigests(1,20000,undefined,new Date('2026-10-04T09:00:00Z')));
    expect((await first.query(`SELECT status FROM email_logs WHERE tracking_id LIKE '%:m3:%' OR tracking_id LIKE '%:m4:%'`)).rows.every(row => row.status === 'suppressed')).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('preserves legacy application chat and actual chef notice SQL for a Local Cooks reply', async () => {
    await produce(first, 'admin-reply', { ...message, senderId: 1, senderRole: 'admin', senderFirebaseUid: 'isolated-owner', bookingId: undefined } as any);
    const notices = await first.query(`SELECT chef_id, action_url FROM chef_notifications`);
    expect(notices.rows).toEqual([{ chef_id: 3, action_url: '/dashboard?view=messages&conversation=thread' }]);
    expect((await first.query(`SELECT recipient_user_id, recipient_role FROM email_logs WHERE tracking_id LIKE '%:admin-reply:%'`)).rows)
      .toEqual([{ recipient_user_id: 3, recipient_role: 'chef' }]);
  });
});
