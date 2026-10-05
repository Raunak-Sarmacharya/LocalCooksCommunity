import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const project = 'formauth-9e620', id = 'localcooks-staging-chat';
const email = `${id}@${project}.iam.gserviceaccount.com`, member = `serviceAccount:${email}`;
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const otherBindings = policy => (policy.bindings || []).map(binding => ({ ...binding, members: binding.members.filter(value => value !== member).sort() }))
  .filter(binding => binding.members.length).map(ordered).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
try {
  const check = spawnSync(process.execPath, ['scripts/firebase-staging-audit.mjs'], { encoding: 'utf8', windowsHide: true });
  assert.equal(check.status, 0, 'Production guard failed');
  const auth = require('firebase-tools/lib/auth'), options = { project, nonInteractive: true };
  auth.setActiveAccount(options, auth.selectAccount(undefined, process.cwd()));
  await require('firebase-tools/lib/requireAuth').requireAuth(options);
  const { Client } = require('firebase-tools/lib/apiv2');
  const resource = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
  const before = (await resource.post(`/projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).body;
  const iam = require('firebase-tools/lib/gcp/iam');
  try { await iam.getServiceAccount(project, email); }
  catch (error) {
    if (error.status !== 404 && error.context?.response?.statusCode !== 404) throw error;
    await iam.createServiceAccount(project, id, 'Staging chat trigger; no production Firestore or Firebase Auth access', 'Local Cooks staging chat');
  }
  const required = [
    { role: 'roles/datastore.viewer', members: [member], condition: {
      title: 'staging_firestore_only', expression: `resource.name == "projects/${project}/databases/staging"` } },
    { role: 'roles/eventarc.eventReceiver', members: [member] },
  ];
  const policy = structuredClone(before); policy.version = 3; policy.bindings ||= [];
  for (const existing of policy.bindings.filter(binding => binding.members.includes(member))) {
    assert.ok(required.some(binding => binding.role === existing.role && JSON.stringify(ordered(binding.condition)) === JSON.stringify(ordered(existing.condition))),
      'Staging service account has unexpected existing project permissions');
  }
  for (const binding of required) if (!policy.bindings.some(existing => existing.role === binding.role && existing.members.includes(member)
    && JSON.stringify(ordered(existing.condition)) === JSON.stringify(ordered(binding.condition)))) policy.bindings.push(binding);
  assert.deepEqual(otherBindings(policy), otherBindings(before), 'Existing project bindings must remain unchanged');
  const result = (await resource.post(`/projects/${project}:setIamPolicy`, { policy })).body;
  assert.deepEqual(otherBindings(result), otherBindings(before));
  fs.writeFileSync('docs/phase-progress/evidence/firebase-staging-iam.json', JSON.stringify({ serviceAccount: email, bindings: required,
    existingBindingsUnchanged: true, keyCreated: false }, null, 2));
  console.log('Dedicated staging service account created: staging Firestore read access and Eventarc receipt only; existing bindings unchanged. No key created.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
