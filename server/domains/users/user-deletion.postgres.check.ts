import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { deleteUserDependents, getUserDeletionImpact } from './user-deletion.service';
import { UserService } from './user.service';

vi.mock('../../logger', () => ({ logger: { info: vi.fn() } }));
const harness = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../db', () => ({ db: new Proxy({}, { get: (_target,key) => harness.db[key] }) }));
const url = process.env.USER_DELETION_TEST_DATABASE_URL;
if (!url) throw new Error('USER_DELETION_TEST_DATABASE_URL is required; tests use temporary tables only');
const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
const database = drizzle(client);
const service = new UserService();
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
let tables: string[] = [];
const columns = new Map<string, any[]>();
const originalCounts = new Map<string, number>();
const fixtureId = new Map<string, number>();
const migration = () => readFileSync('migrations/0071_complete_user_deletion.sql','utf8')
  .replaceAll('CREATE OR REPLACE FUNCTION ', 'CREATE OR REPLACE FUNCTION pg_temp.');

beforeAll(async () => {
  await client.connect();
  harness.db = { transaction: async (callback: any) => {
    await client.query('SAVEPOINT deletion');
    try { const result = await callback(database); await client.query('RELEASE SAVEPOINT deletion'); return result; }
    catch (error) { await client.query('ROLLBACK TO SAVEPOINT deletion'); throw error; }
  } };
  // One outer transaction pins the connection even on Supabase's transaction
  // pooler. All DDL/data is in pg_temp and disappears on rollback/disconnect.
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'");
  tables = (await client.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname")).rows.map(r => r.relname);
  const fks = (await client.query("SELECT conrelid::regclass::text AS child, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")).rows;
  const triggers = (await client.query("SELECT pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.tour_visit_events'::regclass,'public.tour_repeat_authorizations'::regclass)")).rows;
  const before = (await client.query(tables.map(table => `SELECT '${table}' AS name,count(*)::int AS count FROM public.${quote(table)}`).join(' UNION ALL '))).rows;
  before.forEach(row => originalCounts.set(row.name,row.count));
  await client.query(tables.map(table => `CREATE TEMP TABLE ${quote(table)} (LIKE public.${quote(table)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED INCLUDING IDENTITY) ON COMMIT DROP`).join(';'));
  await client.query('SET LOCAL search_path TO pg_temp, public');
  const allColumns = (await client.query(`SELECT r.relname AS table_name,a.attname AS name,a.attnotnull AS required,format_type(a.atttypid,a.atttypmod) AS type,
    pg_get_expr(d.adbin,d.adrelid) AS default_value,(SELECT enumlabel FROM pg_enum WHERE enumtypid=a.atttypid ORDER BY enumsortorder LIMIT 1) AS enum_value
    FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE r.relnamespace=pg_my_temp_schema() AND r.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY r.relname,a.attnum`)).rows;
  const setup: string[] = [];
  for (const table of tables) {
    const metadata = allColumns.filter(column => column.table_name === table);
    columns.set(table, metadata);
    for (const column of metadata.filter(c => c.default_value?.includes('nextval('))) {
      // Never advance the real serial sequences from a cloned default.
      setup.push(`ALTER TABLE ${quote(table)} ALTER COLUMN ${quote(column.name)} DROP DEFAULT`);
      column.default_value = null;
    }
    setup.push(`ALTER TABLE ${quote(table)} ADD PRIMARY KEY (${table === 'session' ? 'sid' : table === 'user_deletion_jobs' ? 'user_id' : 'id'})`);
  }
  await client.query(setup.join(';'));
  await client.query(fks.map(fk => `ALTER TABLE ${quote(fk.child.replace(/^public\./,''))} ADD CONSTRAINT ${quote(fk.conname)} ${fk.definition.replaceAll('public.','')}`).join(';'));
  // Only tour triggers fire on our deletion path; booking insert triggers are
  // omitted so seed helpers can explicitly create all visits and event records.
  await client.query(migration());
  const validator = readFileSync('migrations/0067_tour_visit_events.sql','utf8').match(/CREATE OR REPLACE FUNCTION validate_tour_visit_successor\(\)[\s\S]*?END \$\$;/)?.[0];
  if (!validator) throw new Error('Missing visit successor validator');
  await client.query(validator.replace('CREATE OR REPLACE FUNCTION ', 'CREATE OR REPLACE FUNCTION pg_temp.'));
  for (const trigger of triggers) await client.query(trigger.definition.replaceAll('public.','pg_temp.')
    .replace(/EXECUTE FUNCTION (?:pg_temp\.)?(\w+)\(/,'EXECUTE FUNCTION pg_temp.$1('));
  expect((await client.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND c.relnamespace=pg_my_temp_schema() AND p.pronamespace<>pg_my_temp_schema()`)).rows).toEqual([]);
  const unsafe = (await client.query(`SELECT c.conname FROM pg_constraint c JOIN pg_namespace child ON child.oid=c.connamespace
    JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    WHERE c.contype='f' AND child.oid=pg_my_temp_schema() AND pn.oid<>pg_my_temp_schema()`)).rows;
  expect(unsafe).toEqual([]);
});

beforeEach(async () => { fixtureId.clear(); await client.query('SAVEPOINT fixture'); });
afterEach(async () => { await client.query('ROLLBACK TO SAVEPOINT fixture'); });
afterAll(async () => {
  try {
    await client.query('ROLLBACK');
    const after = (await client.query(tables.map(table => `SELECT '${table}' AS name,count(*)::int AS count FROM public.${quote(table)}`).join(' UNION ALL '))).rows;
    after.forEach(row => expect(row.count).toBe(originalCounts.get(row.name)));
  } finally { await client.end(); }
});

async function insert(table: string, values: Record<string, any>) {
  const fields = { ...values };
  for (const column of columns.get(table) ?? []) {
    if (fields[column.name] !== undefined || !column.required || column.default_value) continue;
    if (column.name === 'id') fields.id = (fixtureId.get(table) ?? 1000) + 1;
    else if (column.enum_value) fields[column.name] = column.enum_value;
    else if (column.type.includes('timestamp')) fields[column.name] = '2026-10-08T12:00:00Z';
    else if (column.type === 'jsonb') fields[column.name] = {};
    else if (column.type === 'boolean') fields[column.name] = false;
    else if (/integer|numeric/.test(column.type)) fields[column.name] = 1;
    else fields[column.name] = `fixture ${column.name}`;
  }
  if (typeof fields.id === 'number') fixtureId.set(table, fields.id);
  const names = Object.keys(fields);
  const result = await client.query(`INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`, names.map(n=>typeof fields[n]==='object' && !(fields[n] instanceof Date) ? JSON.stringify(fields[n]) : fields[n]));
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
const count = async (table: string, where='true') => Number((await client.query(`SELECT count(*) FROM ${quote(table)} WHERE ${where}`)).rows[0].count);

it('replays the migration and removes manager resources plus all new blockers while preserving other businesses', async () => {
  await seed();
  await client.query(migration());
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
  await client.query('DELETE FROM users WHERE id=1');
  expect(deleted).toMatchObject({locations:1,kitchens:1,kitchen_bookings:1,commitment_problems:1,payment_transactions:1});
  for (const table of ['kitchen_booking_attendance_events','booking_lifecycle_events','kitchen_booking_changes','storage_overstay_quotes','payment_transactions']) expect(await count(table)).toBe(0);
  expect(await count('chef_notifications')).toBe(1); expect(await count('email_logs')).toBe(0);
  expect(await count('locations')).toBe(1); expect(await count('kitchens')).toBe(1); expect(await count('kitchen_bookings')).toBe(1);
  expect((await client.query('SELECT checkout_approved_by FROM kitchen_bookings WHERE id=200')).rows[0].checkout_approved_by).toBeNull();
  expect((await client.query('SELECT claimed_by FROM commitment_problems')).rows[0].claimed_by).toBeNull();
  expect((await client.query('SELECT value,updated_by FROM platform_settings')).rows[0]).toEqual({value:'yes',updated_by:null});
});

it('removes chef activity, quotes, attendance and restrictive tour dependencies', async () => {
  await seed();
  await insert('storage_listings',{id:120,kitchen_id:11});
  await insert('storage_overstay_quotes',{id:'quote',chef_id:3,storage_listing_id:120});
  await insert('kitchen_booking_attendance_events',{booking_id:200,visit_id:201,actor_id:4,actor_role:'admin',action:'report_attended'});
  await insert('booking_lifecycle_events',{booking_id:200,actor_id:3,kind:'cancelled'});
  await insert('commitment_problems',{source_key:'tour',kind:'live',viewing_id:110,reported_by:1});
  await insert('tour_feedback_responses',{viewing_id:110,respondent_id:1,respondent_role:'manager',scheduled_at:'2026-10-08T12:00Z',happened:true});
  await deleteUserDependents(database,3); await client.query('DELETE FROM users WHERE id=3');
  for (const table of ['storage_overstay_quotes','kitchen_bookings','kitchen_booking_visits','kitchen_booking_attendance_events','booking_lifecycle_events','kitchen_viewings','commitment_problems','tour_feedback_responses']) expect(await count(table)).toBe(0);
  expect(await count('locations')).toBe(2); expect(await count('kitchens')).toBe(2);
});

it('allows account-scoped repeat permission cleanup and actor anonymization while keeping audit protections', async () => {
  await seed();
  await insert('tour_repeat_authorizations',{id:400,source_tour_id:110,source_version:'version',request_key:'repeat',granted_by:4,reason:'A verified repeat visit is needed',granted_at:'2026-10-08T10:00Z',expires_at:'2026-10-09T10:00Z',used_at:'2026-10-08T11:00Z',used_by_tour_id:210});
  await client.query('UPDATE kitchen_viewings SET repeat_authorization_id=400 WHERE id=210');
  await insert('tour_visit_events',{id:500,viewing_id:210,kind:'arrival',event_key:'arrival',actor_id:1,source:'manager',actual_at:'2026-10-08T11:00Z',recorded_at:'2026-10-08T12:00Z',scheduled_at:'2026-10-08T12:00Z'});
  await client.query('SAVEPOINT forbidden');
  await expect(client.query('DELETE FROM tour_repeat_authorizations WHERE id=400')).rejects.toThrow('cannot be deleted');
  await client.query('ROLLBACK TO SAVEPOINT forbidden');
  await expect(client.query('UPDATE tour_visit_events SET actor_id=NULL WHERE id=500')).rejects.toThrow('immutable');
  await client.query('ROLLBACK TO SAVEPOINT forbidden');
  await deleteUserDependents(database,1); await client.query('DELETE FROM users WHERE id=1');
  expect(await count('tour_repeat_authorizations')).toBe(0);
  expect((await client.query('SELECT repeat_authorization_id FROM kitchen_viewings WHERE id=210')).rows[0].repeat_authorization_id).toBeNull();
  expect((await client.query('SELECT actor_id,actual_at FROM tour_visit_events WHERE id=500')).rows[0]).toMatchObject({actor_id:null,actual_at:new Date('2026-10-08T11:00Z')});
  await client.query('SAVEPOINT protected');
  await expect(client.query("UPDATE tour_visit_events SET actual_at='2026-10-08T11:01Z' WHERE id=500")).rejects.toThrow('immutable');
  await client.query('ROLLBACK TO SAVEPOINT protected');
});

it('database cascades can remove an owned location with repeat permissions without trigger deadlocks', async () => {
  await seed();
  await insert('tour_repeat_authorizations',{id:400,source_tour_id:110,source_version:'version',request_key:'repeat',granted_by:4,reason:'A verified repeat visit is needed',granted_at:'2026-10-08T10:00Z',expires_at:'2026-10-09T10:00Z'});
  await client.query('DELETE FROM locations WHERE id=10');
  expect(await count('tour_repeat_authorizations')).toBe(0); expect(await count('kitchens')).toBe(1);
});

it('the real user service commits retry context with the database purge', async () => {
  await seed();
  await service.deleteUser(1,{enforceObligations:false});
  expect(await count('users','id=1')).toBe(0);
  expect(await count('locations','id=10')).toBe(0);
  expect((await client.query('SELECT user_id,firebase_uid,location_ids FROM user_deletion_jobs')).rows[0])
    .toEqual({user_id:1,firebase_uid:'uid-1',location_ids:[10]});
  await client.query('SAVEPOINT registration');
  await expect(insert('users',{id:5,username:'new@fixture.invalid',password:'fixture',firebase_uid:'uid-1'}))
    .rejects.toThrow('Account deletion is still in progress');
  await client.query('ROLLBACK TO SAVEPOINT registration');
});

it('a final FK failure rolls back resources and retry context together', async () => {
  await seed();
  await client.query('CREATE TEMP TABLE unexpected_child(id integer PRIMARY KEY,user_id integer REFERENCES users(id)) ON COMMIT DROP');
  await client.query('INSERT INTO unexpected_child VALUES(1,1)');
  await expect(service.deleteUser(1,{enforceObligations:false})).rejects.toThrow();
  expect(await count('users','id=1')).toBe(1); expect(await count('locations','id=10')).toBe(1);
  expect(await count('kitchen_bookings','id=100')).toBe(1); expect(await count('user_deletion_jobs')).toBe(0);
});
