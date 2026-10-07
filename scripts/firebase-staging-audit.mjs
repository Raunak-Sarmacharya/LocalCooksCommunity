import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const project = 'formauth-9e620';
const evidence = 'docs/phase-progress/evidence/firebase-staging-production-baseline.json';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
function* permutations(keys) {
  if (!keys.length) yield [];
  for (let i = 0; i < keys.length; i++) for (const rest of permutations(keys.filter((_, index) => index !== i))) yield [keys[i], ...rest];
}
const withOrder = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
function matchesLegacy(fn, expected) {
  if (sha(fn) === expected) return true;
  // Old evidence hashed JSON map order. Migration is allowed only if the exact
  // old digest can be reproduced by reordering maps, without changing values.
  const envKeys = Object.keys(fn.environmentVariables || {});
  if (envKeys.length > 8) throw Error('Legacy baseline migration exceeds its bounded map limit');
  for (const envOrder of permutations(envKeys)) for (const labelOrder of permutations(Object.keys(fn.labels || {})))
    for (const filterOrder of permutations(Object.keys(fn.eventTrigger?.eventFilters || {}))) {
      const candidate = { ...fn, eventTrigger: { ...fn.eventTrigger, eventFilters: withOrder(fn.eventTrigger.eventFilters, filterOrder) },
        environmentVariables: withOrder(fn.environmentVariables, envOrder), labels: withOrder(fn.labels, labelOrder) };
      if (sha(candidate) === expected) return true;
    }
  return false;
}
const cli = args => {
  const result = spawnSync(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', ...args,
    '--project', project, '--json', '--non-interactive'], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  let body;
  try { body = JSON.parse(result.stdout); } catch { throw Error('Firebase CLI did not return structured output'); }
  if (result.status || body.status !== 'success') throw Error('Firebase read-only inspection failed');
  return body.result;
};
try {
  const functions = cli(['functions:list']);
  if (process.argv.includes('--diagnose')) {
    const repeated = cli(['functions:list']);
    const before = JSON.parse(fs.readFileSync(evidence));
    for (const fn of functions.filter(fn => fn.id !== 'onNewStagingChatMessage')) {
      const repeat = repeated.find(candidate => candidate.id === fn.id);
      console.log(JSON.stringify({ id: fn.id, sameValues: sha(ordered(fn)) === sha(ordered(repeat)),
        sameSerialization: sha(fn) === sha(repeat),
        sourceHash: fn.hash, sourceGeneration: fn.source?.storageSource?.generation,
        runtime: fn.runtime, database: fn.eventTrigger?.eventFilters?.database,
        sqlHost: fn.environmentVariables?.DATABASE_URL ? new URL(fn.environmentVariables.DATABASE_URL).hostname : null,
        rootKeyOrder: Object.keys(fn), envKeyOrder: Object.keys(fn.environmentVariables || {}),
        originalBaselineMatchesFirst: before.productionFunctions.find(candidate => candidate.id === fn.id)?.sha256 === sha(fn),
        originalBaselineMatchesSecond: before.productionFunctions.find(candidate => candidate.id === fn.id)?.sha256 === sha(repeat),
        differingFields: Object.keys(fn).filter(key => sha(ordered(fn[key])) !== sha(ordered(repeat?.[key]))) }));
    }
    process.exitCode = 0;
  } else {
  const databases = cli(['firestore:databases:list']);
  const staging = databases.find(db => db.name === `projects/${project}/databases/staging`);
  if (!staging || staging.type !== 'FIRESTORE_NATIVE') throw Error('Expected named staging database missing');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const auth = require('firebase-tools/lib/auth');
  const options = { project, nonInteractive: true };
  const account = auth.selectAccount(undefined, process.cwd());
  if (account) auth.setActiveAccount(options, account);
  await requireAuth(options);
  const rulesApi = require('firebase-tools/lib/gcp/rules');
  const releases = await rulesApi.listAllReleases(project);
  const productionRelease = releases.find(release => release.name === `projects/${project}/releases/cloud.firestore`);
  if (!productionRelease) throw Error('Production rules release missing');
  const productionFunctions = functions.filter(fn => fn.id !== 'onNewStagingChatMessage');
  const snapshot = { version: 2, project, database: 'staging', location: staging.locationId,
    productionFunctions: productionFunctions.map(fn => ({ id: fn.id, region: fn.region, sha256: sha(ordered(fn)) })),
    productionRules: productionRelease };
  if (process.argv.includes('--baseline')) {
    if (fs.existsSync(evidence)) throw Error('Baseline already exists; refusing replacement');
    fs.writeFileSync(evidence, JSON.stringify(snapshot, null, 2));
    console.log('Production function and default rules fingerprints saved; staging location:', staging.locationId);
  } else {
    const before = JSON.parse(fs.readFileSync(evidence));
    const functionsMatch = before.version === 2 ? sha(before.productionFunctions) === sha(snapshot.productionFunctions)
      : before.productionFunctions.length === productionFunctions.length && before.productionFunctions.every(saved => {
          const fn = productionFunctions.find(candidate => candidate.id === saved.id && candidate.region === saved.region);
          return fn && matchesLegacy(fn, saved.sha256);
        });
    if (!functionsMatch || sha(ordered(before.productionRules)) !== sha(ordered(snapshot.productionRules))) {
      throw Error('Production fingerprints changed; stop before further changes');
    }
    if (before.version !== 2) {
      fs.writeFileSync(evidence.replace('.json', '-legacy.json'), JSON.stringify(before, null, 2));
      fs.writeFileSync(evidence, JSON.stringify(snapshot, null, 2));
      console.log('Exact original fingerprint reproduced; comparison now ignores JSON map ordering.');
    }
    console.log('Production function and default rules are unchanged.');
  }
  console.log(JSON.stringify({ stagingLocation: staging.locationId,
    stagingFunction: functions.filter(fn => fn.id === 'onNewStagingChatMessage').map(fn => ({ id: fn.id, codebase: fn.codebase,
      database: fn.eventTrigger?.eventFilters?.database, region: fn.region, runtime: fn.runtime, state: fn.state,
      serviceAccount: fn.serviceAccount,
      secrets: fn.secretEnvironmentVariables?.map(secret => secret.key) })),
    stagingRules: releases.find(release => release.name === `projects/${project}/releases/cloud.firestore/staging`)?.rulesetName ?? null }));
  if (process.argv.includes('--verify-staging')) {
    const fn = functions.find(candidate => candidate.id === 'onNewStagingChatMessage');
    const account = `localcooks-staging-chat@${project}.iam.gserviceaccount.com`;
    if (!fn || fn.eventTrigger?.eventFilters?.database !== 'staging' || fn.runtime !== 'nodejs22'
      || fn.state !== 'ACTIVE' || fn.serviceAccount !== account) throw Error('Staging trigger deployment does not match its approved configuration');
    if (JSON.stringify(fn.secretEnvironmentVariables?.map(secret => secret.key).sort()) !== JSON.stringify(['STAGING_DATABASE_URL', 'STAGING_INNGEST_EVENT_KEY']))
      throw Error('Staging trigger must bind exactly its staging SQL and Inngest secrets');
    const release = releases.find(candidate => candidate.name === `projects/${project}/releases/cloud.firestore/staging`);
    const source = await rulesApi.getRulesetContent(release.rulesetName);
    if (!source.some(file => file.content === fs.readFileSync('firestore.rules', 'utf8')))
      throw Error('Deployed staging rules differ from reviewed rules');
    const secrets = require('firebase-tools/lib/gcp/secretManager');
    const member = `serviceAccount:${account}`;
    for (const name of ['STAGING_DATABASE_URL', 'STAGING_INNGEST_EVENT_KEY']) {
      const stagePolicy = await secrets.getIamPolicy({ projectId: project, name });
      if (!stagePolicy.bindings?.some(binding => binding.role === 'roles/secretmanager.secretAccessor' && binding.members.includes(member)))
        throw Error(`Approved staging identity lacks ${name} access`);
    }
    for (const name of ['DATABASE_URL', 'INNGEST_EVENT_KEY']) {
      try {
        const prodPolicy = await secrets.getIamPolicy({ projectId: project, name });
        if (prodPolicy.bindings?.some(binding => binding.members.includes(member))) throw Error(`Staging identity must not access ${name}`);
      } catch (error) {
        // Production may use legacy environment variables rather than secrets.
        if (error.status !== 404 && error.context?.response?.statusCode !== 404) throw error;
      }
    }
    const { Client } = require('firebase-tools/lib/apiv2');
    const resource = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', apiVersion: 'v1' });
    const policy = (await resource.post(`/projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).body;
    const bindings = policy.bindings.filter(binding => binding.members.includes(member));
    if (bindings.length !== 2 || !bindings.some(binding => binding.role === 'roles/eventarc.eventReceiver' && !binding.condition)
      || !bindings.some(binding => binding.role === 'roles/datastore.viewer'
        && binding.condition?.expression === `resource.name == "projects/${project}/databases/staging"`))
      throw Error('Staging project permissions differ from the approved database restriction');
    if (process.argv.includes('--verify-invoker')) {
      const deployed = await require('firebase-tools/lib/gcp/cloudfunctionsv2').getFunction(project, 'us-central1', fn.id);
      if (deployed.eventTrigger?.serviceAccountEmail !== account) throw Error('Event delivery identity must be the staging account');
      const runPolicy = await require('firebase-tools/lib/gcp/run').getIamPolicy(deployed.serviceConfig.service);
      if (!runPolicy.bindings?.some(binding => binding.role === 'roles/run.invoker' && binding.members.includes(member))
        || runPolicy.bindings.some(binding => binding.members.includes('allUsers') || binding.members.includes('allAuthenticatedUsers')))
        throw Error('Staging invocation must be private and allow the approved identity');
      console.log('Invocation restricted to the staging service; no broad project or Firebase Auth permissions granted.');
    }
    console.log('Staging trigger identity, database, SQL and Inngest secret permissions, and deployed rules verified.');
  }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  // CLI inspection may log full function environment variables. Keep no URLs
  // containing credentials in the workspace debug log or printed evidence.
  for (const path of ['firebase-debug.log', 'functions/firebase-debug.log']) if (fs.existsSync(path)) {
    fs.writeFileSync(path, fs.readFileSync(path, 'utf8').replace(/postgres(?:ql)?:\/\/[^\s"\\]+/g, '[REDACTED_DATABASE_URL]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/(https:\/\/inn\.gs\/e\/)[^\s"\\]+/g, '$1[REDACTED_EVENT_KEY]')
      .replace(/((?:STAGING_)?INNGEST_EVENT_KEY["']?\s*[:=]\s*["']?)[^\s"',}\\]+/g, '$1[REDACTED_EVENT_KEY]'));
  }
}
