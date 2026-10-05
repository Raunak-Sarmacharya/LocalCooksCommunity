import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const project = 'formauth-9e620';
const email = `localcooks-staging-chat@${project}.iam.gserviceaccount.com`;
const member = `serviceAccount:${email}`;
try {
  const guard = spawnSync(process.execPath, ['scripts/firebase-staging-audit.mjs', '--verify-staging'], { encoding: 'utf8', windowsHide: true });
  assert.equal(guard.status, 0, 'Staging deployment and production guard must pass');
  const auth = require('firebase-tools/lib/auth'), options = { project, nonInteractive: true };
  auth.setActiveAccount(options, auth.selectAccount(undefined, process.cwd()));
  await require('firebase-tools/lib/requireAuth').requireAuth(options);
  const fn = await require('firebase-tools/lib/gcp/cloudfunctionsv2').getFunction(project, 'us-central1', 'onNewStagingChatMessage');
  assert.equal(fn.serviceConfig.serviceAccountEmail, email);
  assert.equal(fn.eventTrigger.serviceAccountEmail, email);
  assert.ok(fn.eventTrigger.eventFilters.some(filter => filter.attribute === 'database' && filter.value === 'staging'));
  const service = fn.serviceConfig.service;
  assert.equal(service.split('/').at(-1), 'onnewstagingchatmessage');
  const run = require('firebase-tools/lib/gcp/run');
  const before = await run.getIamPolicy(service);
  assert.ok(!before.bindings?.some(binding => binding.members.includes('allUsers') || binding.members.includes('allAuthenticatedUsers')),
    'Staging function must remain private');
  const policy = structuredClone(before); policy.bindings ||= [];
  if (!policy.bindings.some(binding => binding.role === 'roles/run.invoker' && binding.members.includes(member))) {
    policy.bindings.push({ role: 'roles/run.invoker', members: [member] });
    await run.setIamPolicy(service, policy);
  }
  const after = await run.getIamPolicy(service);
  assert.ok(after.bindings.some(binding => binding.role === 'roles/run.invoker' && binding.members.includes(member)));
  fs.writeFileSync('docs/phase-progress/evidence/firebase-staging-invoker.json', JSON.stringify({ service, member,
    role: 'roles/run.invoker', publicAccess: false }, null, 2));
  console.log('Approved staging identity can invoke only the new staging service; no project-wide invoker role granted.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
