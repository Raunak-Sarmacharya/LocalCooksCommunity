import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { chefKitchenApplications, kitchenViewings, kitchens, locations, tourVisitEvents, chefLocationAccess } from '@shared/schema';

const state = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('../../db', () => ({ getDbError: () => ({}), db: new Proxy({}, {
  get: (_target, property) => typeof state.db[property] === 'function' ? state.db[property].bind(state.db) : state.db[property],
}) }));
import { ChefApplicationService } from './chef-application.service';

const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY')
  throw Error('Explicit authorized disposable PostgreSQL test URL and isolation acknowledgement required');
const endpoint = new URL(url);
if (endpoint.hostname.endsWith('.pooler.supabase.com') && endpoint.port === '6543')
  throw Error('Use a direct or session-pool endpoint; transaction pooling cannot preserve the isolated test search path');
const namespace = `tour_apps_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000, max: 3,
  options: `-c search_path=${namespace} -c lock_timeout=10000 -c statement_timeout=15000` });
const service = new ChefApplicationService();
let created = false;

// Reproduce every Drizzle-selected column without unrelated live schema or data.
function fixtureTable(table: any, omitSource = false) {
  const config = getTableConfig(table);
  const columns = config.columns.filter(column => !omitSource || column.name !== 'source_tour_id').map(column => {
    const type = column.getSQLType();
    const scalarType = /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text';
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : scalarType}`;
  });
  return `CREATE TABLE "${config.name}" (${columns.join(',')}${omitSource ? ', UNIQUE(chef_id,location_id)' : ''})`;
}

const answers = (chefId: number) => ({ chefId, locationId: 5, fullName: 'Isolated chef', email: 'fixture@example.test',
  phone: '+17095550123', shopName: 'Fixture business', shopAddress: 'Fixture address', kitchenPreference: 'commercial' as const,
  foodSafetyLicense: 'no' as const, foodEstablishmentCert: 'no' as const });

beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE SCHEMA "${namespace}"`); created = true;
  await admin.query(`SET search_path TO "${namespace}"`);
  await admin.query('CREATE TABLE users(id integer PRIMARY KEY,role text)');
  await admin.query(fixtureTable(kitchenViewings));
  await admin.query(fixtureTable(chefKitchenApplications, true));
  for (const table of [kitchens, locations, tourVisitEvents, chefLocationAccess]) await admin.query(fixtureTable(table));
  await admin.query("INSERT INTO users VALUES(3,'chef'),(4,'chef'),(6,'chef'),(7,'chef'),(8,'chef')");
  await admin.query("INSERT INTO locations(id,is_active,kitchen_license_url,kitchen_license_status,kitchen_license_expiry) VALUES(5,true,'fixture.pdf','approved','2099-01-01')");
  await admin.query("INSERT INTO kitchens(id,location_id,is_active,listing_status) VALUES(50,5,true,'active')");
  await admin.query(`INSERT INTO kitchen_viewings(id,chef_id,location_id,status,scheduled_at,lifecycle_state,visit_result,
    confirmation_verified,visit_evidence_state,visit_evidence_migrated_at,appointment_revision) VALUES
    (20,3,5,'completed','2020-01-01','ended','completed',true,'ready','2020-01-06',1),
    (21,3,5,'completed','2020-01-03','ended','completed',true,'ready','2020-01-06',1),
    (27,3,5,'completed','2020-01-02','ended','completed',true,'ready','2020-01-06',1),
    (28,3,5,'completed','2020-01-03','ended','completed',true,'ready','2020-01-06',1),
    (22,4,5,'completed','2020-01-02','ended','completed',true,'ready','2020-01-06',1),
    (24,4,5,'completed','2020-01-01','ended','completed',true,'ready','2020-01-06',1),
    (23,6,5,'confirmed','2099-01-03','confirmed',null,true,'ready','2020-01-06',1),
    (29,8,5,'confirmed','2020-01-03','confirmed',null,true,'ready','2020-01-06',1),
    (25,7,5,'completed','2020-01-01','ended','completed',true,'ready','2020-01-06',1),
    (26,7,5,'completed','2020-01-03','ended','completed',true,'ready','2020-01-06',1)`);
  await admin.query('UPDATE kitchen_viewings SET duration_minutes=30');
  await admin.query(`INSERT INTO tour_visit_events(viewing_id,kind,actor_id,actor_role,source,recorded_at,scheduled_at,appointment_revision,result)
    SELECT id,'result',2,'manager','decision','2020-01-05',scheduled_at,1,'completed' FROM kitchen_viewings WHERE status='completed' AND id<>26`);
  state.db = drizzle(pool);
});
afterAll(async () => {
  try {
    await pool.end();
    if (created) {
      await admin.query('ROLLBACK; RESET search_path');
      await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
    }
  } finally { await admin.end(); }
});

it('replays migration without guessed attribution and enforces source referential integrity', async () => {
  await admin.query("INSERT INTO chef_kitchen_applications(chef_id,location_id) VALUES(99,5)");
  const migration = readFileSync('migrations/0068_tour_application_attribution.sql', 'utf8');
  await admin.query(migration); await admin.query(migration);
  expect((await admin.query('SELECT source_tour_id FROM chef_kitchen_applications WHERE chef_id=99')).rows[0].source_tour_id).toBeNull();
  await expect(admin.query('UPDATE chef_kitchen_applications SET source_tour_id=999 WHERE chef_id=99')).rejects.toMatchObject({ code: '23503' });
});

it('concurrent generic and old-tour entry points select the same latest visit by schedule then id', async () => {
  const applications = await Promise.all([service.createApplication(answers(3)), service.createApplication(answers(3), { sourceTourId: 20 })]);
  expect(applications[0].id).toBe(applications[1].id);
  expect(applications[0].sourceTourId).toBe(applications[1].sourceTourId);
  expect(applications[0].sourceTourId).toBe(28);
  expect((await admin.query('SELECT count(*)::int AS count FROM chef_kitchen_applications WHERE chef_id=3')).rows[0].count).toBe(1);
  await expect(admin.query('DELETE FROM kitchen_viewings WHERE id=$1', [applications[0].sourceTourId])).rejects.toMatchObject({ code: '23503' });
});

it('reads a corrected latest outcome after the tour row lock and attributes the latest qualifying prior visit', async () => {
  await admin.query('BEGIN'); await admin.query("UPDATE kitchen_viewings SET status='no_show',visit_result='visitor_absent' WHERE id=22");
  await admin.query(`INSERT INTO tour_visit_events(viewing_id,kind,supersedes_id,actor_id,actor_role,source,recorded_at,scheduled_at,appointment_revision,result,shared_explanation)
    SELECT 22,'result',id,2,'admin','correction','2020-01-06',scheduled_at,1,'visitor_absent','Visitor absence verified after review' FROM tour_visit_events WHERE viewing_id=22`);
  const submission = service.createApplication(answers(4), { sourceTourId: 22 });
  await admin.query('COMMIT');
  expect((await submission).sourceTourId).toBe(24);
  expect((await admin.query('SELECT count(*)::int AS count FROM chef_kitchen_applications WHERE chef_id=4')).rows[0].count).toBe(1);
});

it('a later completed visit cannot attribute an application first created through the ordinary flow', async () => {
  const first = await service.createApplication(answers(6));
  expect(first.sourceTourId).toBeNull();
  await admin.query("UPDATE kitchen_viewings SET status='completed',visit_result='completed',lifecycle_state='ended',scheduled_at='2020-01-03' WHERE id=23");
  await admin.query(`INSERT INTO tour_visit_events(viewing_id,kind,actor_id,actor_role,source,recorded_at,scheduled_at,appointment_revision,result)
    SELECT id,'result',2,'manager','decision','2020-01-05',scheduled_at,1,'completed' FROM kitchen_viewings WHERE id=23`);
  const repeat = await service.createApplication(answers(6), { sourceTourId: 23 });
  expect(first.id).toBe(repeat.id); expect(repeat.sourceTourId).toBeNull();
});

it('falls back from a newer scalar completion without authoritative result evidence', async () => {
  expect((await service.createApplication(answers(7))).sourceTourId).toBe(25);
});

it('ordinary and tour links preserve a provisional source before admin outcome review', async () => {
  const created = await service.createApplication(answers(8));
  expect(created.sourceTourId).toBe(29);
  await admin.query("UPDATE kitchen_viewings SET status='completed',visit_result='completed',lifecycle_state='ended' WHERE id=29");
  await admin.query(`INSERT INTO tour_visit_events(viewing_id,kind,actor_id,actor_role,source,recorded_at,scheduled_at,appointment_revision,result,shared_explanation)
    SELECT id,'result',2,'admin','decision',CURRENT_TIMESTAMP,scheduled_at,1,'completed','Both feedback responses were reviewed.' FROM kitchen_viewings WHERE id=29`);
  const repeated = await service.createApplication(answers(8), {sourceTourId:29});
  expect(repeated.id).toBe(created.id); expect(repeated.sourceTourId).toBe(29);
});
