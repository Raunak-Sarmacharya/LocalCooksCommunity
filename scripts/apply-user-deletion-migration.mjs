import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const migrationPath = 'migrations/0071_complete_user_deletion.sql';
const source = fs.readFileSync(migrationPath, 'utf8');
const targets = [...source.matchAll(/ARRAY\['([^']+)','([^']+)','([^']+)','([^']+)'\]/g)]
  .map(match => ({ table: match[1], column: match[2], parent: match[3], rule: match[4] }));
if (targets.length !== 24) throw new Error('Unexpected migration target list');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const quote = value => '"' + value.replaceAll('"', '""') + '"';
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('localcooks-manual-migrations'))");
  const identity = (await client.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
  if (identity.schema !== 'public') throw new Error('Expected public schema');
  const tables = (await client.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname")).rows.map(row => row.relname);
  const countQuery = tables.map(table => `SELECT '${table}' AS name,count(*)::int AS count FROM public.${quote(table)}`).join(' UNION ALL ');
  const before = (await client.query(countQuery)).rows;
  await client.query(source);
  const actual = (await client.query(`SELECT r.relname AS table,a.attname AS column,p.relname AS parent,c.confdeltype AS rule
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_class p ON p.oid=c.confrelid
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.connamespace='public'::regnamespace`)).rows;
  for (const target of targets) {
    if (!actual.some(fk => fk.table === target.table && fk.column === target.column && fk.parent === target.parent
      && fk.rule === (target.rule === 'CASCADE' ? 'c' : 'n'))) throw new Error(`Verification failed: ${target.table}.${target.column}`);
  }
  const functions = (await client.query(`SELECT proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    WHERE pronamespace='public'::regnamespace AND proname IN ('protect_tour_visit_event','guard_tour_repeat_authorization')`)).rows;
  if (functions.length !== 2 || functions.some(fn => !fn.definition.includes('localcooks.deleting_user_id')))
    throw new Error('Audit trigger verification failed');
  const registrationGuard = (await client.query(`SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.users'::regclass AND t.tgname='users_pending_deletion' AND t.tgenabled='O'`)).rows;
  if (registrationGuard.length !== 1 || !registrationGuard[0].definition.includes('user_deletion_jobs'))
    throw new Error('Pending deletion registration guard verification failed');
  const security = (await client.query(`SELECT relrowsecurity,
    has_table_privilege('anon','public.user_deletion_jobs','SELECT') AS anon_read,
    has_table_privilege('authenticated','public.user_deletion_jobs','SELECT') AS authenticated_read
    FROM pg_class WHERE oid='public.user_deletion_jobs'::regclass`)).rows[0];
  if (!security?.relrowsecurity || security.anon_read || security.authenticated_read) throw new Error('Cleanup job privacy verification failed');
  const after = (await client.query(countQuery)).rows;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Existing row counts changed; rolling back');
  await client.query('COMMIT');
  const evidence = { appliedAt: new Date().toISOString(), migration: migrationPath,
    sha256: createHash('sha256').update(source).digest('hex'), identity,
    verifiedForeignKeys: targets.length, auditTriggersVerified: true, registrationGuardVerified: true,
    cleanupJobsPrivate: true, existingRowCountsUnchanged: true };
  fs.mkdirSync('.tmp', { recursive: true });
  fs.writeFileSync('.tmp/user-deletion-migration-applied.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ code: error.code, message: error.message }));
  process.exitCode = 1;
} finally { await client.end(); }
