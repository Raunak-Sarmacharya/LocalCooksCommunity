import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as schema from '@shared/schema';
import { workerContext } from './worker-context';

// Never falls back to DATABASE_URL. This file is excluded from ordinary suites.
const isolatedUrl = process.env.LIFECYCLE_TEST_DATABASE_URL;
const schemaOnly = process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED === 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY';
if (!isolatedUrl || !schemaOnly && process.env.LIFECYCLE_TEST_DATABASE_ISOLATED !== 'I_CONFIRM_THIS_DATABASE_IS_DISPOSABLE')
  throw Error('Required: explicit LIFECYCLE_TEST_DATABASE_URL and isolated schema or disposable database acknowledgment. No connection attempted.');
if (isolatedUrl === process.env.DATABASE_URL && !schemaOnly) throw Error('Refusing the application DATABASE_URL without explicit isolated-schema authorization.');
const testEndpoint = new URL(isolatedUrl);
if (schemaOnly && !/(?:^|\.)supabase\.(?:co|com)$/.test(testEndpoint.hostname))
  throw Error('Schema-only validation is limited to the authorized Supabase staging database. No connection attempted.');
if (testEndpoint.hostname.endsWith('.neon.tech') && testEndpoint.hostname.includes('-pooler') ||
  /(?:^|\.)supabase\.(?:co|com)$/.test(testEndpoint.hostname) && testEndpoint.port === '6543')
  throw Error('Database validation requires a direct or session-pooler connection. No connection attempted.');
process.env.DATABASE_URL = isolatedUrl;
process.env.E2E_SUPPRESS_OUTBOUND = '0';
const sends = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(true) }));
vi.mock('../email', () => ({ sendEmail: sends.send }));
// PostgreSQL locks/transactions/acknowledgments are real; mail and notification
// rendering are controlled sinks. No mail can leave this integration check.
vi.mock('./notification.service', () => ({ notificationService: { create: async () => {} } }));
const namespace = `worker_2c_${randomUUID().replaceAll('-', '')}`;
// Remote test setup includes DNS/TLS latency; statement/lock deadlines remain
// the same as the worker. This does not change its invocation admission budget.
const first = new Client({ connectionString: isolatedUrl, connectionTimeoutMillis: 10_000, statement_timeout: 1000, lock_timeout: 500 });
const second = new Client({ connectionString: isolatedUrl, connectionTimeoutMillis: 10_000, statement_timeout: 1000, lock_timeout: 500 });
const tables = ['users', 'locations', 'kitchens', 'kitchen_bookings', 'kitchen_booking_visits', 'kitchen_viewings',
  'checkin_checkout_checklists', 'email_logs', 'booking_lifecycle_events', 'tour_delivery_events', 'platform_settings', 'storage_bookings'];
let created = false;
async function scoped<T>(client: Client, operation: () => Promise<T>) {
  const deadline = performance.now() + 20_000;
  return workerContext.run({ database: drizzle(client, { schema }), deadline, taskDeadline: deadline, cursors: {}, checkpoint: async () => {} }, operation);
}
beforeAll(async () => {
  await first.connect(); await second.connect();
  const { initializeWorkerSession } = await import('./recurring-worker');
  await initializeWorkerSession(first); await initializeWorkerSession(second);
  await first.query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const table of tables) {
    // Clone verified schema only, never records; source enums stay shared in this
    // expressly disposable database. Missing deployed columns are a prerequisite failure.
    await first.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`);
    const defaults = await first.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_default LIKE 'nextval(%'`, [namespace, table]);
    for (const { column_name: column } of defaults.rows) {
      await first.query(`CREATE SEQUENCE "${namespace}"."${table}_${column}_seq"`);
      await first.query(`ALTER TABLE "${namespace}"."${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('"${namespace}"."${table}_${column}_seq"')`);
    }
  }
  await first.query(`SET search_path TO "${namespace}", public`); await second.query(`SET search_path TO "${namespace}", public`);
  // Reproduce an older schema only in our verified namespace, then apply the
  // exact saved migration twice. Every ALTER is explicitly namespace-qualified.
  for (const table of ['kitchen_bookings', 'kitchen_booking_visits', 'storage_bookings']) {
    await first.query(`ALTER TABLE "${namespace}"."${table}" DROP COLUMN IF EXISTS assistance_history`);
    if (table !== 'kitchen_booking_visits') await first.query(`ALTER TABLE "${namespace}"."${table}" DROP COLUMN IF EXISTS visit_duties`);
  }
  const migration = readFileSync('migrations/0059_visit_duties_and_assistance.sql', 'utf8')
    .replace(/ALTER TABLE (kitchen_bookings|kitchen_booking_visits|storage_bookings)\b/g, `ALTER TABLE "${namespace}".$1`);
  await first.query(`INSERT INTO "${namespace}".kitchen_bookings (id, chef_id, kitchen_id, booking_date, start_time, end_time, status)
    VALUES (11, 3, 4, CURRENT_DATE, '09:00', '10:00', 'confirmed')`);
  await first.query(migration); await first.query(migration);
  const database = drizzle(first, { schema });
  await database.insert(schema.users).values([{ id: 1, username: 'support@example.test', password: 'test-only', role: 'admin' },
    { id: 2, username: 'host@example.test', password: 'test-only', role: 'manager' }, { id: 3, username: 'chef@example.test', password: 'test-only', role: 'chef' }]);
  await database.insert(schema.locations).values({ id: 5, name: 'Controlled kitchen', address: 'Isolated fixture address', managerId: 2, timezone: 'UTC' });
  await database.insert(schema.kitchens).values({ id: 4, locationId: 5, name: 'Controlled kitchen' });
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await database.insert(schema.kitchenBookings).values({ id: 10, chefId: 3, kitchenId: 4, bookingDate: tomorrow,
    startTime: '08:00', endTime: '12:00', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in' });
});
afterAll(async () => {
  try { if (created) await first.query(`DROP SCHEMA "${namespace}" CASCADE`); }
  finally {
    await Promise.all([first.end(), second.end()]);
    const { pool } = await import('../db'); await pool.end();
  }
});
describe('real PostgreSQL competing connection dispatch', () => {
  it('keeps evidenced storage occupied after parent completion, auto review and draft handoff until explicit removal', async () => {
    const database = drizzle(first, { schema });
    const { storageListingAwaitingRemoval } = await import('./booking-linked-cancellation');
    await database.insert(schema.storageBookings).values({ id: 30, storageListingId: 50, kitchenBookingId: 11, chefId: 3,
      startDate: new Date('2026-01-01'), endDate: new Date('2026-01-02'), status: 'completed', totalPrice: '500', pricingModel: 'daily',
      checkoutStatus: 'completed', checkoutApprovedAt: new Date(), checkoutApprovedBy: null });
    const occupied = async () => (await database.execute(sql`SELECT ${storageListingAwaitingRemoval} AS occupied FROM (SELECT 50 AS id) storage_listings`)).rows[0].occupied;
    expect(await occupied()).toBe(true);
    await first.query(`UPDATE "${namespace}".storage_bookings SET checkout_status = 'checkout_claim_filed' WHERE id = 30`);
    expect(await occupied()).toBe(true);
    await first.query(`UPDATE "${namespace}".storage_bookings SET checkout_approved_by = 2 WHERE id = 30`);
    expect(await occupied()).toBe(false);
    await first.query(`UPDATE "${namespace}".storage_bookings SET checkout_approved_by = NULL, checkout_status = 'active', checkin_status = 'not_checked_in' WHERE id = 30`);
    expect(await occupied()).toBe(false); // Missing taps alone do not prove occupancy.
  });
  it('upgrades only the isolated schema and keeps legacy duties nullable and assistance empty', async () => {
    const result = await first.query(`SELECT visit_duties, assistance_history FROM "${namespace}".kitchen_bookings WHERE id = 11`);
    expect(result.rows[0]).toEqual({ visit_duties: null, assistance_history: [] });
    const columns = await first.query('SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND column_name IN ($2, $3)',
      [namespace, 'visit_duties', 'assistance_history']);
    expect(columns.rows).toHaveLength(5);
  });
  it('actually cancels a slow server statement and coordinates whole-worker advisory ownership across connections', async () => {
    const started = performance.now();
    await expect(first.query('SELECT pg_sleep(3)')).rejects.toMatchObject({ code: '57014' });
    expect(performance.now() - started).toBeLessThan(2000);
    expect((await second.query('SELECT 1 AS alive')).rows[0].alive).toBe(1);
    await first.query("SELECT pg_advisory_lock(hashtext('controlled-worker-lock'))");
    expect((await second.query("SELECT pg_try_advisory_lock(hashtext('controlled-worker-lock')) AS owned")).rows[0].owned).toBe(false);
    await first.query("SELECT pg_advisory_unlock(hashtext('controlled-worker-lock'))");
    expect((await second.query("SELECT pg_try_advisory_lock(hashtext('controlled-worker-lock')) AS owned")).rows[0].owned).toBe(true);
    await second.query("SELECT pg_advisory_unlock(hashtext('controlled-worker-lock'))");
  });
  it('serializes concurrent schedule producers, claims a due channel once and retains acknowledgment', async () => {
    const { scheduleAdvanceReminders, dispatchAdvanceReminders } = await import('./advance-reminders');
    const producers = await Promise.allSettled([first, second].map(client => scoped(client, async () => {
      const database = drizzle(client, { schema });
      await database.transaction(tx => scheduleAdvanceReminders(tx, 'booking', 10));
    })));
    expect(producers.some(result => result.status === 'fulfilled')).toBe(true);
    // The losing producer may hit the deliberate 500ms lock deadline on a
    // remote session. Await both, then prove recovery deduplicates after retry.
    for (let index = 0; index < producers.length; index++) {
      const result = producers[index];
      if (result.status !== 'rejected') continue;
      expect(['55P03', '57014']).toContain((result.reason.cause || result.reason).code);
      await scoped([first, second][index], () => drizzle([first, second][index], { schema })
        .transaction(tx => scheduleAdvanceReminders(tx, 'booking', 10)));
    }
    const database = drizzle(first, { schema });
    const logs = await database.select().from(schema.emailLogs); expect(logs).toHaveLength(4);
    const intent = logs.find(row => JSON.parse(row.textBody!).channel === 'email' && JSON.parse(row.textBody!).reminder.kind === 'preparation')!;
    const saved = JSON.parse(intent.textBody!).reminder;
    let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
    sends.send.mockImplementationOnce(async () => { await gate; return true; });
    const run = scoped(first, () => dispatchAdvanceReminders({ now: new Date(saved.due), onlyLogId: intent.id, limit: 1 }));
    try {
      await vi.waitFor(() => expect(sends.send).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect((await scoped(second, () => dispatchAdvanceReminders({ now: new Date(saved.due), onlyLogId: intent.id, limit: 1 }))).accepted).toBe(0);
    }
    finally { release(); }
    expect((await run).accepted).toBe(1);
    expect((await scoped(second, () => dispatchAdvanceReminders({ now: new Date(saved.due), onlyLogId: intent.id, limit: 1 }))).accepted).toBe(0);
    expect(sends.send).toHaveBeenCalledTimes(1);
  });
  it('executes the actual booking ordering guard after an earlier failed genuine financial/confirmation notice', async () => {
    const database = drizzle(first, { schema });
    const common = { bookingId: 10, title: 'Controlled recorded decision', message: 'Immutable recorded payment CAD $20', metadata: {} };
    await database.insert(schema.bookingLifecycleEvents).values([
      { ...common, id: 1, kind: 'confirmed', emails: [{ key: 'chef', to: 'bad@example.test', url: 'https://example.test/booking/10' }] },
      { ...common, id: 2, kind: 'cancelled', emails: [{ key: 'chef', to: 'good@example.test', url: 'https://example.test/booking/10' }] },
    ]);
    const { deliverBookingLifecycleEvents } = await import('./booking-lifecycle-delivery');
    sends.send.mockImplementation(async (content: any) => content.to !== 'bad@example.test');
    expect((await scoped(first, () => deliverBookingLifecycleEvents(1, 20_000, 10, 2))).completed).toBe(0);
    await scoped(first, () => deliverBookingLifecycleEvents(1, 20_000, 10, 1));
    expect((await scoped(second, () => deliverBookingLifecycleEvents(1, 20_000, 10, 2))).completed).toBe(1);
    const records = await database.select().from(schema.bookingLifecycleEvents).orderBy(schema.bookingLifecycleEvents.id);
    expect(records[0].completedAt).toBeNull(); expect(records[0].deliveredEmailKeys).toEqual([]);
    expect(records[0].metadata).toMatchObject({ deliveryRecoveryOwnerIds: [1] });
    expect(records[0].message).toContain('CAD $20'); expect(records[1].completedAt).toBeInstanceOf(Date);
  });
  it('records due-query and source-discovery plans on isolated schema/data without an unverified migration', async () => {
    const plan = await first.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM email_logs
      WHERE category = 'advance_reminder' AND status IN ('scheduled', 'failed')
      AND (text_body::jsonb->'reminder'->>'due')::timestamptz <= now()
      ORDER BY retried_at ASC NULLS FIRST, id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    expect(plan.rows[0]['QUERY PLAN'][0]['Execution Time']).toBeLessThan(1000);
    const { reminderDiscoveryQuery } = await import('./reminder-reconciliation');
    const database = drizzle(first, { schema });
    const discovery = await database.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${reminderDiscoveryQuery('booking', 0, 3)}`);
    expect(discovery.rows).toHaveLength(1);
    console.info('Isolated worker query plans', JSON.stringify({ due: plan.rows, discovery: discovery.rows }));
  });
});
