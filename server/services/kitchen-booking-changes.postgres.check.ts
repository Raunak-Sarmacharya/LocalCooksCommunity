import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as schema from '@shared/schema';
import { workerContext } from './worker-context';
const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY') throw Error('Explicit isolated Supabase authorization required');
const endpoint = new URL(url);
if (!/(?:^|\.)supabase\.(?:co|com)$/.test(endpoint.hostname) || endpoint.port === '6543') throw Error('Only authorized Supabase session connection permitted');
process.env.DATABASE_URL = url;
const state = vi.hoisted(() => ({ queue: vi.fn(), available: true, failAfterUpdate: false, receipts: [] as any[], refundCalls: 0 }));
vi.mock('./stripe-service', () => ({
  verifyCancellationRefundFunding: async () => ({ transferId: null, available: null }),
  getCancellationPaymentFacts: async () => ({ captured: 12200, processingCost: 384, currency: 'cad', chargeId: 'ch_isolated',
    refunded: state.receipts.reduce((sum: number, item: any) => sum + item.amount, 0), refunds: state.receipts }),
  getPaymentIntentRefunds: async () => state.receipts,
  reverseTransferAndRefund: async (_intent: string, amount: number, _reason: string, options: any) => {
    let receipt = state.receipts.find(item => item.metadata.refund_operation_id === options.idempotencyKey);
    if (!receipt) { receipt = { id: 're_isolated', status: 'succeeded', amount, metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } }; state.receipts.push(receipt); state.refundCalls++; }
    return { refundId: receipt.id, refundAmount: amount, refundStatus: 'succeeded' };
  },
}));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn(async () => { if (state.failAfterUpdate) throw Error('isolated post-update failure'); }) }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: { validateBookingAvailability: vi.fn(async (_k: any, _d: any, _s: any, _e: any, options: any) => ({
  valid: state.available, error: 'fixture destination contention', slots: options.selectedSlots, windowStartTime: '08:00' })) } }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: vi.fn(async (amount: number) => ({ platformCommissionInCents: Math.round(amount * 0.05) })) }));
const namespace = `changes_4c_${randomUUID().replaceAll('-', '')}`;
// Advisory locks are database-wide: never use an actual application's positive kitchen ID.
const fixtureKitchenId = -Math.floor(Math.random() * 1_000_000_000 + 1);
const clients = [new Client({ connectionString: url, connectionTimeoutMillis: 10000 }), new Client({ connectionString: url, connectionTimeoutMillis: 10000 })];
const [first, second] = clients;
let created = false;
const chef = { id: 3, role: 'chef' }, manager = { id: 2, role: 'manager' };
const destination = { date: '2026-11-15', windowStart: '08:00', slots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }] };
async function scoped<T>(client: Client, operation: () => Promise<T>) {
  const deadline = performance.now() + 20000;
  return workerContext.run({ database: drizzle(client, { schema }), deadline, taskDeadline: deadline, cursors: {}, checkpoint: async () => {} }, operation);
}
beforeAll(async () => {
  for (const client of clients) { await client.connect(); await client.query("SELECT set_config('statement_timeout','25000',false), set_config('lock_timeout','20000',false), set_config('idle_in_transaction_session_timeout','10000',false)"); }
  await first.query(`CREATE SCHEMA "${namespace}"`); created = true;
  await first.query(`CREATE DOMAIN "${namespace}".booking_status AS public.booking_status`);
  for (const table of ['users', 'locations', 'kitchens', 'kitchen_bookings', 'kitchen_booking_visits', 'storage_bookings', 'equipment_bookings',
    'payment_transactions', 'payment_history', 'pending_storage_extensions', 'platform_settings', 'kitchen_checkout_holds', 'kitchen_viewings']) {
    await first.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`);
    const defaults = await first.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_default LIKE 'nextval(%'", [namespace, table]);
    for (const { column_name: column } of defaults.rows) {
      await first.query(`CREATE SEQUENCE "${namespace}"."${table}_${column}_seq"`);
      await first.query(`ALTER TABLE "${namespace}"."${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('"${namespace}"."${table}_${column}_seq"')`);
    }
  }
  for (const client of clients) await client.query(`SET search_path TO "${namespace}"`);
  await first.query("INSERT INTO users(id,username,password,role) VALUES(1,'staff@example.test','fixture','admin'),(2,'host@example.test','fixture','manager'),(3,'chef@example.test','fixture','chef')");
  await first.query("INSERT INTO locations(id,name,address,manager_id) VALUES(5,'Isolated location','Fixture address',2)");
  await first.query("INSERT INTO kitchens(id,name,location_id,is_active,listing_status,hourly_rate,tax_rate_percent) VALUES(4,'Isolated kitchen',5,true,'active',4000,15)");
  await first.query(`INSERT INTO kitchen_bookings(id,chef_id,kitchen_id,booking_date,start_time,end_time,operating_window_start_time,selected_slots,status,payment_status,total_price,hourly_rate,duration_hours,pricing_mode,payment_intent_id)
    VALUES(10,3,4,'2026-11-10T12:00:00','09:00','11:00','08:00',$1,'confirmed','paid',10000,5000,2,'hourly','pi_original')`, [JSON.stringify(destination.slots)]);
  await first.query(`INSERT INTO payment_transactions(booking_id,booking_type,chef_id,manager_id,amount,base_amount,tax_amount,service_fee,manager_revenue,net_amount,payment_intent_id,status,metadata)
    VALUES(10,'kitchen',3,2,12000,11500,1500,500,11500,12000,'pi_original','succeeded','{"approvedSubtotal":10000}')`);
  await first.query(`INSERT INTO platform_settings(key,value) VALUES('kitchen_change_policy',$1)`, [JSON.stringify({ version: 2, sameDayMove: 'current_difference', taxAndFee: 'incremental_current', decisionHours: 24, paymentHours: 24, linkedItems: 'reconfirm', refunds: 'original_tax_keep_fee', authorization: 'before_manager_approval' })]);
  await first.query('UPDATE kitchens SET id=$1', [fixtureKitchenId]);
  await first.query('UPDATE kitchen_bookings SET kitchen_id=$1', [fixtureKitchenId]);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
});
afterAll(async () => {
  vi.restoreAllMocks();
  try { if (created) { await first.query(`DROP SCHEMA "${namespace}" CASCADE`);
    const remaining = await first.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname=$1', [namespace]);
    console.log(`Own isolated changes_4c schema remaining: ${remaining.rows[0].count}`); expect(remaining.rows[0].count).toBe(0); } }
  finally { await Promise.all(clients.map(client => client.end())); const { pool } = await import('../db'); await pool.end(); }
});
const historicalRequestKey = randomUUID();
const historicalQuote = { originalKitchenCents: 10000, currentKitchenCents: 12000, retainedKitchenCents: 12000,
  addedKitchenCents: 2000, taxCents: 300, feeCents: 100, payableCents: 2400, currency: 'CAD',
  refundKitchenCents: 0, refundTaxCents: 0, refundableCents: 0 };
async function seedHistoricalRequest() {
  const booking = (await first.query('SELECT * FROM kitchen_bookings WHERE id=10')).rows[0];
  const original = { date: '2026-11-10', windowStart: '08:00', pricingMode: 'hourly', slots: destination.slots };
  const selected = (await first.query("SELECT value FROM platform_settings WHERE key='kitchen_change_policy'")).rows[0].value;
  await first.query(`INSERT INTO kitchen_booking_changes(id,booking_id,request_key,kind,state,original,destination,quote,policy,booking_version,decision_by,payment_by,manager_id,history)
    VALUES('historical_fixture',10,$1,'move','requested',$2,$3,$4,$5,$6,'2026-11-09T12:00:00','2026-11-09T12:00:00',2,'[]')`,
    [historicalRequestKey, JSON.stringify(original), JSON.stringify(destination), JSON.stringify(historicalQuote), selected, booking.updated_at]);
}
describe('isolated additive 4C upgrade and transactional money/schedule safety', () => {
  it('without SQL0061, ordinary reads and direct recovery calls return explicit compatibility outcomes', async () => {
    const { readKitchenChanges, requestKitchenChange, decideKitchenChange, expireKitchenChanges } = await import('./kitchen-booking-changes');
    expect((await scoped(first, () => readKitchenChanges(10, chef))).changes).toEqual([]);
    expect(await scoped(first, () => expireKitchenChanges())).toEqual({ checked: 0 });
    await expect(scoped(first, () => requestKitchenChange(10, chef, { kind: 'move', destination, requestKey: historicalRequestKey,
      quote: historicalQuote, expectedUpdatedAt: new Date().toISOString() }))).rejects.toThrow('Historical change records are unavailable');
    await expect(scoped(first, () => decideKitchenChange(10, 'missing', manager, { action: 'decline', revision: 1 }))).rejects.toThrow('Historical change records are unavailable');
  });
  it('applies migration twice without altering historical booking/payment data', async () => {
    const before = (await first.query('SELECT * FROM kitchen_bookings')).rows;
    const migration = readFileSync('migrations/0061_kitchen_booking_changes.sql', 'utf8');
    await first.query(migration); await first.query(migration);
    expect((await first.query('SELECT * FROM kitchen_bookings')).rows).toEqual(before);
    expect((await first.query('SELECT amount FROM payment_transactions')).rows[0].amount).toBe('12000');
  });
  it('new moves and extensions are rejected without writing a change or altering the reservation', async () => {
    const { previewKitchenChange, requestKitchenChange } = await import('./kitchen-booking-changes');
    for (const kind of ['move', 'extend'] as const) {
      await expect(scoped(first, () => previewKitchenChange(10, chef, kind, destination))).rejects.toThrow('cannot be rescheduled');
      await expect(scoped(first, () => requestKitchenChange(10, chef, { kind, destination, requestKey: randomUUID(),
        quote: historicalQuote, expectedUpdatedAt: new Date().toISOString() }))).rejects.toThrow('cannot be rescheduled');
    }
    expect((await first.query('SELECT count(*)::integer AS n FROM kitchen_booking_changes')).rows[0].n).toBe(0);
    expect((await first.query('SELECT booking_date FROM kitchen_bookings')).rows[0].booking_date.toISOString()).toContain('2026-11-10');
  });
  it('real concurrent replay preserves a seeded historical row and its original commitment', async () => {
    await seedHistoricalRequest();
    const { requestKitchenChange } = await import('./kitchen-booking-changes');
    const results = await Promise.all(clients.map(client => scoped(client, () => requestKitchenChange(10, chef, {
      kind: 'move', destination, requestKey: historicalRequestKey, quote: historicalQuote, expectedUpdatedAt: new Date().toISOString(),
    }))));
    expect(results[0].id).toBe(results[1].id);
    expect((await first.query('SELECT count(*)::integer AS n FROM kitchen_booking_changes')).rows[0].n).toBe(1);
    expect((await first.query('SELECT booking_date FROM kitchen_bookings')).rows[0].booking_date.toISOString()).toContain('2026-11-10');
  });
  it('failed notification intent rolls back the actual decision and schedule', async () => {
    const { decideKitchenChange } = await import('./kitchen-booking-changes');
    const change = (await first.query('SELECT * FROM kitchen_booking_changes')).rows[0];
    state.queue.mockRejectedValueOnce(Error('isolated outbox failure'));
    await expect(scoped(first, () => decideKitchenChange(10, change.id, manager, { action: 'decline', revision: change.revision }))).rejects.toThrow('outbox failure');
    expect((await first.query('SELECT state FROM kitchen_booking_changes')).rows[0].state).toBe('requested');
    expect((await first.query('SELECT booking_date FROM kitchen_bookings')).rows[0].booking_date.toISOString()).toContain('2026-11-10');
  });
  it('real savepoint retains successful funds but rolls back a failed schedule/reminder commit', async () => {
    const { reconcileKitchenChangePayment } = await import('./kitchen-booking-changes');
    const change = (await first.query('SELECT * FROM kitchen_booking_changes')).rows[0];
    // Mocked provider success only. Freeze a payment revision as checkout normally does.
    await first.query(`UPDATE kitchen_booking_changes SET state='payment_pending', revision=revision+1,
      history=history || jsonb_build_array(jsonb_build_object('revision',revision+1,'state','payment_pending'))`);
    const pending = (await first.query('SELECT * FROM kitchen_booking_changes')).rows[0];
    await first.query(`INSERT INTO kitchen_checkout_holds(id,kitchen_id,chef_id,operating_date,window_start_time,selected_slots,expires_at)
      VALUES('hold_fixture',$1,3,'2026-11-15','08:00',$2,$3)`, [fixtureKitchenId, JSON.stringify(destination.slots), pending.payment_by]);
    // Durable manager approval fixture; no provider operation is invoked in this isolated test.
    await first.query(`UPDATE kitchen_booking_changes SET state='capture_pending', hold_id='hold_fixture', revision=revision+1,
      history=history || jsonb_build_array(jsonb_build_object('revision',revision+1,'state','capture_pending'))`);
    state.failAfterUpdate = true;
    const intent: any = { id: 'pi_extra', status: 'succeeded', currency: 'cad', amount_received: 2400, latest_charge: 'ch_extra',
      metadata: { type: 'kitchen_booking_change', kitchen_change_id: change.id, booking_id: '10', chef_id: '3', change_revision: String(pending.revision) } };
    expect((await scoped(first, () => reconcileKitchenChangePayment(intent)))?.applied).toBe(false);
    expect((await first.query('SELECT state,intent_id FROM kitchen_booking_changes')).rows[0]).toEqual({ state: 'recovery_required', intent_id: 'pi_extra' });
    expect((await first.query('SELECT booking_date FROM kitchen_bookings')).rows[0].booking_date.toISOString()).toContain('2026-11-10');
    expect((await first.query("SELECT metadata->'originalBookingSchedule' AS receipt FROM payment_transactions WHERE payment_intent_id='pi_original'")).rows[0].receipt).toBeNull();
    expect((await first.query("SELECT count(*)::integer AS n FROM payment_transactions WHERE payment_intent_id='pi_extra'")).rows[0].n).toBe(1);
    await scoped(first, () => reconcileKitchenChangePayment(intent));
    expect((await first.query("SELECT count(*)::integer AS n FROM payment_transactions WHERE payment_intent_id='pi_extra'")).rows[0].n).toBe(1);
  });
  it('a late payout callback cannot overwrite a committed refund receipt, request decision or payment status', async () => {
    const { updatePaymentTransaction } = await import('./payment-transactions-service');
    const source = (await first.query("SELECT id FROM payment_transactions WHERE payment_intent_id='pi_original'")).rows[0];
    const receipt = { id: 're_fixture', customerReceived: 2300, managerDebited: 2300, platformServiceFeeReturned: 0 };
    await first.query(`UPDATE payment_transactions SET status='partially_refunded',refund_amount=2300,metadata=$1 WHERE id=$2`,
      [JSON.stringify({ refunds: [receipt], lastRefund: receipt, fullRefundRequest: { status: 'rejected' } }), source.id]);
    await scoped(second, async () => updatePaymentTransaction(source.id, { status: 'succeeded', stripeAmount: 12000,
      stripeNetAmount: 8816, stripeProcessingFee: 384, metadata: { refunds: [], lastRefund: null,
        fullRefundRequest: { status: 'pending' }, transfer: { transferId: 'tr_fixture' } } }, (await import('../db')).db));
    const updated = (await first.query('SELECT status,refund_amount,net_amount,metadata FROM payment_transactions WHERE id=$1', [source.id])).rows[0];
    expect(updated.status).toBe('partially_refunded'); expect(updated.refund_amount).toBe('2300'); expect(updated.net_amount).toBe('9700');
    expect(updated.metadata.refunds).toEqual([receipt]); expect(updated.metadata.lastRefund).toEqual(receipt);
    expect(updated.metadata.fullRefundRequest.status).toBe('rejected');
    expect(updated.metadata.transfer.transferId).toBe('tr_fixture');
  });
  it('real concurrent quoted acceptance serializes sources and initiates one mocked refund', async () => {
    const { readCancellationRefund, acceptCancellationRefund } = await import('./booking-cancellation-refund');
    state.receipts = []; state.refundCalls = 0;
    await first.query("DELETE FROM payment_transactions WHERE payment_intent_id != 'pi_original'");
    await first.query(`UPDATE kitchen_bookings SET status='cancellation_requested', cancellation_requested_at=CURRENT_TIMESTAMP,
      cancellation_policy_hours=24, booking_date='2099-11-10T12:00:00', updated_at=CURRENT_TIMESTAMP WHERE id=10`);
    await first.query(`UPDATE payment_transactions SET amount=12200,base_amount=11500,service_fee=700,manager_revenue=11116,
      stripe_processing_fee=384,refund_amount=0,status='succeeded',metadata='{}' WHERE payment_intent_id='pi_original'`);
    const quote = await scoped(first, () => readCancellationRefund(10, 2, 'manager')) as any;
    expect(quote.sources[0].managerRefund).toBe(11116);
    const outcomes = await Promise.all(clients.map(client => scoped(client, () => acceptCancellationRefund(10, 2, quote.quoteHash))));
    expect(outcomes.every((item: any) => item.accepted)).toBe(true); expect(state.refundCalls).toBe(1);
    const source = (await first.query("SELECT refund_amount,metadata FROM payment_transactions WHERE payment_intent_id='pi_original'")).rows[0];
    expect(source.refund_amount).toBe('11116'); expect(source.metadata.cancellationRefundOperation.status).toBe('succeeded');
    expect(source.metadata.refunds[0].platformServiceFeeReturned).toBe(0);
  });
  it('a real competing source lock changes the quote before acceptance can spend it', async () => {
    const { readCancellationRefund, acceptCancellationRefund } = await import('./booking-cancellation-refund');
    state.receipts = []; state.refundCalls = 0;
    await first.query(`UPDATE kitchen_bookings SET status='cancellation_requested', cancellation_requested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=10`);
    await first.query(`UPDATE payment_transactions SET refund_amount=0,status='succeeded',metadata='{}',updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id='pi_original'`);
    const quote = await scoped(first, () => readCancellationRefund(10, 2, 'manager')) as any;
    await first.query('BEGIN');
    try {
      await first.query("SELECT id FROM payment_transactions WHERE payment_intent_id='pi_original' FOR UPDATE");
      const acceptance = scoped(second, () => acceptCancellationRefund(10, 2, quote.quoteHash));
      const settled = acceptance.then(value => ({ value, error: null }), error => ({ value: null, error }));
      state.receipts = [{ id: 're_competing', status: 'succeeded', amount: 2300, metadata: { customer_receives: '2300', manager_debited: '2300', platform_service_fee_returned: '0' } }];
      await first.query(`UPDATE payment_transactions SET refund_amount=2300,status='partially_refunded',updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id='pi_original'`);
      await first.query('COMMIT');
      expect((await settled).error?.message).toContain('quote changed');
      expect(state.refundCalls).toBe(0);
      expect((await first.query('SELECT status FROM kitchen_bookings WHERE id=10')).rows[0].status).toBe('cancellation_requested');
    } catch (error) { await first.query('ROLLBACK'); throw error; }
  });

});
