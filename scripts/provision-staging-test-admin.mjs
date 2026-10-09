import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// One-time, owner-authorized staging provisioning. Never grant shared Firebase role claims.
assert.equal(process.argv[2], '--staging', 'Explicit --staging is required');
const env = dotenv.parse(fs.readFileSync('.env'));
const url = new URL(env.DATABASE_URL);
assert.equal(url.hostname, 'aws-1-ca-central-1.pooler.supabase.com');
assert.equal(url.username, 'postgres.zjiaghzmmgvswsllzxip', 'Expected staging project');
assert.equal(env.FIREBASE_PROJECT_ID, 'formauth-9e620');
const email = 'test_admin@localcooks.ca';
const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 7000 });
const app = initializeApp({ credential: cert({ projectId: env.FIREBASE_PROJECT_ID,
  clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
const auth = getAuth(app);
let createdUid, committed = false;
try {
  await client.connect();
  const prior = (await client.query('SELECT id, role, firebase_uid FROM users WHERE lower(username)=$1', [email])).rows[0];
  assert.ok(!prior || prior.role === 'admin', 'Existing non-admin account requires separate review');
  let identity;
  try { identity = await auth.getUserByEmail(email); }
  catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    // Email-link sign-in proves mailbox ownership. No chosen password or fabricated verification.
    identity = await auth.createUser({ email, displayName: 'Local Cooks Test Admin', emailVerified: false });
    createdUid = identity.uid;
  }
  assert.equal(identity.disabled, false, 'Existing Firebase account is disabled');
  assert.ok(!prior?.firebase_uid || prior.firebase_uid === identity.uid, 'Identity linkage mismatch');
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  const before = (await client.query("SELECT array_agg(id) AS ids, md5(string_agg((to_jsonb(u)-'admin_email_notifications')::text,'' ORDER BY id)) AS digest FROM users u")).rows[0];
  await client.query(fs.readFileSync('migrations/0070_admin_email_notifications.sql', 'utf8'));
  if (!prior) await client.query(`INSERT INTO users
    (username,password,role,firebase_uid,is_chef,is_manager,is_verified,has_seen_welcome,manager_profile_data,admin_email_notifications)
    VALUES ($1,$2,'admin',$3,true,false,$4,true,$5,true)`,
    [email, `firebase_auth_${randomBytes(24).toString('hex')}`, identity.uid, identity.emailVerified,
      JSON.stringify({ fullName: 'Local Cooks Test Admin' })]);
  await client.query("UPDATE users SET admin_email_notifications=(lower(username)=$1) WHERE role='admin'", [email]);
  await client.query("UPDATE users SET admin_email_notifications=false WHERE role IS DISTINCT FROM 'admin'");
  const after = (await client.query("SELECT md5(string_agg((to_jsonb(u)-'admin_email_notifications')::text,'' ORDER BY id)) AS digest FROM users u WHERE id=ANY($1::int[])", [before.ids])).rows[0];
  assert.equal(after.digest, before.digest, 'Existing account fields changed; rolling back');
  const recipients = (await client.query("SELECT id,username FROM users WHERE role='admin' AND admin_email_notifications")).rows;
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].username, email);
  await client.query('COMMIT');
  committed = true;
  console.log(JSON.stringify({ applied: true, project: 'zjiaghzmmgvswsllzxip',
    admin: recipients[0], emailVerified: identity.emailVerified, existingAccountFieldsPreserved: true,
    productionDatabaseChanged: false, supportMailboxRoutingChanged: false }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  if (createdUid && !committed) await auth.deleteUser(createdUid).catch(() => {});
  console.error(JSON.stringify({ applied: false, code: error.code || 'provisioning_failed', message: error.code ? undefined : error.message }));
  process.exitCode = 1;
} finally { await client.end(); await deleteApp(app); }
