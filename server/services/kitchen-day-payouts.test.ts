/** Real Postgres SQL/transactions; provider and delivery are in-memory. No external services. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import * as s from '@shared/schema';
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { createTestDatabase } from './kitchen-booking-changes.pglite';
const h = vi.hoisted(() => ({ db: null as any, client: null as any, transfers: [] as any[], lose: false, more: false,
  inProvider: false, charge: {} as any, event: vi.fn(), create: vi.fn(), evidence: {} as any }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.event }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./stripe-service', () => ({ getStripeClient: () => ({ transfers: { create: h.create, list: async () => ({ data: structuredClone(h.transfers), has_more: h.more }) },
  charges: { retrieve: async () => h.charge } }), getDatedCaptureEvidence: async () => h.evidence }));
import { dayEntitlement, ensureDayPayoutRows, releaseDayPayout, releaseBookingDayPayouts, readDayPayouts, sweepDayPayouts, flushDayPayoutNotices, summarizeDayPayouts } from './kitchen-day-payouts';
import { partitionDatedSupplement, syncDayPayoutSource } from './kitchen-day-payout-sources';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { dayPaidSql, dayPendingSql } from './revenue-service-v2';

beforeAll(async () => {
  const ddl = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const ledger = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), ddl.indexOf('DROP TRIGGER'));
  const test = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.paymentTransactions,
    s.equipmentBookings, s.storageBookings, s.bookingFlags, s.supportActions, s.commitmentProblems, s.kitchenBookingChanges,
    s.kitchenBookingExtensions, s.paymentHistory], [ledger,
    'ALTER TABLE booking_flags DROP COLUMN visit_id; ALTER TABLE commitment_problems DROP COLUMN visit_id',
    readFileSync('migrations/0102_day_payout_problem_scope.sql', 'utf8')]);
  h.db = test.db; h.client = test.client;
}, 60_000);
afterAll(async () => { await h.client?.close(); });
const now = () => new Date('2099-10-06T14:00:00Z');
const get = async (table: any) => h.db.select().from(table);
const day = async (index = 0) => (await get(s.kitchenBookingDayPayouts)).sort((a: any, b: any) => a.id - b.id)[index];
beforeEach(async () => {
  await h.client.exec('TRUNCATE users, locations, kitchens, kitchen_bookings, kitchen_booking_visits, payment_transactions, kitchen_booking_day_allocations, kitchen_booking_day_payouts, booking_flags, commitment_problems, support_actions, kitchen_booking_changes, kitchen_booking_extensions, payment_history RESTART IDENTITY CASCADE');
  h.transfers = []; h.lose = false; h.more = false; h.event.mockReset(); h.create.mockReset();
  await h.db.insert(s.users).values([{ id: 2, username: 'manager@test.invalid', password: 'test', role: 'manager', stripeConnectAccountId: 'acct_daily' }, { id: 3, username: 'chef@test.invalid', password: 'test', role: 'chef' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Test', address: 'Test', timezone: 'UTC' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Kitchen', hourlyRate: '1000' });
  const [booking] = await h.db.insert(s.kitchenBookings).values({ id: 1, kitchenId: 4, chefId: 3, bookingDate: new Date('2099-10-05'),
    startTime: '10:00', endTime: '12:00', totalPrice: '4000', status: 'confirmed', scheduleRevision: 1, paymentIntentId: 'pi_days' }).returning();
  const visits = await h.db.insert(s.kitchenBookingVisits).values([0, 1].map(i => ({ id: i + 1, bookingId: 1, blockIndex: i, visitDate: i ? '2099-10-07' : '2099-10-05',
    scheduleRevision: 1, startTime: '10:00', endTime: '12:00', operatingWindowStartTime: '08:00',
    checkinStatus: i ? 'not_checked_in' : 'checked_out', checkoutApprovedBy: i ? null : 2, checkoutApprovedAt: i ? null : new Date('2099-10-05T12:30:00Z') }))).returning();
  const clock = makeCloseoutSnapshot(booking, 'UTC', { serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }, visits);
  await h.db.update(s.kitchenBookings).set({ visitDuties: { clockCloseout: clock } }).where(eq(s.kitchenBookings.id, 1));
  await h.db.insert(s.paymentTransactions).values({ id: 1, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '4680', baseAmount: '4600',
    serviceFee: '80', taxAmount: '600', stripeProcessingFee: '200', managerRevenue: '4400', netAmount: '4480', status: 'succeeded', currency: 'cad',
    paymentIntentId: 'pi_days', chargeId: 'ch_days', payoutPartition: 'per_day', payoutTiming: 'after_closeout' });
  await h.db.insert(s.kitchenBookingDayAllocations).values([1, 2].map(visitId => ({ sourceId: 1, visitId, componentKey: 'kitchen', subtotalCents: 2000,
    taxCents: 300, serviceFeeCents: 40, stripeFeeCents: 100, evidence: { chargeId: 'ch_days', balanceTransactionId: 'bt_days' } })));
  await h.db.transaction((tx: any) => ensureDayPayoutRows(tx, 1));
  h.charge = { id: 'ch_days', payment_intent: 'pi_days', paid: true, captured: true, currency: 'cad', amount_captured: 4680, amount_refunded: 0 };
  h.create.mockImplementation(async (params: any, options: any) => {
    const rows = await get(s.kitchenBookingDayPayouts);
    const frozen = rows.find((r: any) => r.operationKey === options.idempotencyKey);
    expect(frozen.evidence.state).toBe('pending'); expect(frozen.transferAmountCents).toBe(params.amount);
    await expect(assertBookingMoneyWritable({ paymentTransactionId: 1 })).rejects.toThrow('paused');
    let transfer = h.transfers.find(t => t.metadata.operation_key === options.idempotencyKey);
    if (!transfer) { transfer = { id: `tr_${h.transfers.length + 1}`, ...structuredClone(params), amount_reversed: 0 }; h.transfers.push(transfer); }
    if (h.lose) throw Error('lost transfer response');
    return transfer;
  });
});

describe('CP5 daily releases', () => {
  it('pays day 1 while day 2 is upcoming; stores no parent transfer and pays day 2 separately', async () => {
    const one = await day(), two = await day(1);
    expect(await releaseDayPayout(one.id, now())).toMatchObject({ transferred: true });
    expect(await releaseDayPayout(two.id, now())).toMatchObject({ transferred: false });
    expect(h.transfers.map(t => t.amount)).toEqual([2200]);
    expect(h.transfers[0]).toMatchObject({ source_transaction: 'ch_days', metadata: { visit_id: '1', operating_date: '2099-10-05', installment_id: String(one.id), operation_key: 'kitchen-day-transfer:1:1:1' } });
    expect((await get(s.paymentTransactions))[0].transferId).toBeNull();
    await releaseDayPayout(two.id, new Date('2099-10-08T12:00:00Z'));
    expect(h.transfers.map(t => t.amount)).toEqual([2200, 2200]);
  });
  it('auto-closes at 24h, preserving a late actual departure deadline', async () => {
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checkout_requested', checkoutApprovedBy: null,
      checkoutRequestedAt: new Date('2099-10-05T15:00:00Z') }).where(eq(s.kitchenBookingVisits.id, 1));
    expect((await releaseDayPayout((await day()).id, now())).transferred).toBe(false);
    expect((await releaseDayPayout((await day()).id, new Date('2099-10-06T15:00:00Z'))).transferred).toBe(true);
  });
  it('holds only the day of a chef problem; resolution releases it', async () => {
    await h.db.insert(s.commitmentProblems).values({ sourceKey: 'one', kind: 'live', bookingId: 1, visitId: 2, reportedBy: 3, description: 'Problem on second day' });
    await releaseDayPayout((await day()).id, now());
    expect(h.transfers).toHaveLength(1);
    await releaseDayPayout((await day(1)).id, new Date('2099-10-08T14:00:00Z'));
    expect((await day(1)).holdReason).toBe('reported_issue');
    await h.db.update(s.commitmentProblems).set({ status: 'resolved' });
    await releaseDayPayout((await day(1)).id, new Date('2099-10-08T14:00:00Z'));
    expect(h.transfers).toHaveLength(2);
  });
  it('holds a manager operational problem on its visit, independently of damage claims', async () => {
    await h.db.insert(s.commitmentProblems).values({ sourceKey: 'manager-problem', kind: 'live', bookingId: 1, visitId: 1, reportedBy: 2, description: 'Operational access problem' });
    await releaseDayPayout((await day()).id, now()); expect(h.create).not.toHaveBeenCalled();
    expect((await day()).holdReason).toBe('reported_issue');
  });
  it('keeps an unscoped problem booking-wide and ignores a manager damage claim', async () => {
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checkout_claim_filed' }).where(eq(s.kitchenBookingVisits.id, 1));
    await h.db.insert(s.commitmentProblems).values({ sourceKey: 'all', kind: 'live', bookingId: 1, reportedBy: 3, description: 'Booking-wide problem' });
    expect((await releaseDayPayout((await day()).id, now())).transferred).toBe(false);
    await h.db.update(s.commitmentProblems).set({ status: 'resolved' });
    expect((await releaseDayPayout((await day()).id, now())).transferred).toBe(true);
  });
  it('pays delivered days through a chargeback while refunds remain frozen, including transfer-id lookup', async () => {
    await h.db.insert(s.bookingFlags).values({ bookingId: 1, kind: 'chargeback', providerRef: 'dp_one' });
    await expect(assertBookingMoneyWritable({ paymentTransactionId: 1 })).rejects.toThrow('paused');
    await expect(assertBookingMoneyWritable({ paymentTransactionId: 1, payout: true })).resolves.toBeUndefined();
    await releaseDayPayout((await day()).id, now());
    await expect(assertBookingMoneyWritable({ transferId: 'tr_1' })).rejects.toThrow('paused');
    await expect(assertBookingMoneyWritable({ transferId: 'tr_1', payout: true })).resolves.toBeUndefined();
  });
  it('scopes manual flags to the selected day for payout but keeps refunds frozen source-wide', async () => {
    await h.db.insert(s.bookingFlags).values({ bookingId: 1, visitId: 2, kind: 'manual_hold' });
    await releaseDayPayout((await day()).id, now()); expect(h.transfers).toHaveLength(1);
    await expect(assertBookingMoneyWritable({ paymentTransactionId: 1 })).rejects.toThrow('paused');
    await releaseDayPayout((await day(1)).id, new Date('2099-10-08T14:00:00Z'));
    expect((await day(1)).holdReason).toBe('support_flag');
  });
  it('preserves zero-entitlement terminal rows without a transfer', async () => {
    await h.db.update(s.kitchenBookingDayAllocations).set({ evidence: { chargeId: 'ch_days', managerDebitedCents: 2200 } }).where(eq(s.kitchenBookingDayAllocations.visitId, 1));
    await releaseDayPayout((await day()).id, now()); await releaseDayPayout((await day()).id, now());
    expect(await day()).toMatchObject({ noEntitlement: true, transferAmountCents: 0 }); expect(h.create).not.toHaveBeenCalled();
  });
  it('waits for an actual fee; a verified zero fee is allowed', async () => {
    await h.db.update(s.kitchenBookingDayAllocations).set({ stripeFeeCents: null }).where(eq(s.kitchenBookingDayAllocations.visitId, 1));
    await releaseDayPayout((await day()).id, now()); expect((await day()).holdReason).toBe('waiting_fee');
    expect((await readDayPayouts([1]))[0].feePending).toBe(true);
    await h.db.update(s.kitchenBookingDayAllocations).set({ stripeFeeCents: 0 }).where(eq(s.kitchenBookingDayAllocations.visitId, 1));
    await releaseDayPayout((await day()).id, now()); expect(h.transfers[0].amount).toBe(2300);
  });
  it('blocks a release reserved by a refund; never leaves a transfer reservation', async () => {
    await h.db.update(s.paymentTransactions).set({ metadata: { cancellationRefundOperation: { status: 'pending' } } });
    await releaseDayPayout((await day()).id, now());
    expect((await day()).releasedAt).toBeNull(); expect(h.create).not.toHaveBeenCalled();
  });
  it('freezes cents/destination/charge across a lost response, then reconciles without a second create', async () => {
    h.lose = true;
    await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('lost');
    await h.db.update(s.users).set({ stripeConnectAccountId: 'acct_changed' }).where(eq(s.users.id, 2));
    await h.db.insert(s.bookingFlags).values({ bookingId: 1, kind: 'manual_hold' });
    await h.db.update(s.kitchenBookingDayAllocations).set({ evidence: { managerDebitedCents: 1000 } }).where(eq(s.kitchenBookingDayAllocations.visitId, 1));
    await releaseDayPayout((await day()).id, now());
    expect((await day()).transferId).toBe('tr_1'); expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.transfers[0].destination).toBe('acct_daily'); expect(h.transfers[0].amount).toBe(2200);
  });
  it.each(['amount', 'currency', 'destination', 'source_transaction', 'metadata'])('rejects a lost-response candidate with different %s', async field => {
    h.lose = true; await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('lost');
    h.transfers[0][field] = field === 'amount' ? 1 : field === 'metadata' ? { ...h.transfers[0].metadata, visit_id: '999' } : 'wrong';
    await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('differs');
    expect((await day()).transferId).toBeNull(); expect(h.create).toHaveBeenCalledTimes(1);
  });
  it('fails closed on incomplete or ambiguous discovery', async () => {
    h.more = true; await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('incomplete');
    expect(h.create).not.toHaveBeenCalled();
    h.more = false; h.lose = true; await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('lost');
    h.transfers.push({ ...h.transfers[0], id: 'tr_duplicate' });
    await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('Multiple');
  });
  it('replays sweep, manual release and notice flush without duplicate money or notices', async () => {
    await releaseBookingDayPayouts(1, now()); await sweepDayPayouts(3, now()); await releaseBookingDayPayouts(1, now());
    await flushDayPayoutNotices(1); expect(h.create).toHaveBeenCalledTimes(1); expect(h.event).toHaveBeenCalledTimes(1);
  });
  it('summarizes all days paid by one release run in one notice', async () => {
    await releaseBookingDayPayouts(1, new Date('2099-10-08T14:00:00Z'));
    expect(h.create).toHaveBeenCalledTimes(2); expect(h.event).toHaveBeenCalledTimes(1);
    expect(h.event.mock.calls[0][6]).toMatchObject({ amountCents: 4400, installmentIds: [1, 2] });
  });
  it('reconciles one charge, two installments and exact sent/remaining net without multiplying gross', async () => {
    await releaseDayPayout((await day()).id, now());
    const report = (await h.db.execute(sql`SELECT SUM(pt.amount::integer)::integer AS captured, SUM(pt.service_fee::integer)::integer AS fee,
      SUM(${dayPaidSql})::integer AS paid, SUM(${dayPendingSql})::integer AS pending FROM payment_transactions pt`)).rows[0];
    expect(report).toEqual({ captured: 4680, fee: 80, paid: 2200, pending: 2200 });
    expect((await get(s.paymentHistory))).toHaveLength(1);
    const days = await readDayPayouts([1]);
    expect(days.map(d => d.status)).toEqual(['sent', 'scheduled']);
    expect(summarizeDayPayouts(days).amountCents).toBe(2200);
  });
  it('pays a cancelled retained share at that visit scheduled end + grace', async () => {
    await h.db.update(s.kitchenBookingVisits).set({ scheduleState: 'cancelled' }).where(eq(s.kitchenBookingVisits.id, 2));
    expect((await releaseDayPayout((await day(1)).id, new Date('2099-10-07T12:29:59Z'))).transferred).toBe(false);
    expect((await releaseDayPayout((await day(1)).id, new Date('2099-10-07T12:30:00Z'))).transferred).toBe(true);
  });
  it('refuses a superseded revision and unknown provider refunds', async () => {
    await h.db.update(s.kitchenBookingVisits).set({ scheduleState: 'superseded' }).where(eq(s.kitchenBookingVisits.id, 1));
    await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('revision');
    await h.db.update(s.kitchenBookingVisits).set({ scheduleState: 'active' }).where(eq(s.kitchenBookingVisits.id, 1));
    h.charge.amount_refunded = 100;
    await expect(releaseDayPayout((await day()).id, now())).rejects.toThrow('reconciliation'); expect(h.create).not.toHaveBeenCalled();
  });
  it('adopts a dated extra-time source and allocates its verified fee to its own visit', async () => {
    await h.db.insert(s.kitchenBookingExtensions).values({ id: 1, bookingId: 1, visitId: 1, blockIndex: 0, kind: 'extra_time', status: 'paid', minutes: 60,
      originalEndTime: '12:00', endTime: '13:00', requestKey: 'extra-time-request', originalEndAt: new Date('2099-10-05T12:00:00Z'), endAt: new Date('2099-10-05T13:00:00Z'), expiresAt: now(),
      requestedBy: 2, amountCents: 1170, paymentIntentId: 'pi_extra', paidAt: now(), quote: {} as any });
    await h.db.insert(s.paymentTransactions).values({ id: 2, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '1170', baseAmount: '1150',
      serviceFee: '20', taxAmount: '150', managerRevenue: '1150', netAmount: '1170', status: 'succeeded', currency: 'cad', paymentIntentId: 'pi_extra', chargeId: 'ch_extra',
      metadata: { sessionExtensionId: 1 } });
    expect(await h.db.transaction((tx: any) => partitionDatedSupplement(2, tx))).toBe(true);
    h.evidence = { intentId: 'pi_extra', capturedCents: 1170, currency: 'cad', feeCents: 50, chargeId: 'ch_extra', balanceTransactionId: 'bt_extra', feeDetails: [] };
    await syncDayPayoutSource(2); await syncDayPayoutSource(2);
    const rows = await readDayPayouts([1]); expect(rows.filter(r => r.sourceId === 2)).toHaveLength(1);
    expect(rows.find(r => r.sourceId === 2)).toMatchObject({ visitId: 1, amountCents: 1100 });
  });
  it('concurrent duplicate releases create one provider transfer and one evidence receipt', async () => {
    const id = (await day()).id;
    await Promise.all([releaseDayPayout(id, now()), releaseDayPayout(id, now())]);
    expect(h.transfers).toHaveLength(1); expect(await get(s.paymentHistory)).toHaveLength(1);
  });
  it('retries manager setup failures before the 24-hour inspection deadline after a clear', async () => {
    const clearedAt = new Date('2099-10-05T13:00:00Z');
    await h.db.update(s.users).set({ stripeConnectAccountId: null }).where(eq(s.users.id, 2));
    await releaseBookingDayPayouts(1, clearedAt);
    await h.db.update(s.users).set({ stripeConnectAccountId: 'acct_daily' }).where(eq(s.users.id, 2));
    expect((await sweepDayPayouts(3, new Date('2099-10-05T14:01:00Z'))).released).toBe(1);
  });
  it('replays an already-sent manual installment as success and rejects an unrelated selector', async () => {
    const id = (await day()).id;
    await releaseBookingDayPayouts(1, now(), undefined, id);
    expect(await releaseBookingDayPayouts(1, now(), undefined, id)).toMatchObject({ success: true, deferred: false });
    await expect(releaseBookingDayPayouts(9, now(), undefined, id)).rejects.toThrow('belonging');
  });
  it('allocates a WP-RS supplemental source to its explicit visit and waits for applied state', async () => {
    await h.db.insert(s.kitchenBookingChanges).values({ id: 'change_daily', bookingId: 1, requestKey: 'change-key', kind: 'move', state: 'authorized',
      original: {}, destination: {}, quote: {}, policy: {}, bookingVersion: now(), decisionBy: now(), managerId: 2 });
    await h.db.insert(s.paymentTransactions).values({ id: 2, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '1170', baseAmount: '1150',
      serviceFee: '20', taxAmount: '150', managerRevenue: '1150', netAmount: '1170', status: 'succeeded', currency: 'cad', paymentIntentId: 'pi_extra', chargeId: 'ch_extra',
      payoutPartition: 'per_day', payoutTiming: 'after_closeout', metadata: { kitchenChangeId: 'change_daily', visitId: 1 } });
    h.evidence = { intentId: 'pi_extra', capturedCents: 1170, currency: 'cad', feeCents: null, chargeId: 'ch_extra', balanceTransactionId: null, feeDetails: null };
    await syncDayPayoutSource(2);
    expect((await readDayPayouts([1])).find(d => d.sourceId === 2)).toMatchObject({ visitId: 1, feePending: true });
    h.evidence.feeCents = 50; h.evidence.balanceTransactionId = 'bt_extra'; await syncDayPayoutSource(2);
    const extra = (await get(s.kitchenBookingDayPayouts)).find((d: any) => d.sourceId === 2);
    await expect(releaseDayPayout(extra.id, now())).rejects.toThrow('applied');
    await h.db.update(s.kitchenBookingChanges).set({ state: 'applied' });
    h.charge = { ...h.charge, id: 'ch_extra', payment_intent: 'pi_extra', amount_captured: 1170 };
    await releaseDayPayout(extra.id, now()); expect(h.transfers[0]).toMatchObject({ amount: 1100, source_transaction: 'ch_extra' });
  });
  it('refuses an unallocated WP-RS supplement rather than guessing an equal day split', async () => {
    await h.db.update(s.paymentTransactions).set({ metadata: { kitchenChangeId: 'no_manifest' } });
    h.evidence = { intentId: 'pi_days', capturedCents: 4680, currency: 'cad', feeCents: 200, chargeId: 'ch_days', balanceTransactionId: 'bt_days' };
    await expect(syncDayPayoutSource(1)).rejects.toThrow('allocations required'); expect(h.create).not.toHaveBeenCalled();
  });
  it('removes fully paid daily sources from the bounded upcoming query', async () => {
    await releaseBookingDayPayouts(1, new Date('2099-10-08T14:00:00Z'));
    expect(await (await import('./kitchen-payout-service')).upcomingKitchenPayouts(2)).toEqual({ totalCents: 0, payouts: [] });
  });
  it('executes migration FKs and rejects a problem linked to a nonexistent visit', async () => {
    await expect(h.db.insert(s.commitmentProblems).values({ sourceKey: 'bad', kind: 'live', bookingId: 1, visitId: 9999, reportedBy: 3, description: 'Bad visit' })).rejects.toThrow();
  });
});
