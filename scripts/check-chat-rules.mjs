// Isolated enforcement, never production: firebase emulators:exec --project
// demo-localcooks-chat --config firebase.emulators.json --only auth,firestore "node scripts/check-chat-rules.mjs"
import assert from 'node:assert/strict';
const project = 'demo-localcooks-chat';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
for (const host of [firestoreHost, authHost]) assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Local emulators required');
const signed = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'participant@fixture.test', password: 'isolated-fixture-123', returnSecureToken: true }),
});
assert.equal(signed.status, 200); const { idToken, localId } = await signed.json();
const root = `http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents`;
const fields = value => Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }]));
const call = (path, method, token, value) => fetch(`${root}/${path}`, { method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(value ? { body: JSON.stringify({ fields: fields(value) }) } : {}) });
for (const [path, value] of [
  ['conversations/history', { chefId: 3, managerId: 2, locationId: 5, chefFirebaseUid: localId, managerFirebaseUid: 'other' }],
  ['conversations/history/messages/old', { senderId: 2, senderRole: 'manager', content: 'immutable history' }],
  ['chatRelationships/chef-3-location-5', { conversationId: 'history' }],
]) assert.equal((await call(path, 'PATCH', 'owner', value)).status, 200, 'Admin emulator seed');
for (const [path, method, value] of [
  ['conversations/history', 'GET'], ['conversations/history/messages/old', 'GET'],
  ['conversations/new', 'PATCH', { chefFirebaseUid: localId }],
  ['conversations/history', 'PATCH', { managerFirebaseUid: localId }],
  ['conversations/history/messages/new', 'PATCH', { senderId: 3, senderRole: 'chef', content: 'direct write' }],
  ['conversations/history/messages/old', 'PATCH', { senderRole: 'system', content: 'rewrite' }],
  ['chatRelationships/chef-3-location-5', 'PATCH', { conversationId: 'forged' }],
  ['chatAttachments/new', 'PATCH', { uploaderId: 3 }],
]) {
  const result = await call(path, method, idToken, value);
  assert.equal(result.status, 403, `${method} ${path} must be denied`);
}
assert.equal((await call(`users/${localId}`, 'PATCH', idToken, { email: 'participant@fixture.test', displayName: 'Fixture' })).status, 200);
assert.equal((await call(`users/${localId}`, 'GET', idToken)).status, 200);
assert.equal((await call(`users/${localId}`, 'PATCH', idToken, { email: 'participant@fixture.test', role: 'admin' })).status, 403);
assert.equal((await call('users/other', 'GET', idToken)).status, 403);
assert.equal((await fetch(`${root}/conversations/history`)).status, 403);
console.log('13 isolated rules checks passed: chat denies, own profile access, role escalation, foreign profile and unauthenticated access.');
