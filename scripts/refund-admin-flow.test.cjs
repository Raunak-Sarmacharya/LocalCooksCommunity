const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

// Exercise the actual admin handler without Stripe charges or a live database.
const source = fs.readFileSync('server/routes/admin.ts', 'utf8');
const start = source.indexOf('router.post("/transactions/:transactionId/full-refund-request/decision"');
const end = source.indexOf('\n// ============================================================================', start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const table = name => new Proxy({ name }, { get: (o, k) => k === 'name' ? name : `${name}.${String(k)}` });
let handler, record, failCommit, stripeCalls, tail;
let updates = [];
const stripeResults = new Map();
const service = {
  findPaymentTransactionById: async (_id, tx) => structuredClone(tx.record),
  updatePaymentTransaction: async (_id, patch, tx) => {
    Object.assign(tx.record, patch);
    if (patch.refundAmount !== undefined) tx.record.refund_amount = patch.refundAmount;
  },
  addPaymentHistory: async () => {},
};
const db = { transaction: async fn => {
  const previous = tail;
  let release;
  tail = new Promise(resolve => release = resolve);
  await previous;
  const tx = { record: structuredClone(record), execute: async () => {}, update: t => ({ set: patch => ({ where: async () => updates.push({ table: t.name, patch }) }) }) };
  try {
    const result = await fn(tx);
    if (failCommit) { failCommit = false; throw new Error('Simulated commit failure'); }
    record = tx.record;
    return result;
  } finally { release(); }
} };
const stripe = { reverseTransferAndRefund: async (_intent, amount, _reason, options) => {
  assert.ok(options.idempotencyKey);
  if (!stripeResults.has(options.idempotencyKey)) {
    stripeCalls++;
    stripeResults.set(options.idempotencyKey, { refundId: 're_test', refundStatus: 'succeeded', refundAmount: amount, transferReversalId: 'trr_test' });
  }
  return stripeResults.get(options.idempotencyKey);
} };
vm.runInNewContext(code, {
  router: { post: (...args) => handler = args.at(-1) }, requireFirebaseAuthWithUser: () => {}, requireAdmin: () => {},
  db, sql: () => '', eq: (...x) => x, and: (...x) => x, inArray: (...x) => x,
  kitchenBookings: table('kitchen'), storageBookings: table('storage'), equipmentBookings: table('equipment'),
  logger: { error: () => {} }, require: path => path.includes('payment-transactions') ? service : stripe,
});
function reset() {
  record = { id: 1, booking_id: 40, booking_type: 'bundle', manager_id: 3, status: 'succeeded', amount: '10000', refund_amount: '0', stripe_processing_fee: '300', manager_revenue: '9000', service_fee: '700', payment_intent_id: 'pi_test', metadata: { fullRefundRequest: { status: 'pending', requestedAt: '2026-09-28T10:00:00Z' } } };
  tail = Promise.resolve(); failCommit = false; stripeCalls = 0; stripeResults.clear(); updates = [];
}
async function call(decision = 'approve', amount) {
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ neonUser: { id: 2 }, params: { transactionId: '1' }, body: { decision, amount } }, res);
  return res;
}
(async () => {
  reset();
  const concurrent = await Promise.all([call(), call()]);
  assert.deepEqual(concurrent.map(r => r.code).sort(), [200, 409]);
  assert.equal(stripeCalls, 1);
  assert.equal(record.metadata.fullRefundRequest.status, 'approved');
  assert.deepEqual(updates.map(x => x.table), ['kitchen', 'storage', 'equipment']);
  reset(); failCommit = true;
  assert.equal((await call()).code, 500);
  assert.equal(record.metadata.fullRefundRequest.status, 'pending');
  assert.equal((await call()).code, 200);
  assert.equal(stripeCalls, 1, 'Retry must reuse the Stripe operation');
  reset(); assert.equal((await call('reject')).code, 200); assert.equal(stripeCalls, 0); assert.equal(record.metadata.fullRefundRequest.status, 'rejected');
  reset(); assert.equal((await call('approve', 100)).code, 200); assert.deepEqual(updates.map(x => x.table), ['kitchen'], 'Unallocated partial refunds must not mark all linked items refunded');
  reset(); assert.equal((await call('approve', 20000)).code, 400); assert.equal(stripeCalls, 0);
  console.log('Admin refund flow: concurrency, rollback/retry, rejection, linked status and amount limits passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
