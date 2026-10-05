import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    const identity = (await client.query('SELECT current_database() AS database, current_schema() AS schema, current_setting(\'server_version\') AS version')).rows[0];
    const columns = (await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','kitchens','kitchen_viewings','kitchen_bookings','kitchen_booking_visits','storage_bookings','commitment_problems','kitchen_booking_changes','tour_delivery_events','email_logs','kitchen_viewing_settings','platform_settings','damage_claims','storage_overstay_records','storage_listings','storage_overstay_quotes','kitchen_booking_attendance_events','booking_lifecycle_events') ORDER BY table_name,ordinal_position")).rows;
    const ledgers = (await client.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_name ILIKE '%migrat%'")).rows;
    const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('commitment_problems','kitchen_booking_changes')")).rows;
    const enums = (await client.query("SELECT t.typname,e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='no_show_reason'")).rows;
    const defaults = (await client.query("SELECT defaclrole::regrole::text AS owner,defaclnamespace::regnamespace::text AS schema,defaclobjtype,defaclacl::text AS privileges FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace")).rows;
    await client.query('COMMIT');
    const result = { inspectedAt: new Date().toISOString(), targetHost: new URL(process.env.DATABASE_URL).hostname, identity, columns, ledgers, indexes, enums, defaults };
    fs.mkdirSync('docs/phase-progress/evidence', { recursive: true });
    fs.writeFileSync('docs/phase-progress/evidence/tour-rollout-catalog-before.json', JSON.stringify(result, null, 2));
    const relevant = columns.filter(c => ['checked_in_at','checked_out_at','attendance_history','visit_duties','assistance_history'].includes(c.column_name));
    console.log(JSON.stringify({ identity, relevantColumns: relevant.map(c=>`${c.table_name}.${c.column_name}`), tables: [...new Set(columns.map(c=>c.table_name))], enums, defaults }));
  } finally { client.release(); }
} catch (error) {
  console.error(JSON.stringify({ code: error.code || null, message: error.message }));
  process.exitCode = 1;
} finally { await pool.end(); }
