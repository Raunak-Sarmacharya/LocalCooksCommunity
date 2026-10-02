// Apply only the additive tour schema changes from the lifecycle migration.
require('dotenv').config();
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const statements = readFileSync(resolve(__dirname, '../migrations/0053_lifecycle_wiring_repairs.sql'), 'utf8')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(sql => sql.trim())
    .filter(sql => /^ALTER (?:TYPE no_show_reason|TABLE kitchen_viewings)\b/.test(sql));
  if (statements.length !== 6) throw new Error('Expected the six additive tour schema statements');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const statement of statements) await client.query(statement);
    // Selecting the new fields catches an incomplete repair without reading records.
    await client.query(`SELECT no_show_at, outcome_recorded_by, outcome_history,
      outcome_reminder_sent_at, outcome_notification_pending FROM kitchen_viewings LIMIT 0`);
    await client.query('COMMIT');
    console.log('Tour outcome schema applied and verified. Existing tour outcomes were preserved.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`Tour schema repair failed: ${error.message}`);
  process.exitCode = 1;
});
