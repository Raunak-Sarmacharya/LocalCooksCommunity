import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const project = 'formauth-9e620';
const mode = process.argv[2];
assert.ok(['secret', 'event-secret', 'rules', 'function', 'local'].includes(mode), 'Explicit staging operation required');
const env = require('dotenv').parse(fs.readFileSync('.env'));
const url = new URL(env.DATABASE_URL);
assert.equal(env.FIREBASE_PROJECT_ID, project);
assert.equal(url.hostname, 'aws-1-ca-central-1.pooler.supabase.com');
assert.equal(url.username, 'postgres.zjiaghzmmgvswsllzxip', 'Expected development Supabase project');
const config = JSON.parse(fs.readFileSync('firebase.json'));
assert.equal(config.functions.length, 1);
assert.equal(config.functions[0].codebase, 'staging');
assert.equal(config.functions[0].source, 'functions');
assert.equal(config.firestore.database, 'staging');
assert.equal(JSON.parse(fs.readFileSync('functions/package.json')).main, 'lib/staging.js');
const eventKey = mode === 'event-secret' ? (process.env.STAGING_INNGEST_EVENT_KEY || env.STAGING_INNGEST_EVENT_KEY)?.trim() : undefined;
if (mode === 'event-secret') {
  assert.ok(eventKey, 'STAGING_INNGEST_EVENT_KEY is required; production event keys are never reused');
}
const clean = text => {
  let output = String(text);
  for (const key of [eventKey, env.STAGING_INNGEST_EVENT_KEY, env.INNGEST_EVENT_KEY, process.env.STAGING_INNGEST_EVENT_KEY, process.env.INNGEST_EVENT_KEY].filter(Boolean))
    output = output.split(key).join('[REDACTED_EVENT_KEY]').split(encodeURIComponent(key)).join('[REDACTED_EVENT_KEY]')
      .split(Buffer.from(key).toString('base64')).join('[REDACTED_EVENT_KEY]');
  return output.split(env.DATABASE_URL).join('[REDACTED_DATABASE_URL]')
  .split(Buffer.from(env.DATABASE_URL).toString('base64')).join('[REDACTED_SECRET]')
  .replace(/postgres(?:ql)?:\/\/[^\s"\\]+/g, '[REDACTED_DATABASE_URL]')
  .replace(/(https:\/\/inn\.gs\/e\/)[^\s"\\]+/g, '$1[REDACTED_EVENT_KEY]');
};
const run = (args, input) => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, input, maxBuffer: 12 * 1024 * 1024,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)};${process.env.PATH}` } });
  const output = clean(`${result.stdout || ''}${result.stderr || ''}`);
  fs.writeFileSync(`docs/phase-progress/evidence/firebase-staging-${mode}.log`, output);
  console.log(output.slice(-9000));
  assert.equal(result.status, 0, 'Operation stopped; inspect sanitized log before retry');
};
try {
  const baseline = spawnSync(process.execPath, ['scripts/firebase-staging-audit.mjs'], { encoding: 'utf8', windowsHide: true });
  console.log(clean(`${baseline.stdout || ''}${baseline.stderr || ''}`));
  assert.equal(baseline.status, 0, 'Production baseline check failed; no staging mutation allowed');
  if (mode === 'local') {
    let text = fs.readFileSync('.env', 'utf8');
    for (const key of ['FIRESTORE_DATABASE_ID', 'VITE_FIRESTORE_DATABASE_ID']) {
      const line = new RegExp(`^${key}=.*$`, 'm');
      text = line.test(text) ? text.replace(line, `${key}=staging`) : `${text.trimEnd()}\n${key}=staging\n`;
    }
    fs.writeFileSync('.env', text);
    console.log('Local Firestore selection set to staging; restart the development server to apply.');
  } else {
    if (mode === 'secret') {
      const client = new (require('pg').Client)({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      try {
        await client.connect();
        const result = await client.query("SELECT to_regclass('public.kitchen_viewings') IS NOT NULL AND to_regclass('public.email_logs') IS NOT NULL AS ready");
        assert.equal(result.rows[0].ready, true, 'Development schema missing');
      } finally { await client.end(); }
      run(['node_modules/firebase-tools/lib/bin/firebase.js', 'functions:secrets:set', 'STAGING_DATABASE_URL', '--data-file', '-',
        '--project', project, '--non-interactive'], env.DATABASE_URL);
    } else if (mode === 'event-secret') {
      run(['node_modules/firebase-tools/lib/bin/firebase.js', 'functions:secrets:set', 'STAGING_INNGEST_EVENT_KEY', '--data-file', '-',
        '--project', project, '--non-interactive'], eventKey);
    } else {
      if (mode === 'function') {
        run(['functions/node_modules/typescript/bin/tsc', '--project', 'functions/tsconfig.json']);
        const exports = require('../functions/lib/staging.js');
        assert.deepEqual(Object.keys(exports), ['onNewStagingChatMessage']);
        assert.equal(exports.onNewStagingChatMessage.__endpoint.eventTrigger.eventFilters.database, 'staging');
      }
      run(['node_modules/firebase-tools/lib/bin/firebase.js', 'deploy', '--config', 'firebase.json', '--project', project,
        '--only', mode === 'rules' ? 'firestore:rules' : 'functions:staging:onNewStagingChatMessage', '--non-interactive',
        // Required by Firebase CLI to enable retries on this new, idempotent staging trigger.
        ...(mode === 'function' ? ['--force'] : [])]);
    }
  }
} catch (error) { console.error(clean(error.message)); process.exitCode = 1; }
finally {
  for (const file of ['firebase-debug.log', 'functions/firebase-debug.log']) if (fs.existsSync(file)) fs.writeFileSync(file, clean(fs.readFileSync(file, 'utf8')));
}
