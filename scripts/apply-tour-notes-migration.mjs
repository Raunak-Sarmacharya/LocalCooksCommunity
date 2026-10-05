import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const sql = fs.readFileSync('migrations/0063_tour_visit_notes.sql', 'utf8');
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('localcooks-manual-migrations'))");
    const identity = (await client.query('SELECT current_database() AS database, current_schema() AS schema')).rows[0];
    if (identity.schema !== 'public') throw Error('Unexpected schema');
    await client.query(sql);
    const columns = (await client.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='kitchen_viewing_settings' AND column_name IN ('arrival_notes','departure_notes') ORDER BY column_name")).rows;
    if (columns.length !== 2 || columns.some(column => column.data_type !== 'text' || column.is_nullable !== 'YES')) throw Error('Tour notes column verification failed');
    await client.query('COMMIT');
    const result = { committedAt: new Date().toISOString(), targetHost: new URL(process.env.DATABASE_URL).hostname, identity,
      migration: '0063_tour_visit_notes.sql', sha256: crypto.createHash('sha256').update(sql).digest('hex'), columns };
    fs.writeFileSync('docs/phase-progress/evidence/tour-notes-migration-applied.json', JSON.stringify(result, null, 2));
    console.log('Migration 0063 committed; both nullable text columns verified.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
