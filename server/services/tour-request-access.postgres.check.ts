import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';
import { kitchenViewings, tourRepeatAuthorizations } from '@shared/schema';
vi.mock('../db', () => ({ db: {} }));
import { readTourRequestAccess, requireTourRequestAccess, grantRepeatTourPermission, useRepeatTourPermission, revokeRepeatTourPermission } from './tour-request-access-service';

const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY')
  throw Error('Explicit disposable PostgreSQL test URL and isolation acknowledgement required');
const endpoint = new URL(url);
if (endpoint.hostname.endsWith('.pooler.supabase.com') && endpoint.port === '6543')
  throw Error('Use a direct or session-pool endpoint for the isolated search path');
const namespace = `tour_access_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000, max: 4,
  options: `-c search_path=${namespace} -c lock_timeout=10000 -c statement_timeout=15000` });
const connection: any = drizzle(pool);
let created = false, fixtureId = 100;
const reason = 'Major kitchen equipment changes require another visit.';
const input = () => ({ reason, requestKey: randomUUID() });
async function fixture(status = 'completed', extra: Record<string, unknown> = {}) {
  const id = ++fixtureId;
  await connection.execute(sql`INSERT INTO users(id) VALUES(${id})`);
  const [tour] = await connection.insert(kitchenViewings).values({ chefId: id, locationId: id, targetedKitchenId: id,
    status, scheduledAt: new Date(Date.now() - 3600000), durationMinutes: 30,
    visitEvidenceState: 'ready', updatedAt: new Date(), ...extra }).returning();
  return tour;
}
const access = (tour: any) => readTourRequestAccess(connection, tour.chefId, tour.targetedKitchenId, tour.locationId);
const grant = (tour: any, decision = input()) => connection.transaction((tx: any) => grantRepeatTourPermission(tx, tour, 9, decision));
async function request(tour: any, failDelivery = false, chefLocked?: () => void) {
  return connection.transaction(async (tx: any) => {
    // The booking route serializes against application creation and other kitchen operations.
    await tx.execute(sql`SELECT id FROM users WHERE id=${tour.chefId} FOR NO KEY UPDATE`);
    chefLocked?.();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tour.targetedKitchenId}, 0)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tour.targetedKitchenId}, 7)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(0, ${tour.targetedKitchenId})`);
    const allowed = await readTourRequestAccess(tx, tour.chefId, tour.targetedKitchenId, tour.locationId);
    requireTourRequestAccess(allowed);
    const [next] = await tx.insert(kitchenViewings).values({ chefId: tour.chefId, locationId: tour.locationId,
      targetedKitchenId: tour.targetedKitchenId, status: 'pending_local_cooks', scheduledAt: new Date(Date.now() + 86400000),
      durationMinutes: 30, repeatAuthorizationId: allowed.authorization?.id, updatedAt: new Date() }).returning();
    await useRepeatTourPermission(tx, allowed, next.id);
    if (failDelivery) throw Error('Fixture outbox failure');
    return next;
  });
}
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE SCHEMA "${namespace}"`); created = true;
  await admin.query(`SET search_path TO "${namespace}"`);
  await admin.query('CREATE TABLE users(id integer PRIMARY KEY); CREATE TABLE chef_kitchen_applications(id serial PRIMARY KEY,chef_id integer,location_id integer); CREATE TABLE fixture_notifications(chef_id integer REFERENCES users(id))');
  const columns = getTableConfig(kitchenViewings).columns.filter(column => column.name !== 'repeat_authorization_id').map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}`;
  });
  await admin.query(`CREATE TABLE kitchen_viewings(${columns.join(',')})`);
});
afterAll(async () => {
  try { await pool.end(); if (created) { await admin.query('ROLLBACK; RESET search_path'); await admin.query(`DROP SCHEMA "${namespace}" CASCADE`); } }
  finally { await admin.end(); }
});

it('replays migration 0070 without inventing past permissions', async () => {
  const migration = readFileSync('migrations/0070_tour_repeat_authorizations.sql', 'utf8');
  await admin.query(migration); await admin.query(migration);
  expect((await admin.query('SELECT count(*)::int AS count FROM tour_repeat_authorizations')).rows[0].count).toBe(0);
});
it('denies Supabase API roles table and sequence access while the trusted backend retains access', async () => {
  const security = (await admin.query("SELECT relrowsecurity FROM pg_class WHERE oid='tour_repeat_authorizations'::regclass")).rows[0];
  expect(security.relrowsecurity).toBe(true);
  const roles = (await admin.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname")).rows;
  for (const { rolname } of roles) {
    // Grant only namespace visibility, so failures must come from table/sequence protection.
    await admin.query(`GRANT USAGE ON SCHEMA "${namespace}" TO "${rolname}"`);
    const api = await pool.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SET LOCAL ROLE "${rolname}"`);
      for (const statement of [
        'SELECT * FROM tour_repeat_authorizations',
        'INSERT INTO tour_repeat_authorizations DEFAULT VALUES',
        "UPDATE tour_repeat_authorizations SET reason='Forged API decision' WHERE id=-1",
        'DELETE FROM tour_repeat_authorizations WHERE id=-1',
        'TRUNCATE tour_repeat_authorizations',
        "SELECT nextval('tour_repeat_authorizations_id_seq')",
      ]) {
        await api.query('SAVEPOINT api_permission_check');
        await expect(api.query(statement)).rejects.toMatchObject({ code: '42501' });
        await api.query('ROLLBACK TO SAVEPOINT api_permission_check');
      }
    } finally { await api.query('ROLLBACK'); api.release(); }
  }
  if (process.env.LIFECYCLE_TEST_REQUIRE_SUPABASE_API_ROLES === 'true') expect(roles).toHaveLength(2);
  const tour = await fixture(), permission = await grant(tour);
  expect(await access(tour)).toMatchObject({ canRequest: true, authorization: { id: permission.id } });
});
it('blocks ended and unverified tours and scopes access to the exact chef and kitchen', async () => {
  const tour = await fixture('confirmed');
  expect(await access(tour)).toMatchObject({ canRequest: false, reason: 'ended', tour: { id: tour.id } });
  expect(await readTourRequestAccess(connection, tour.chefId + 1, tour.targetedKitchenId, tour.locationId)).toMatchObject({ canRequest: true, tour: null });
  expect(await readTourRequestAccess(connection, tour.chefId, tour.targetedKitchenId + 1, tour.locationId)).toMatchObject({ canRequest: true, tour: null });
  const unknown = await fixture('cancelled', { disruptionReason: 'outcome_unknown' });
  expect(await access(unknown)).toMatchObject({ canRequest: false, reason: 'unverified' });
  await connection.update(kitchenViewings).set({ disruptionReason: 'access_unavailable' }).where(eq(kitchenViewings.id, unknown.id));
  expect(await access(unknown)).toMatchObject({ canRequest: true, tour: { kind: 'failed' } });
});
it('requires an explained decision, permits an idempotent retry and keeps admin reasons private', async () => {
  const tour = await fixture(), decision = input();
  await expect(grant(tour, { ...decision, reason: 'short' })).rejects.toMatchObject({ statusCode: 400 });
  const permission = await grant(tour, decision);
  expect((await grant(tour, decision)).id).toBe(permission.id);
  await expect(grant(tour, { ...decision, reason: reason + ' Different decision.' })).rejects.toMatchObject({ statusCode: 409 });
  expect(permission.expiresAt.getTime() - permission.grantedAt.getTime()).toBe(30 * 86400000);
  const allowed = await access(tour);
  expect(allowed).toMatchObject({ canRequest: true, authorization: { id: permission.id, recovery: false } });
  expect(JSON.stringify(allowed)).not.toContain(reason);
});
it('application restrictions prevent both granting and using permission', async () => {
  const tour = await fixture(); await grant(tour);
  await connection.execute(sql`INSERT INTO chef_kitchen_applications(chef_id,location_id) VALUES(${tour.chefId},${tour.locationId})`);
  expect(await access(tour)).toMatchObject({ canRequest: false, reason: 'application', authorization: null });
  await expect(grant(tour)).rejects.toMatchObject({ statusCode: 409 });
  await expect(request(tour)).rejects.toMatchObject({ statusCode: 409 });
});
it('rolls back the request and permission usage together when delivery intent cannot be saved', async () => {
  const tour = await fixture(), permission = await grant(tour);
  await expect(request(tour, true)).rejects.toThrow('Fixture outbox failure');
  const [unchanged] = await connection.select().from(tourRepeatAuthorizations).where(eq(tourRepeatAuthorizations.id, permission.id));
  expect(unchanged.usedAt).toBeNull(); expect(await access(tour)).toMatchObject({ canRequest: true });
  expect((await connection.select().from(kitchenViewings).where(eq(kitchenViewings.chefId, tour.chefId)))).toHaveLength(1);
});
it('allows only one concurrent request and keeps failed approved attempts recoverable', async () => {
  const tour = await fixture(); const permission = await grant(tour);
  const outcomes = await Promise.allSettled([request(tour), request(tour)]);
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1);
  const first = (outcomes.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  expect(first.repeatAuthorizationId).toBe(permission.id);
  await connection.update(kitchenViewings).set({ status: 'cancelled' }).where(eq(kitchenViewings.id, first.id));
  expect(await access(tour)).toMatchObject({ canRequest: true, authorization: { id: permission.id, recovery: true } });
  const second = await request(tour);
  await connection.update(kitchenViewings).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(kitchenViewings.id, second.id));
  expect(await access(tour)).toMatchObject({ canRequest: true }); // Expired before the worker persists cancellation.
  const third = await request(tour);
  await connection.update(kitchenViewings).set({ status: 'completed' }).where(eq(kitchenViewings.id, third.id));
  expect(await access(tour)).toMatchObject({ canRequest: false, reason: 'completed', tour: { id: third.id } });
});
it('an unverified repeat needs a new decision and cannot reuse its original permission', async () => {
  const tour = await fixture(); await grant(tour); const repeat = await request(tour);
  await connection.update(kitchenViewings).set({ status: 'cancelled', disruptionReason: 'outcome_unknown' }).where(eq(kitchenViewings.id, repeat.id));
  expect(await access(tour)).toMatchObject({ canRequest: false, reason: 'unverified', tour: { id: repeat.id } });
  await expect(grant(tour)).rejects.toMatchObject({ statusCode: 409 });
  await grant({ ...repeat, status: 'cancelled', disruptionReason: 'outcome_unknown', visitEvidenceState: 'ready' });
  expect(await access(tour)).toMatchObject({ canRequest: true });
});
it('revokes only unused permissions belonging to the chosen tour and preserves the audit record', async () => {
  const tour = await fixture(), permission = await grant(tour), other = await fixture();
  await expect(connection.transaction((tx: any) => revokeRepeatTourPermission(tx, other, permission.id, 9, reason))).rejects.toMatchObject({ statusCode: 404 });
  await connection.transaction((tx: any) => revokeRepeatTourPermission(tx, tour, permission.id, 9, reason));
  expect(await access(tour)).toMatchObject({ canRequest: false });
  await expect(connection.update(tourRepeatAuthorizations).set({ revokedAt: null, revokedBy: null, revokeReason: null }).where(eq(tourRepeatAuthorizations.id, permission.id))).rejects.toThrow();
  await expect(connection.delete(tourRepeatAuthorizations).where(eq(tourRepeatAuthorizations.id, permission.id))).rejects.toThrow();
  const replacement = await grant(tour); await request(tour);
  await expect(connection.transaction((tx: any) => revokeRepeatTourPermission(tx, tour, replacement.id, 9, reason))).rejects.toMatchObject({ statusCode: 409 });
});
it('an expired permission cannot be consumed, even with an earlier eligible access snapshot', async () => {
  const tour = await fixture();
  const [expired] = await connection.insert(tourRepeatAuthorizations).values({ sourceTourId: tour.id, sourceVersion: tour.updatedAt.toISOString(),
    requestKey: randomUUID(), grantedBy: 9, reason, grantedAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() - 1000) }).returning();
  expect(await access(tour)).toMatchObject({ canRequest: false });
  await expect(connection.transaction((tx: any) => useRepeatTourPermission(tx, { canRequest: true, reason: null, tour: null,
    authorization: { id: expired.id, expiresAt: expired.expiresAt.toISOString(), recovery: false } }, tour.id))).rejects.toMatchObject({ statusCode: 409 });
  const replacement = await grant(tour);
  expect(replacement.id).not.toBe(expired.id);
  const [old] = await connection.select().from(tourRepeatAuthorizations).where(eq(tourRepeatAuthorizations.id, expired.id));
  expect(old.revokedBy).toBe(9);
});
it('does not deadlock existing tour notification writes while a new request waits for the kitchen', async () => {
  const tour = await fixture(); await grant(tour);
  const owner = await pool.connect();
  let booking: Promise<any> | undefined;
  try {
    await owner.query('BEGIN');
    await owner.query("SET LOCAL lock_timeout TO '1000'");
    await owner.query('SELECT pg_advisory_xact_lock($1,0)', [tour.targetedKitchenId]);
    let chefLocked!: () => void;
    const locked = new Promise<void>(resolve => { chefLocked = resolve; });
    booking = request(tour, false, chefLocked);
    await locked;
    // Existing status/feedback transactions hold the kitchen lock and insert notifications.
    await owner.query('INSERT INTO fixture_notifications(chef_id) VALUES($1)', [tour.chefId]);
    await owner.query('COMMIT');
    expect((await booking).chefId).toBe(tour.chefId);
  } finally { await owner.query('ROLLBACK'); owner.release(); await booking?.catch(() => {}); }
});
it('an application committed under the chef lock prevents a concurrent authorized repeat', async () => {
  const tour = await fixture(); await grant(tour);
  const applicant = await pool.connect();
  let booking: Promise<any> | undefined;
  try {
    await applicant.query('BEGIN');
    await applicant.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [tour.chefId]);
    booking = request(tour);
    const rejected = expect(booking).rejects.toMatchObject({ statusCode: 409, details: { reason: 'application' } });
    await applicant.query('INSERT INTO chef_kitchen_applications(chef_id,location_id) VALUES($1,$2)', [tour.chefId, tour.locationId]);
    await applicant.query('COMMIT');
    await rejected;
  } finally { await applicant.query('ROLLBACK'); applicant.release(); await booking?.catch(() => {}); }
});
