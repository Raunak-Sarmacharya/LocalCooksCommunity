import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { is, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, PgEnumColumn, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import { anonymizedUsername, deleteUserDependents, getUserDeletionImpact } from './user-deletion.service';
import { UserService } from './user.service';
import { DeletionBlockedError } from '../../services/deletion-guard';
import { KitchenRepository } from '../kitchens/kitchen.repository';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
const harness = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../db', () => ({ db: new Proxy({}, { get: (_target, key) => harness.db[key] }) }));
const service = new UserService();
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const dialect = new PgDialect();
let client: PGlite;
let database: ReturnType<typeof drizzle>;
let tables: string[] = [];
const columns = new Map<string, any[]>();
const fixtureId = new Map<string, number>();
const migration = () => readFileSync('migrations/0071_complete_user_deletion.sql', 'utf8');

function columnDefault(column: any): string {
  if (!column.hasDefault || column.default === undefined) return '';
  const value = column.default;
  if (is(value, SQL)) return ` DEFAULT ${dialect.sqlToQuery(value).sql.replace(/\$\d+/g, 'NULL')}`;
  if (value === null) return ' DEFAULT NULL';
  if (typeof value === 'string') return ` DEFAULT '${value.replace(/'/g, "''")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return ` DEFAULT ${value}`;
  if (Array.isArray(value)) {
    const type = column.getSQLType();
    if (type === 'jsonb' || type === 'json') return ` DEFAULT '${JSON.stringify(value)}'::${type}`;
    return ' DEFAULT \'{}\'';
  }
  if (typeof value === 'object') return ` DEFAULT '${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return '';
}

/** Current Drizzle schema, which already includes migrations 0091–0093, plus the deletion triggers those rows must satisfy. */
async function createCurrentSchema(db: PGlite) {
  const models = Object.values(schema).filter((value) => value instanceof PgTable) as PgTable[];
  const enums = new Map<string, readonly string[]>();
  for (const table of models) for (const column of getTableConfig(table).columns) if (is(column, PgEnumColumn)) enums.set(column.enum.enumName, column.enum.enumValues);
  for (const [name, values] of Array.from(enums.entries())) await db.exec(`CREATE TYPE ${quote(name)} AS ENUM (${values.map(value => `'${value.replace(/'/g, "''")}'`).join(', ')})`);
  for (const table of models) {
    const config = getTableConfig(table);
    const defs = config.columns.map(column => {
      const type = column.getSQLType();
      const serial = /^(big)?serial$/.test(type);
      return `${quote(column.name)} ${type}${serial || !column.notNull ? '' : ' NOT NULL'}${serial ? '' : columnDefault(column)}${column.primary ? ' PRIMARY KEY' : ''}${!column.primary && column.isUnique ? ' UNIQUE' : ''}`;
    });
    await db.exec(`CREATE TABLE ${quote(config.name)} (${defs.join(', ')})`);
  }
  for (const table of models) {
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const cols = ref.columns.map(column => quote(column.name)).join(', ');
      const parentCols = ref.foreignColumns.map(column => quote(column.name)).join(', ');
      const parent = getTableConfig(ref.foreignTable).name;
      const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : '';
      await db.exec(`ALTER TABLE ${quote(config.name)} ADD CONSTRAINT ${quote(fk.getName())} FOREIGN KEY (${cols}) REFERENCES ${quote(parent)} (${parentCols})${onDelete}`);
    }
  }
  // Tables the deletion service touches that are not in the Drizzle schema. manager_notifications.location_id
  // must be a real FK before migration 0071 rewrites it.
  await db.exec(`
    CREATE TABLE session (sid varchar PRIMARY KEY, sess jsonb NOT NULL, expire timestamp NOT NULL);
    CREATE TABLE unsubscribe_requests (id serial PRIMARY KEY, email text NOT NULL);
    CREATE TABLE password_reset_tokens (id serial PRIMARY KEY, user_id integer, token text, expires_at timestamptz);
    CREATE TABLE chef_notifications (id serial PRIMARY KEY, chef_id integer, type text, priority text, title text, message text, metadata jsonb);
    CREATE TABLE manager_notifications (
      id serial PRIMARY KEY, manager_id integer, location_id integer REFERENCES locations(id),
      type text, priority text, title text, message text, metadata jsonb);
    -- Legacy storage tables: still on dev and production until migration 0094 (applied last), gone from the Drizzle schema.
    CREATE TABLE storage_overstay_quotes (id text PRIMARY KEY, chef_id integer NOT NULL REFERENCES users(id),
      storage_listing_id integer NOT NULL REFERENCES storage_listings(id));
    CREATE TABLE pending_storage_extensions (id serial PRIMARY KEY, manager_id integer REFERENCES users(id) ON DELETE CASCADE);
  `);
  await db.exec(migration());
  const validator = readFileSync('migrations/0067_tour_visit_events.sql', 'utf8').match(/CREATE OR REPLACE FUNCTION validate_tour_visit_successor\(\)[\s\S]*?END \$\$;/)?.[0];
  if (!validator) throw new Error('Missing visit successor validator');
  await db.exec(validator);
  await db.exec(`
    CREATE TRIGGER tour_visit_events_immutable BEFORE UPDATE OR DELETE ON tour_visit_events FOR EACH ROW EXECUTE FUNCTION protect_tour_visit_event();
    CREATE TRIGGER tour_visit_events_successor BEFORE INSERT ON tour_visit_events FOR EACH ROW EXECUTE FUNCTION validate_tour_visit_successor();
    CREATE TRIGGER tour_repeat_authorization_audit BEFORE UPDATE OR DELETE ON tour_repeat_authorizations FOR EACH ROW EXECUTE FUNCTION guard_tour_repeat_authorization();
  `);
  await db.exec(readFileSync('migrations/0089_deletion_safety.sql', 'utf8'));
  // Published cancellation policies are immutable (0080); 0113 lets a no-booking kitchen's versions go with it.
  const policyTrigger = readFileSync('migrations/0080_cancellation_policies.sql', 'utf8')
    .match(/CREATE FUNCTION protect_published_cancellation_policy\(\)[\s\S]*?EXECUTE FUNCTION protect_published_cancellation_policy\(\);/)?.[0];
  if (!policyTrigger) throw new Error('Missing cancellation policy trigger');
  await db.exec(policyTrigger);
  await db.exec(readFileSync('migrations/0113_delete_kitchen_policy_versions.sql', 'utf8'));
  await db.exec(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
  await db.exec(`ALTER TABLE storage_bookings ADD CONSTRAINT storage_unit_no_overlap
    EXCLUDE USING gist (storage_listing_id WITH =, unit_index WITH =, occupancy WITH &&)
    WHERE (rental_state IN ('requested','reserved','active','move_out_requested','removal_review') OR needs_cleaning)`);
  await db.exec(`ALTER TABLE customer_notes ADD CONSTRAINT customer_notes_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)`);
  // Live since 0045, omitted from the Drizzle mirror. The deletion service still clears it.
  await db.exec(`ALTER TABLE locations ADD COLUMN kitchen_license_reviewed_by integer`);
}

beforeAll(async () => {
  client = new PGlite({ extensions: { btree_gist } });
  await createCurrentSchema(client);
  database = drizzle(client, { schema });
  harness.db = { transaction: async (callback: any) => {
    await client.query<any>('SAVEPOINT deletion');
    try { const result = await callback(database); await client.query<any>('RELEASE SAVEPOINT deletion'); return result; }
    catch (error) { await client.query<any>('ROLLBACK TO SAVEPOINT deletion'); throw error; }
  } };
  const present = await client.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'kitchen_invitations' AND column_name = 'booking_id')
      OR (table_name = 'kitchen_invitation_events' AND column_name = 'actor_id')
      OR (table_name = 'customer_notes' AND column_name = 'chef_id')
      OR (table_name = 'storage_bookings' AND column_name = 'rental_state')
      OR (table_name = 'storage_rental_terms' AND column_name = 'rental_id'))`);
  expect(present.rows).toHaveLength(5);
  expect((await client.query<any>(`SELECT 1 FROM pg_constraint WHERE conname = 'storage_unit_no_overlap'`)).rows).toHaveLength(1);
  tables = (await client.query<{ relname: string }>("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname")).rows.map(row => row.relname);
  const allColumns = (await client.query<any>(`SELECT r.relname AS table_name,a.attname AS name,a.attnotnull AS required,format_type(a.atttypid,a.atttypmod) AS type,
    pg_get_expr(d.adbin,d.adrelid) AS default_value,(SELECT enumlabel FROM pg_enum WHERE enumtypid=a.atttypid ORDER BY enumsortorder LIMIT 1) AS enum_value
    FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE r.relnamespace='public'::regnamespace AND r.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY r.relname,a.attnum`)).rows;
  for (const table of tables) columns.set(table, allColumns.filter(column => column.table_name === table));
  await client.exec('BEGIN');
});

beforeEach(async () => { fixtureId.clear(); await client.exec('SAVEPOINT fixture'); });
afterEach(async () => { await client.exec('ROLLBACK TO SAVEPOINT fixture'); });
afterAll(async () => {
  try { await client?.exec('ROLLBACK'); } finally { await client?.close(); }
});

async function insert(table: string, values: Record<string, any>) {
  const fields = { ...values };
  for (const column of columns.get(table) ?? []) {
    if (fields[column.name] !== undefined || !column.required || column.default_value) continue;
    if (column.name === 'id') fields.id = (fixtureId.get(table) ?? 1000) + 1;
    else if (column.enum_value) fields[column.name] = column.enum_value;
    else if (column.type === 'date') fields[column.name] = '2026-10-20';
    else if (column.type.includes('timestamp')) fields[column.name] = '2026-10-08T12:00:00Z';
    else if (column.type === 'jsonb' || column.type === 'json') fields[column.name] = {};
    else if (column.type.endsWith('[]')) fields[column.name] = [];
    else if (column.type === 'boolean') fields[column.name] = false;
    else if (/integer|numeric|smallint|bigint/.test(column.type)) fields[column.name] = 1;
    else fields[column.name] = `fixture ${column.name}`;
  }
  if (typeof fields.id === 'number') fixtureId.set(table, fields.id);
  const names = Object.keys(fields);
  const result = await client.query<any>(`INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`, names.map(n=>typeof fields[n]==='object' && !(fields[n] instanceof Date) ? JSON.stringify(fields[n]) : fields[n]));
  return result.rows[0];
}
async function seed() {
  for (const [id,role] of [[1,'manager'],[2,'manager'],[3,'chef'],[4,'admin']] as const)
    await insert('users',{id,role,username:`user${id}@fixture.invalid`,password:'fixture',firebase_uid:`uid-${id}`});
  await insert('locations',{id:10,manager_id:1,name:'Deleted business',address:'Fixture'});
  await insert('locations',{id:20,manager_id:2,name:'Surviving business',address:'Fixture'});
  await insert('kitchens',{id:11,location_id:10,name:'Deleted kitchen'});
  await insert('kitchens',{id:21,location_id:20,name:'Surviving kitchen'});
  await insert('kitchen_bookings',{id:100,kitchen_id:11,chef_id:3,created_by:3,start_time:'09:00',end_time:'10:00'});
  await insert('kitchen_bookings',{id:200,kitchen_id:21,chef_id:3,created_by:3,checkout_approved_by:1,start_time:'09:00',end_time:'10:00'});
  await insert('kitchen_booking_visits',{id:101,booking_id:100,block_index:0,start_time:'09:00',end_time:'10:00'});
  await insert('kitchen_booking_visits',{id:201,booking_id:200,block_index:0,checkout_approved_by:1,start_time:'09:00',end_time:'10:00'});
  await insert('kitchen_viewings',{id:110,location_id:10,chef_id:3});
  await insert('kitchen_viewings',{id:210,location_id:20,chef_id:3});
}
const count = async (table: string, where='true') => Number((await client.query<any>(`SELECT count(*) FROM ${quote(table)} WHERE ${where}`)).rows[0].count);

async function invitation(values: Record<string, any>) {
  return insert('kitchen_invitations', {
    request_key: `req-${values.id}`, date: '2026-10-20', start_time: '09:00', end_time: '10:00',
    operating_window_start_time: '09:00', timezone: 'America/St_Johns', pricing_mode: 'hourly', selected_slots: [],
    list_subtotal_cents: 1000, offered_subtotal_cents: 800, tax_cents: 0, service_fee_cents: 0, total_cents: 800,
    manager_estimated_payout_cents: 800, cancellation_policy_hours: 24, cancellation_charge_percent: 0,
    expires_in_hours: 48, expires_at: '2026-10-22T12:00:00Z', status: 'sent', ...values,
  });
}
async function invitationEvent(invitationId: string, actorId: number) {
  return insert('kitchen_invitation_events', { invitation_id: invitationId, kind: 'sent', version: 1, actor_id: actorId, actor_role: 'manager' });
}

it('replays the migration and removes manager resources plus all new blockers while preserving other businesses', async () => {
  await seed();
  await client.exec(migration());
  await insert('kitchen_booking_attendance_events',{booking_id:100,visit_id:101,actor_id:4,actor_role:'admin',action:'report_attended'});
  await insert('booking_lifecycle_events',{booking_id:100,actor_id:4,kind:'cancelled'});
  await insert('commitment_problems',{source_key:'owned',kind:'live',viewing_id:110,kitchen_id:11,reported_by:1});
  await insert('commitment_problems',{source_key:'other',kind:'live',viewing_id:210,kitchen_id:21,reported_by:3,claimed_by:1});
  await insert('kitchen_booking_changes',{id:'change',booking_id:100,request_key:'request',kind:'move',state:'requested',manager_id:1});
  await insert('storage_listings',{id:120,kitchen_id:11});
  await insert('storage_overstay_quotes',{id:'quote',chef_id:3,storage_listing_id:120});
  await insert('payment_transactions',{booking_id:100,booking_type:'kitchen',chef_id:3,manager_id:1});
  await insert('chef_notifications',{chef_id:3,type:'booking_confirmed',priority:'normal',title:'Owned booking',message:'Removed',metadata:{bookingId:100}});
  await insert('chef_notifications',{chef_id:3,type:'booking_confirmed',priority:'normal',title:'Other booking',message:'Keep',metadata:{bookingId:200}});
  await insert('email_logs',{recipient_email:'user3@fixture.invalid',recipient_user_id:3,recipient_role:'chef',subject:'Owned reminder',category:'advance_reminder',status:'scheduled',tracking_id:'advance:booking:100:kitchen:arrival:3:email:1'});
  await insert('platform_settings',{key:'keep',value:'yes',updated_by:1});
  const preview = await getUserDeletionImpact(database,1);
  expect(preview).toMatchObject({locations:1,kitchens:1,kitchen_bookings:1,commitment_problems:1,payment_transactions:1});
  const deleted = await deleteUserDependents(database,1);
  await client.query<any>('DELETE FROM users WHERE id=1');
  expect(deleted).toMatchObject({locations:1,kitchens:1,kitchen_bookings:1,commitment_problems:1,payment_transactions:1});
  for (const table of ['kitchen_booking_attendance_events','booking_lifecycle_events','kitchen_booking_changes','storage_overstay_quotes','payment_transactions']) expect(await count(table)).toBe(0);
  expect(await count('chef_notifications')).toBe(1); expect(await count('email_logs')).toBe(0);
  expect(await count('locations')).toBe(1); expect(await count('kitchens')).toBe(1); expect(await count('kitchen_bookings')).toBe(1);
  expect((await client.query<any>('SELECT checkout_approved_by FROM kitchen_bookings WHERE id=200')).rows[0].checkout_approved_by).toBeNull();
  expect((await client.query<any>('SELECT claimed_by FROM commitment_problems')).rows[0].claimed_by).toBeNull();
  expect((await client.query<any>('SELECT value,updated_by FROM platform_settings')).rows[0]).toEqual({value:'yes',updated_by:null});
});

it('removes chef activity, quotes, attendance and restrictive tour dependencies', async () => {
  await seed();
  await insert('storage_listings',{id:120,kitchen_id:11});
  await insert('storage_overstay_quotes',{id:'quote',chef_id:3,storage_listing_id:120});
  await insert('kitchen_booking_attendance_events',{booking_id:200,visit_id:201,actor_id:4,actor_role:'admin',action:'report_attended'});
  await insert('booking_lifecycle_events',{booking_id:200,actor_id:3,kind:'cancelled'});
  await insert('commitment_problems',{source_key:'tour',kind:'live',viewing_id:110,reported_by:1});
  await insert('tour_feedback_responses',{viewing_id:110,respondent_id:1,respondent_role:'manager',scheduled_at:'2026-10-08T12:00Z',happened:true});
  await deleteUserDependents(database,3); await client.query<any>('DELETE FROM users WHERE id=3');
  for (const table of ['storage_overstay_quotes','kitchen_bookings','kitchen_booking_visits','kitchen_booking_attendance_events','booking_lifecycle_events','kitchen_viewings','commitment_problems','tour_feedback_responses']) expect(await count(table)).toBe(0);
  expect(await count('locations')).toBe(2); expect(await count('kitchens')).toBe(2);
});

it('allows account-scoped repeat permission cleanup and actor anonymization while keeping audit protections', async () => {
  await seed();
  await insert('tour_repeat_authorizations',{id:400,source_tour_id:110,source_version:'version',request_key:'repeat',granted_by:4,reason:'A verified repeat visit is needed',granted_at:'2026-10-08T10:00Z',expires_at:'2026-10-09T10:00Z',used_at:'2026-10-08T11:00Z',used_by_tour_id:210});
  await client.query<any>('UPDATE kitchen_viewings SET repeat_authorization_id=400 WHERE id=210');
  await insert('tour_visit_events',{id:500,viewing_id:210,kind:'arrival',event_key:'arrival',actor_id:1,source:'manager',actual_at:'2026-10-08T11:00Z',recorded_at:'2026-10-08T12:00Z',scheduled_at:'2026-10-08T12:00Z'});
  await client.query<any>('SAVEPOINT forbidden');
  await expect(client.query<any>('DELETE FROM tour_repeat_authorizations WHERE id=400')).rejects.toThrow('cannot be deleted');
  await client.query<any>('ROLLBACK TO SAVEPOINT forbidden');
  await expect(client.query<any>('UPDATE tour_visit_events SET actor_id=NULL WHERE id=500')).rejects.toThrow('immutable');
  await client.query<any>('ROLLBACK TO SAVEPOINT forbidden');
  await deleteUserDependents(database,1); await client.query<any>('DELETE FROM users WHERE id=1');
  expect(await count('tour_repeat_authorizations')).toBe(0);
  expect((await client.query<any>('SELECT repeat_authorization_id FROM kitchen_viewings WHERE id=210')).rows[0].repeat_authorization_id).toBeNull();
  expect((await client.query<any>('SELECT actor_id,actual_at FROM tour_visit_events WHERE id=500')).rows[0]).toMatchObject({actor_id:null,actual_at:new Date('2026-10-08T11:00Z')});
  await client.query<any>('SAVEPOINT protected');
  await expect(client.query<any>("UPDATE tour_visit_events SET actual_at='2026-10-08T11:01Z' WHERE id=500")).rejects.toThrow('immutable');
  await client.query<any>('ROLLBACK TO SAVEPOINT protected');
});

it('database cascades can remove an owned location with repeat permissions without trigger deadlocks', async () => {
  await seed();
  await insert('tour_repeat_authorizations',{id:400,source_tour_id:110,source_version:'version',request_key:'repeat',granted_by:4,reason:'A verified repeat visit is needed',granted_at:'2026-10-08T10:00Z',expires_at:'2026-10-09T10:00Z'});
  // Migration 0089 keeps bookings, so the kitchen and its booking are removed explicitly. The location
  // delete still cascades the tour, and the repeat-permission trigger must allow that without deadlocking.
  await client.query<any>('DELETE FROM kitchen_bookings WHERE kitchen_id=11');
  await client.query<any>('DELETE FROM kitchens WHERE id=11');
  await client.query<any>('DELETE FROM locations WHERE id=10');
  expect(await count('tour_repeat_authorizations')).toBe(0); expect(await count('kitchens')).toBe(1);
});

it('an account with booking history is anonymized, and retry context commits with the kept records', async () => {
  await seed();
  await invitation({ id: 'inv-open', kitchen_id: 11, location_id: 10, manager_id: 1, chef_id: 3 });
  await invitationEvent('inv-open', 1);
  await invitation({ id: 'inv-booked', kitchen_id: 11, location_id: 10, manager_id: 1, chef_id: 3, booking_id: 100, status: 'confirmed' });
  await invitationEvent('inv-booked', 1);
  await client.query<any>('UPDATE kitchen_bookings SET invitation_id=$1 WHERE id=100', ['inv-booked']);
  await invitation({ id: 'inv-other', kitchen_id: 21, location_id: 20, manager_id: 2, chef_id: 3 });
  await invitationEvent('inv-other', 4);
  await service.deleteUser(1,{enforceObligations:false});
  expect((await client.query<any>('SELECT username,firebase_uid FROM users WHERE id=1')).rows[0])
    .toEqual({ username: anonymizedUsername(1), firebase_uid: null });
  expect((await client.query<any>('SELECT archived_at IS NOT NULL AS archived FROM locations WHERE id=10')).rows[0].archived).toBe(true);
  expect((await client.query<any>('SELECT listing_status, archived_at IS NOT NULL AS archived FROM kitchens WHERE id=11')).rows[0])
    .toEqual({ listing_status: 'draft', archived: true });
  expect(await count('kitchen_bookings','id=100')).toBe(1);
  expect((await client.query<any>('SELECT invitation_id FROM kitchen_bookings WHERE id=100')).rows[0].invitation_id).toBe('inv-booked');
  expect(await count('kitchen_invitations',"id='inv-booked'")).toBe(1);
  expect(await count('kitchen_invitation_events',"invitation_id='inv-booked'")).toBe(1);
  expect(await count('kitchen_invitations',"id='inv-open'")).toBe(0);
  expect(await count('kitchen_invitation_events',"invitation_id='inv-open'")).toBe(0);
  expect(await count('kitchen_invitations',"id='inv-other'")).toBe(1);
  expect((await client.query<any>("SELECT actor_id FROM kitchen_invitation_events WHERE invitation_id='inv-other'")).rows[0].actor_id).toBe(4);
  expect((await client.query<any>('SELECT user_id,firebase_uid,location_ids FROM user_deletion_jobs')).rows[0])
    .toEqual({user_id:1,firebase_uid:'uid-1',location_ids:[]});
  expect((await client.query<any>('SELECT outcome FROM account_deletion_audit WHERE user_id=1')).rows[0].outcome).toBe('anonymized');
  await client.query<any>('SAVEPOINT registration');
  await expect(insert('users',{id:5,username:'new@fixture.invalid',password:'fixture',firebase_uid:'uid-1'}))
    .rejects.toThrow('Account deletion is still in progress');
  await client.query<any>('ROLLBACK TO SAVEPOINT registration');
});

it('open invitations and manager-block invitations do not block deletion, and a kept event only loses its actor', async () => {
  await seed();
  await insert('users',{id:6,role:'chef',username:'user6@fixture.invalid',password:'fixture',firebase_uid:'uid-6'});
  await invitation({ id: 'inv-chef', kitchen_id: 21, location_id: 20, manager_id: 2, chef_id: 6 });
  await invitationEvent('inv-chef', 2);
  await insert('users',{id:7,role:'manager',username:'user7@fixture.invalid',password:'fixture',firebase_uid:'uid-7'});
  await insert('locations',{id:70,manager_id:7,name:'Blocked business',address:'Fixture'});
  await insert('kitchens',{id:71,location_id:70,name:'Blocked kitchen'});
  await insert('kitchen_bookings',{id:700,kitchen_id:71,chef_id:3,created_by:7,booking_type:'manager_blocked',start_time:'09:00',end_time:'10:00'});
  await invitation({ id: 'inv-block', kitchen_id: 71, location_id: 70, manager_id: 7, chef_id: 3, booking_id: 700 });
  await invitationEvent('inv-block', 7);
  await invitation({ id: 'inv-actor', kitchen_id: 21, location_id: 20, manager_id: 2, chef_id: 3, booking_id: 200, status: 'confirmed' });
  await invitationEvent('inv-actor', 4);
  await client.query<any>('UPDATE kitchen_bookings SET invitation_id=$1 WHERE id=200', ['inv-actor']);

  await service.deleteUser(6,{enforceObligations:false});
  expect(await count('users','id=6')).toBe(0);
  expect(await count('kitchen_invitations',"id='inv-chef'")).toBe(0);
  expect(await count('kitchen_invitation_events',"invitation_id='inv-chef'")).toBe(0);
  expect(await count('kitchens','id=21')).toBe(1);
  expect(await count('kitchen_bookings','id=200')).toBe(1);
  expect((await client.query<any>('SELECT user_id,location_ids FROM user_deletion_jobs WHERE user_id=6')).rows[0])
    .toEqual({ user_id: 6, location_ids: [] });

  await service.deleteUser(7,{enforceObligations:false});
  expect(await count('users','id=7')).toBe(0);
  expect(await count('locations','id=70')).toBe(0);
  expect(await count('kitchens','id=71')).toBe(0);
  expect(await count('kitchen_bookings','id=700')).toBe(0);
  expect(await count('kitchen_invitations',"id='inv-block'")).toBe(0);
  expect(await count('kitchen_invitation_events',"invitation_id='inv-block'")).toBe(0);
  expect((await client.query<any>('SELECT location_ids FROM user_deletion_jobs WHERE user_id=7')).rows[0].location_ids).toEqual([70]);

  await service.deleteUser(4,{enforceObligations:false});
  expect(await count('users','id=4')).toBe(0);
  expect(await count('kitchen_invitations',"id='inv-actor'")).toBe(1);
  expect((await client.query<any>("SELECT actor_id FROM kitchen_invitation_events WHERE invitation_id='inv-actor'")).rows[0].actor_id).toBeNull();
  expect((await client.query<any>('SELECT invitation_id FROM kitchen_bookings WHERE id=200')).rows[0].invitation_id).toBe('inv-actor');
});

it('a full dependent purge still removes an invitation linked to a booking it deletes', async () => {
  await seed();
  await invitation({ id: 'inv-open', kitchen_id: 11, location_id: 10, manager_id: 1, chef_id: 3 });
  await invitation({ id: 'inv-booked', kitchen_id: 11, location_id: 10, manager_id: 1, chef_id: 3, booking_id: 100 });
  await invitationEvent('inv-booked', 1);
  await invitation({ id: 'inv-other', kitchen_id: 21, location_id: 20, manager_id: 2, chef_id: 3 });
  await deleteUserDependents(database, 1);
  expect(await count('kitchen_invitations',"id IN ('inv-open','inv-booked')")).toBe(0);
  expect(await count('kitchen_invitation_events',"invitation_id='inv-booked'")).toBe(0);
  expect(await count('kitchen_bookings','id=100')).toBe(0);
  expect(await count('kitchen_invitations',"id='inv-other'")).toBe(1);
});

it('a final FK failure rolls back resources and retry context together', async () => {
  await seed();
  await insert('users',{id:8,role:'manager',username:'user8@fixture.invalid',password:'fixture',firebase_uid:'uid-8'});
  await insert('locations',{id:80,manager_id:8,name:'Rolled back business',address:'Fixture'});
  await insert('kitchens',{id:81,location_id:80,name:'Rolled back kitchen'});
  await client.query<any>('CREATE TABLE unexpected_child(id integer PRIMARY KEY, user_id integer REFERENCES users(id))');
  await client.query<any>('INSERT INTO unexpected_child VALUES(1,8)');
  await expect(service.deleteUser(8,{enforceObligations:false})).rejects.toThrow();
  expect(await count('users','id=8')).toBe(1); expect(await count('locations','id=80')).toBe(1);
  expect(await count('kitchens','id=81')).toBe(1); expect(await count('user_deletion_jobs')).toBe(0);
  expect(await count('account_deletion_audit')).toBe(0);
  expect(await count('kitchen_bookings','id=100')).toBe(1);
});

it('an open unpaid invitation does not block deletion', async () => {
  await seed();
  await insert('users', { id: 12, role: 'chef', username: 'user12@fixture.invalid', password: 'fixture', firebase_uid: 'uid-12' });
  await invitation({ id: 'inv-unpaid', kitchen_id: 21, location_id: 20, manager_id: 2, chef_id: 12 });
  await invitationEvent('inv-unpaid', 2);
  await service.deleteUser(12);
  expect(await count('users', 'id=12')).toBe(0);
  expect(await count('kitchen_invitations', "id='inv-unpaid'")).toBe(0);
  expect(await count('kitchen_invitation_events', "invitation_id='inv-unpaid'")).toBe(0);
  expect(await count('kitchens', 'id=21')).toBe(1);
});

it('keeps a location note about an anonymized chef, and deletes a note when the chef is removed', async () => {
  await seed();
  await insert('users', { id: 6, role: 'chef', username: 'user6@fixture.invalid', password: 'fixture', firebase_uid: 'uid-6' });
  const kept = await insert('customer_notes', { location_id: 20, chef_id: 3, author_id: 4, body: 'Keeps the morning slot' });
  await insert('customer_notes', { location_id: 20, chef_id: 6, author_id: 2, body: 'No bookings, so this goes' });
  await service.deleteUser(3, { enforceObligations: false });
  expect((await client.query<any>('SELECT username FROM users WHERE id=3')).rows[0].username).toBe(anonymizedUsername(3));
  expect((await client.query<any>('SELECT body, chef_id, author_id FROM customer_notes WHERE id=$1', [kept.id])).rows[0])
    .toEqual({ body: 'Keeps the morning slot', chef_id: 3, author_id: 4 });
  await service.deleteUser(6);
  expect(await count('users', 'id=6')).toBe(0);
  expect(await count('customer_notes', 'chef_id=6')).toBe(0);
  expect(await count('customer_notes', `id=${kept.id}`)).toBe(1);
});

it('forgets the author of a surviving note when that account is removed', async () => {
  await seed();
  const note = await insert('customer_notes', { location_id: 20, chef_id: 3, author_id: 4, body: 'Written by an admin' });
  await service.deleteUser(4, { enforceObligations: false });
  expect(await count('users', 'id=4')).toBe(0);
  expect((await client.query<any>('SELECT body, author_id FROM customer_notes WHERE id=$1', [note.id])).rows[0])
    .toEqual({ body: 'Written by an admin', author_id: null });
});

async function rental(values: Record<string, any>) {
  return insert('storage_bookings', {
    start_date: '2026-10-20T12:00:00Z', end_date: '2026-10-21T12:00:00Z', total_price: 1000, pricing_model: 'daily',
    term_start: '2026-10-20', timezone: 'America/St_Johns', status: 'confirmed', ...values,
  });
}

it('blocks a chef or kitchen while a storage rental is open, and keeps a finished rental with its term', async () => {
  await seed();
  await insert('users', { id: 9, role: 'manager', username: 'user9@fixture.invalid', password: 'fixture', firebase_uid: 'uid-9' });
  await insert('users', { id: 10, role: 'chef', username: 'user10@fixture.invalid', password: 'fixture', firebase_uid: 'uid-10' });
  await insert('locations', { id: 90, manager_id: 9, name: 'Rental business', address: 'Fixture' });
  await insert('kitchens', { id: 91, location_id: 90, name: 'Rental kitchen' });
  await insert('storage_listings', { id: 920, kitchen_id: 91, name: 'Shelf' });
  const row = await rental({ id: 930, storage_listing_id: 920, chef_id: 10, reference_code: 'SB-OPEN', rental_state: 'active', decided_by: 4 });
  await insert('storage_rental_terms', {
    rental_id: row.id, seq: 1, kind: 'first', starts_on: '2026-10-20', ends_on: '2026-10-20', days: 1,
    daily_price_cents: 100, subtotal_cents: 100, tax_cents: 0, service_fee_cents: 0, total_cents: 100,
    status: 'paid', request_key: 'term-open',
  });
  for (const state of ['requested', 'reserved', 'active', 'move_out_requested', 'removal_review']) {
    await client.query<any>('UPDATE storage_bookings SET rental_state=$1 WHERE id=$2', [state, row.id]);
    const chefBlocked = await service.deleteUser(10).catch((error: unknown) => error);
    const kitchenBlocked = await service.deleteUser(9).catch((error: unknown) => error);
    expect(chefBlocked).toBeInstanceOf(DeletionBlockedError);
    expect(kitchenBlocked).toBeInstanceOf(DeletionBlockedError);
    expect((chefBlocked as DeletionBlockedError).message).toContain('SB-OPEN');
    expect((kitchenBlocked as DeletionBlockedError).message).toContain('open storage rental');
  }
  expect(await count('users', 'id=10')).toBe(1);
  expect(await count('storage_bookings', 'id=930')).toBe(1);
  await client.query<any>("UPDATE storage_bookings SET rental_state='declined', end_reason='cancelled' WHERE id=930");
  await service.deleteUser(10);
  expect((await client.query<any>('SELECT username FROM users WHERE id=10')).rows[0].username).toBe(anonymizedUsername(10));
  expect((await client.query<any>('SELECT chef_id, rental_state FROM storage_bookings WHERE id=930')).rows[0]).toMatchObject({ chef_id: 10, rental_state: 'declined' });
  expect(await count('storage_rental_terms', 'rental_id=930')).toBe(1);
  await client.query<any>("UPDATE storage_bookings SET rental_state='ended', end_reason='cleared' WHERE id=930");
  await service.deleteUser(9);
  expect((await client.query<any>('SELECT username FROM users WHERE id=9')).rows[0].username).toBe(anonymizedUsername(9));
  expect(await count('storage_bookings', 'id=930')).toBe(1);
  expect(await count('storage_rental_terms', 'rental_id=930')).toBe(1);
  expect((await client.query<any>('SELECT decided_by FROM storage_bookings WHERE id=930')).rows[0].decided_by).toBe(4);
  expect((await client.query<any>('SELECT archived_at IS NOT NULL AS archived FROM locations WHERE id=90')).rows[0].archived).toBe(true);
});

async function policy(kitchenId: number, version = 1) {
  return insert('kitchen_cancellation_policies', { kitchen_id: kitchenId, version, status: 'published', notice_hours: 24, late_charge_percent: 100, tiers: [], published_at: '2026-10-08T12:00Z' });
}

it('a manager with a kitchen but no bookings is deleted completely, its cancellation policy versions included', async () => {
  await insert('users', { id: 5, role: 'manager', username: 'user5@fixture.invalid', password: 'fixture', firebase_uid: 'uid-5' });
  await insert('locations', { id: 30, manager_id: 5, name: 'New business', address: 'Fixture' });
  await insert('kitchens', { id: 31, location_id: 30, name: 'New kitchen' });
  await policy(31);
  await insert('cancellation_policy_audit', { kitchen_id: 31, actor_id: 5, reason: 'Initial policy', after_state: {} });
  expect(await service.deleteUser(5, { enforceObligations: false })).toBe('deleted');
  for (const [table, where] of [['users', 'id=5'], ['locations', 'id=30'], ['kitchens', 'id=31'], ['kitchen_cancellation_policies', 'kitchen_id=31'], ['cancellation_policy_audit', 'kitchen_id=31']])
    expect(await count(table, where)).toBe(0);
});

it('deleting a kitchen with no bookings removes it with its policy versions; published policies stay protected otherwise', async () => {
  await seed();
  await insert('kitchens', { id: 12, location_id: 10, name: 'Second kitchen' });
  await policy(12); await policy(11);
  await insert('cancellation_policy_audit', { kitchen_id: 12, actor_id: 1, reason: 'Initial policy', after_state: {} });
  await client.query<any>('SAVEPOINT immutable');
  await expect(client.query<any>('DELETE FROM kitchen_cancellation_policies WHERE kitchen_id=12')).rejects.toThrow('immutable');
  await client.query<any>('ROLLBACK TO SAVEPOINT immutable');
  // Kitchen 11 has a real booking: even inside a marked deletion its policy cannot go.
  await client.query<any>("SELECT set_config('localcooks.deleting_kitchen_policies', 'on', true)");
  await expect(client.query<any>('DELETE FROM kitchen_cancellation_policies WHERE kitchen_id=11')).rejects.toThrow('immutable');
  await client.query<any>('ROLLBACK TO SAVEPOINT immutable');
  await new KitchenRepository().delete(12);
  expect(await count('kitchens', 'id=12')).toBe(0);
  expect(await count('kitchen_cancellation_policies', 'kitchen_id=12')).toBe(0);
  expect(await count('cancellation_policy_audit', 'kitchen_id=12')).toBe(0);
  expect(await count('kitchen_cancellation_policies', 'kitchen_id=11')).toBe(1);
});
