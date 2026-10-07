import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY')
  throw Error('Explicit authorized disposable PostgreSQL test URL and isolation acknowledgement required');
const endpoint = new URL(url);
if (endpoint.hostname.endsWith('.pooler.supabase.com') && endpoint.port === '6543')
  throw Error('Use a direct or session-pool endpoint; transaction pooling cannot preserve the isolated test search path');
const namespace = `tour_requests_${randomUUID().replaceAll('-', '')}`;
const clients = [new Client({ connectionString: url, connectionTimeoutMillis: 10000 }), new Client({ connectionString: url, connectionTimeoutMillis: 10000 })];
let created = false;
beforeAll(async () => {
  for (const client of clients) await client.connect();
  await clients[0].query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const client of clients) await client.query(`SET search_path TO "${namespace}"; SET lock_timeout TO '10000'; SET statement_timeout TO '15000'`);
  await clients[0].query('CREATE TABLE kitchen_viewings(id integer PRIMARY KEY,status text,scheduled_at timestamp,updated_at timestamp); CREATE TABLE tour_delivery_events(viewing_id integer,created_at timestamp,payload jsonb)');
});
afterAll(async () => {
  try {
    for (const client of clients) await client.query('ROLLBACK; RESET search_path');
    if (created) await clients[0].query(`DROP SCHEMA "${namespace}" CASCADE`);
  }
  finally { for (const client of clients) await client.end(); }
});
it('applies migration twice and backfills only known original confirmations', async () => {
  await clients[0].query("INSERT INTO kitchen_viewings VALUES(1,'confirmed','2030-01-01','2026-01-03'),(2,'confirmed','2030-01-01','2026-01-03')");
  await clients[0].query(`INSERT INTO tour_delivery_events VALUES(1,'2026-01-02','{"kind":"status","before":{"status":"pending"},"after":{"status":"confirmed"}}')`);
  const migration = readFileSync('migrations/0065_tour_request_decisions.sql', 'utf8');
  await clients[0].query(migration); await clients[0].query(migration);
  const result = await clients[0].query('SELECT id,confirmed_at FROM kitchen_viewings ORDER BY id');
  expect(result.rows[0].confirmed_at).not.toBeNull(); expect(result.rows[1].confirmed_at).toBeNull();
});
it('a confirmation committed under the row lock prevents concurrent pending expiry', async () => {
  await clients[0].query("INSERT INTO kitchen_viewings(id,status,scheduled_at) VALUES(3,'pending',CURRENT_TIMESTAMP - interval '1 minute')");
  await clients[0].query('BEGIN');
  await clients[0].query('SELECT id FROM kitchen_viewings WHERE id=3 FOR UPDATE');
  const expiry = clients[1].query("UPDATE kitchen_viewings SET status='cancelled',request_expired_at=scheduled_at WHERE id=3 AND status IN ('pending','pending_local_cooks') AND scheduled_at <= clock_timestamp() RETURNING id");
  await clients[0].query("UPDATE kitchen_viewings SET status='confirmed',confirmed_at=clock_timestamp() WHERE id=3");
  await clients[0].query('COMMIT');
  expect((await expiry).rowCount).toBe(0);
});
