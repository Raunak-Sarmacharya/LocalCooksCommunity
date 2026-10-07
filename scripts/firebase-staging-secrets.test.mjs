import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

const audit = fs.readFileSync(new URL('./firebase-staging-audit.mjs', import.meta.url), 'utf8');
const bindingsCheck = audit.slice(audit.indexOf('    if (JSON.stringify(fn.secretEnvironmentVariables'), audit.indexOf('    const release = releases.find', audit.indexOf("if (process.argv.includes('--verify-staging'))")));
const permissionsCheck = audit.slice(audit.indexOf("    const member = `serviceAccount:"), audit.indexOf("    const { Client } = require('firebase-tools/lib/apiv2');"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('audit accepts either binding order and requires both isolated staging permissions', async () => {
  const checkBindings = new Function('fn', bindingsCheck);
  for (const keys of [['STAGING_DATABASE_URL', 'STAGING_INNGEST_EVENT_KEY'], ['STAGING_INNGEST_EVENT_KEY', 'STAGING_DATABASE_URL']])
    checkBindings({ secretEnvironmentVariables: keys.map(key => ({ key })) });
  for (const keys of [[], ['STAGING_DATABASE_URL'], ['STAGING_DATABASE_URL', 'STAGING_INNGEST_EVENT_KEY', 'INNGEST_EVENT_KEY']])
    assert.throws(() => checkBindings({ secretEnvironmentVariables: keys.map(key => ({ key })) }), /exactly/);
  const checkPermissions = new AsyncFunction('secrets', 'project', 'account', permissionsCheck);
  const account = 'fixture-staging-account', member = `serviceAccount:${account}`;
  const allowed = { bindings: [{ role: 'roles/secretmanager.secretAccessor', members: [member] }] };
  const policies = { STAGING_DATABASE_URL: allowed, STAGING_INNGEST_EVENT_KEY: allowed, DATABASE_URL: {}, INNGEST_EVENT_KEY: {} };
  const seen = [];
  const secrets = { getIamPolicy: async ({ name }) => { seen.push(name); return policies[name]; } };
  await checkPermissions(secrets, 'fixture-project', account);
  assert.deepEqual(seen, Object.keys(policies));
  for (const name of Object.keys(policies)) {
    const previous = policies[name];
    policies[name] = name.startsWith('STAGING_') ? {} : allowed;
    await assert.rejects(checkPermissions(secrets, 'fixture-project', account), /access/);
    policies[name] = previous;
  }
});

test('event-secret mode uses only the explicit staging key and sanitizes output', async () => {
  const source = fs.readFileSync(new URL('./firebase-staging-deploy.mjs', import.meta.url), 'utf8');
  const config = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url)));
  const packageConfig = JSON.parse(fs.readFileSync(new URL('../functions/package.json', import.meta.url)));
  const body = source.replace(/^import .*;\r?\n/gm, '');
  const execute = new AsyncFunction('fs', 'path', 'assert', 'createRequire', 'spawnSync', 'process', 'console', 'Buffer', 'importUrl', body.replaceAll('import.meta.url', 'importUrl'));
  const run = async (keys) => {
    const env = { DATABASE_URL: 'postgresql://postgres.zjiaghzmmgvswsllzxip:fixture@aws-1-ca-central-1.pooler.supabase.com/db', FIREBASE_PROJECT_ID: 'formauth-9e620', ...keys };
    const writes = [], calls = [], logs = [];
    const mockFs = { readFileSync: file => file === '.env' ? 'fixture-env' : JSON.stringify(file === 'firebase.json' ? config : packageConfig),
      writeFileSync: (_file, text) => writes.push(text), existsSync: () => false };
    const require = name => { assert.equal(name, 'dotenv'); return { parse: () => env }; };
    const spawn = (_exe, args, options) => { calls.push({ args, input: options.input }); return { status: 0, stdout: `${env.STAGING_INNGEST_EVENT_KEY || ''} ${env.INNGEST_EVENT_KEY || ''}`, stderr: '' }; };
    await execute(mockFs, path, assert, () => require, spawn, { argv: ['node', 'script', 'event-secret'], env: {}, execPath: 'fixture-node' },
      { log: text => logs.push(text), error: text => logs.push(text) }, Buffer, 'fixture-url');
    return { calls, output: [...logs, ...writes].join('\n') };
  };
  await assert.rejects(run({ INNGEST_EVENT_KEY: 'fixture-production' }), /STAGING_INNGEST_EVENT_KEY is required/);
  const sharedPortalKey = await run({ STAGING_INNGEST_EVENT_KEY: 'fixture-shared', INNGEST_EVENT_KEY: 'fixture-shared' });
  assert.equal(sharedPortalKey.calls[1].input, 'fixture-shared');
  const result = await run({ STAGING_INNGEST_EVENT_KEY: 'fixture-staging', INNGEST_EVENT_KEY: 'fixture-production' });
  assert.equal(result.calls.length, 2); // read-only baseline, then staging secret provisioning
  assert.equal(result.calls[1].args[2], 'STAGING_INNGEST_EVENT_KEY');
  assert.equal(result.calls[1].input, 'fixture-staging');
  assert.ok(!result.output.includes('fixture-staging'));
  assert.ok(!result.output.includes('fixture-production'));
});
