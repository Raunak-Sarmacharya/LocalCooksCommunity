// Apply this bounded additive migration only to the owner-authorized staging DB.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
async function main() {
  if (process.argv[2] !== '--staging') throw Error('Explicit --staging is required');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!/(^|\.)supabase\.(com|co)$/.test(url.hostname)) throw Error('Expected the authorized Supabase staging connection');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const digestSql = `SELECT count(*)::int AS count, md5(coalesce(string_agg((to_jsonb(v) - 'shared_manager_notes' - 'disruption_reason')::text, '' ORDER BY id), '')) AS digest FROM kitchen_viewings v`;
  try {
    await client.connect();
    await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('LOCK TABLE kitchen_viewings IN SHARE ROW EXCLUSIVE MODE');
    const before = (await client.query(digestSql)).rows[0];
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/0055_tour_outcome_and_delivery_repairs.sql'), 'utf8');
    await client.query(sql);
    const after = (await client.query(digestSql)).rows[0];
    if (before.count !== after.count || before.digest !== after.digest) throw Error('Existing tour records changed; rolling back');
    await client.query('COMMIT');
    console.log(JSON.stringify({ applied: true, existingToursPreserved: true, tours: after.count }));
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await client.end(); }
}
main().catch(error => { console.error(`Tour migration failed: ${error.message}`); process.exitCode = 1; });
