/**
 * CP6 on real Postgres (PGlite): day drops, per-day equipment removal, kitchen day cancellation and the #10 offer,
 * installment debits/reversals/debt, and the CP5 carry-overs. Only provider I/O and delivery are in memory.
 * Worked example (team test plan C): Mon/Wed/Fri at $180/day, 15% HST, 7% service fee; actual card fee $19.41 = $6.47/day.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { DATED_DISCLOSURE_VERSION, quoteCancellation, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { occupiedOperatingDates } from '@shared/booking-occupancy';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, refunds: [] as any[], reversals: [] as any[], transfers: [] as any[],
  insufficient: new Set<string>(), loseRefund: false, providerCalls: [] as any[], event: vi.fn(), created: vi.fn() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.event }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./kitchen-booking-changes', () => ({ withdrawOpenKitchenChangesInTx: vi.fn() }));
const succeeded = () => h.refunds.filter(row => row.status === 'succeeded');
vi.mock('./stripe-service', () => ({
  getCancellationPaymentFacts: async () => ({ captured: 65880, processingCost: 1941, balanceTransactionId: 'bt_days', feeDetails: [], currency: 'cad',
    chargeId: 'ch_days', refunded: succeeded().reduce((sum, row) => sum + row.amount, 0), refunds: structuredClone(h.refunds) }),
  getCancellationReversalEvidence: async () => [],
  createRefund: async (intent: string, amount: number, _reason: string, options: any) => {
    const refund = { id: `re_${h.refunds.length + 1}`, amount, currency: 'cad', charge: 'ch_days', payment_intent: intent, status: 'succeeded',
      metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
    h.refunds.push(refund); return refund;
  },
  getPaymentIntentRefunds: async () => structuredClone(h.refunds),
  // The provider side of `reverseTransferAndRefund` for day reversals; its real branch is tested with Stripe mocked in stripe-refund-recovery.
  reverseTransferAndRefund: async (intent: string, amount: number, _reason: string, options: any) => {
    h.providerCalls.push({ intent, amount, options: structuredClone({ ...options, sourceConnection: undefined }) });
    const key = options.idempotencyKey, existing = h.refunds.find(row => row.metadata.refund_operation_id === key && row.status === 'succeeded');
    if (existing) return { refundId: existing.id, refundAmount: existing.amount, refundStatus: 'succeeded', chargeId: 'ch_days', transferReversalId: null };
    expect(options.reverseTransferAmount).toBeUndefined();
    for (const item of options.installmentReversals) {
      if (h.reversals.some(row => row.transferId === item.transferId && row.operationId === key)) continue;
      if (h.insufficient.has(item.transferId)) throw Object.assign(Error('Failed to reverse transfer and refund: The kitchen transfer reversal has insufficient balance.'), { transferId: item.transferId });
      h.reversals.push({ transferId: item.transferId, amount: item.amountCents, operationId: key });
    }
    const refund = { id: `re_${h.refunds.length + 1}`, amount, currency: 'cad', charge: 'ch_days', payment_intent: intent, status: 'succeeded',
      metadata: { ...options.metadata, refund_operation_id: key } };
    h.refunds.push(refund);
    if (h.loseRefund) { h.loseRefund = false; throw Error('Provider response lost'); }
    return { refundId: refund.id, refundAmount: amount, refundStatus: 'succeeded', chargeId: 'ch_days', transferReversalId: null };
  },
  getStripeClient: () => ({ transfers: { list: async () => ({ data: structuredClone(h.transfers), has_more: false }),
    create: async (params: any, options: any) => { h.created(params); const transfer = { id: `tr_${h.transfers.length + 1}`, ...params, amount_reversed: 0 };
      h.transfers.push({ ...transfer, metadata: { ...params.metadata, operation_key: options.idempotencyKey } }); return transfer; } },
    charges: { retrieve: async () => ({ id: 'ch_days', payment_intent: 'pi_days', paid: true, captured: true, currency: 'cad', amount_captured: 65880,
      amount_refunded: succeeded().reduce((sum, row) => sum + row.amount, 0) }) } }),
}));
import { assignOutsideRefund, cancelDatedDays, readDatedCancellationQuote, readDatedDayPreviews, refundDatedDay, remainingDayIds } from './dated-booking-cancellation';
import { ensureDayPayoutRows, releaseDayPayout, releaseBookingDayPayouts, refundsAllocated, dayEntitlement } from './kitchen-day-payouts';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { cancelChefBooking, cancelKitchenCausedBooking, removeChefAddon, readChefAddonQuote, retryCancellationRefund, refundSupportGoodwill } from './booking-cancellation-refund';
import { ADMIN_BOOKING_KINDS, adminBookingNotice } from './admin-booking-notice';

beforeAll(async () => {
  // The actual 0099 allocation/installment DDL and 0102 day scopes, executed in this isolated Postgres.
  const ddl = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const ledger = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), ddl.indexOf('DROP TRIGGER'));
  const test = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.paymentTransactions,
    s.equipmentListings, s.equipmentBookings, s.storageBookings, s.bookingFlags, s.supportActions, s.commitmentProblems, s.kitchenBookingChanges,
    s.kitchenBookingExtensions, s.paymentHistory, s.kitchenVisitArrivalChallenges], [ledger,
    'ALTER TABLE booking_flags DROP COLUMN visit_id; ALTER TABLE commitment_problems DROP COLUMN visit_id',
    readFileSync('migrations/0102_day_payout_problem_scope.sql', 'utf8')]);
  h.db = test.db; h.client = test.client;
}, 60_000);
afterAll(async () => { await h.client?.close(); });

const MON = '2099-11-02', WED = '2099-11-04', FRI = '2099-11-06';
const start = (date: string) => new Date(`${date}T09:00:00Z`);
const DEADLINE = new Date('2099-11-01T09:00:00Z'); // Sunday 9 a.m.: 24 h before Monday, the first day.
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const slots = Array.from({ length: 8 }, (_, i) => ({ startTime: `${String(9 + i).padStart(2, '0')}:00`, endTime: `${String(10 + i).padStart(2, '0')}:00` }));
const snapshot: CancellationPolicySnapshot = { policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50, deadlineBasis: 'booking_first_day',
  tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'UTC',
  sessions: [MON, WED, FRI].map(date => ({ startAt: start(date).toISOString() })), disclosureVersion: DATED_DISCLOSURE_VERSION, acceptedAt: '2099-10-01T00:00:00.000Z' };
const get = async (table: any) => (await h.db.select().from(table)).sort((a: any, b: any) => a.id - b.id);
const chef = { role: 'chef' as const, id: 3 }, kitchen = { role: 'manager' as const, id: 2 };
const sourceRow = async () => (await get(s.paymentTransactions))[0];
const op = async () => (await sourceRow()).metadata.cancellationRefundOperation;
const allocation = async (visitId: number, key = 'kitchen') => (await get(s.kitchenBookingDayAllocations)).find((row: any) => row.visitId === visitId && row.componentKey === key);
const installment = async (visitId: number) => (await get(s.kitchenBookingDayPayouts)).find((row: any) => row.visitId === visitId);

/** `equipment`: per-day item prices (cents) on Mon/Fri. Totals keep 15% HST and the 7% fee exact on every component. */
async function seed(equipment: { mon?: number; fri?: number } = {}) {
  await h.client.exec(`TRUNCATE users, locations, kitchens, kitchen_bookings, kitchen_booking_visits, payment_transactions, equipment_listings, equipment_bookings,
    kitchen_booking_day_allocations, kitchen_booking_day_payouts, booking_flags, commitment_problems, support_actions, kitchen_booking_changes,
    kitchen_booking_extensions, payment_history, kitchen_visit_arrival_challenges RESTART IDENTITY CASCADE`);
  h.refunds = []; h.reversals = []; h.transfers = []; h.insufficient = new Set(); h.loseRefund = false; h.providerCalls = []; h.event.mockReset(); h.created.mockReset();
  await h.db.insert(s.users).values([{ id: 2, username: 'kitchen@test.invalid', password: 'x', role: 'manager', stripeConnectAccountId: 'acct_days' },
    { id: 3, username: 'chef@test.invalid', password: 'x', role: 'chef' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Harbour', address: 'Test', timezone: 'UTC' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Harbour kitchen', hourlyRate: '2250' });
  await h.db.insert(s.equipmentListings).values({ id: 7, kitchenId: 4, equipmentType: 'Mixer', category: 'food-prep', condition: 'excellent', pricingModel: 'daily' } as any);
  const dates = [MON, WED, FRI];
  const [booking] = await h.db.insert(s.kitchenBookings).values({ id: 1, referenceCode: 'KB-DAYS', kitchenId: 4, chefId: 3, bookingDate: new Date(`${MON}T12:00:00Z`),
    startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', totalPrice: '54000', status: 'confirmed', paymentStatus: 'paid', scheduleRevision: 1,
    paymentIntentId: 'pi_days', cancellationPolicyHours: 24, cancellationPolicySnapshot: snapshot, createdAt: new Date('2099-10-01T00:00:00Z'),
    selectedSlots: dates.flatMap(date => slots.map(slot => ({ ...slot, date, windowStartTime: '09:00' }))) }).returning();
  const visits = await h.db.insert(s.kitchenBookingVisits).values(dates.map((date, i) => ({ id: i + 1, bookingId: 1, blockIndex: i, visitDate: date, scheduleRevision: 1,
    scheduleState: 'active', startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', pricingMode: 'daily', selectedSlots: slots }))).returning();
  const clock = makeCloseoutSnapshot(booking, 'UTC', { serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }, visits);
  await h.db.update(s.kitchenBookings).set({ visitDuties: { clockCloseout: clock } }).where(eq(s.kitchenBookings.id, 1));
  await h.db.insert(s.kitchenVisitArrivalChallenges).values(visits.map((visit: any) => ({ bookingId: 1, visitId: visit.id, targetKey: `visit:${visit.id}`, keyVersion: 1, nonce: `n${visit.id}` })));
  // Components in CP4 order: each day's kitchen time, then its equipment.
  const components: Array<{ visitId: number; key: string; sub: number; index: number }> = [];
  const items: number[] = [];
  for (const [i, date] of dates.entries()) {
    components.push({ visitId: i + 1, key: 'kitchen', sub: 18000, index: i });
    const price = date === MON ? equipment.mon : date === FRI ? equipment.fri : undefined;
    if (price !== undefined) {
      const [item] = await h.db.insert(s.equipmentBookings).values({ kitchenBookingId: 1, kitchenBookingVisitId: i + 1, chefId: 3, equipmentListingId: 7,
        startDate: start(date), endDate: new Date(`${date}T17:00:00Z`), status: 'confirmed', paymentStatus: 'paid', paymentIntentId: 'pi_days',
        totalPrice: String(price), pricingModel: 'daily', damageDeposit: '0' }).returning();
      items.push(item.id); components.push({ visitId: i + 1, key: `equipment:${item.id}`, sub: price, index: i });
    }
  }
  await h.db.update(s.kitchenBookings).set({ equipmentItems: items.map(id => ({ id, equipmentBookingId: id, status: 'confirmed' })) }).where(eq(s.kitchenBookings.id, 1));
  // 15% HST and the 7% service fee (on the subtotal) are exact on these prices; the actual $19.41 card fee splits by manager gross.
  const rows = components.map(row => ({ ...row, tax: row.sub * 15 / 100, svc: row.sub * 7 / 100 }));
  const grossTotal = rows.reduce((t, r) => t + r.sub + r.tax, 0), fee = equipment.mon || equipment.fri ? Math.round(grossTotal * 0.0312) : 1941;
  const { allocateCents } = await import('@shared/cancellation-policy');
  const fees = allocateCents(fee, rows.map(r => r.sub + r.tax));
  const total = rows.reduce((t, r) => t + r.sub + r.tax + r.svc, 0);
  await h.db.insert(s.paymentTransactions).values({ id: 1, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: String(total),
    baseAmount: String(grossTotal), taxAmount: String(rows.reduce((t, r) => t + r.tax, 0)), serviceFee: String(rows.reduce((t, r) => t + r.svc, 0)),
    stripeProcessingFee: String(fee), managerRevenue: String(grossTotal - fee), netAmount: String(total), status: 'succeeded', currency: 'cad', refundAmount: '0',
    paymentIntentId: 'pi_days', chargeId: 'ch_days', payoutPartition: 'per_day', payoutTiming: 'after_closeout', metadata: {} });
  await h.db.insert(s.kitchenBookingDayAllocations).values(rows.map((row, i) => ({ sourceId: 1, visitId: row.visitId, componentKey: row.key,
    subtotalCents: row.sub, taxCents: row.tax, serviceFeeCents: row.svc, stripeFeeCents: fees[i],
    evidence: { chargeId: 'ch_days', balanceTransactionId: 'bt_days', sessionIndex: row.index, kind: row.key === 'kitchen' ? 'kitchen' : 'equipment' } })));
  await h.db.transaction((tx: any) => ensureDayPayoutRows(tx, 1));
  return { items, total, fee };
}
/** The equipment fixture's provider facts differ from the worked example; keep the mock in step with the seeded charge. */
async function useFacts(total: number, fee: number) {
  const service = await import('./stripe-service') as any;
  vi.spyOn(service, 'getCancellationPaymentFacts').mockImplementation(async () => ({ captured: total, processingCost: fee, balanceTransactionId: 'bt_days', feeDetails: [],
    currency: 'cad', chargeId: 'ch_days', refunded: succeeded().reduce((sum, row) => sum + row.amount, 0), refunds: structuredClone(h.refunds) }));
}
beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); at('2099-10-20T12:00:00Z'); await seed(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('CP6 one refund deadline and the existing late-charge arithmetic', () => {
  it('uses the first day for every day: before/at the cutoff 100%, after it 50% even for Friday', async () => {
    at(new Date(DEADLINE.getTime() - 1).toISOString());
    expect(await readDatedCancellationQuote(1, chef, { visitIds: [3] })).toMatchObject({ chefRefundCents: 21313, feeRetainedCents: 647, beforeDeadline: true });
    at(DEADLINE.toISOString());
    expect((await readDatedCancellationQuote(1, chef, { visitIds: [3] }) as any).chefRefundCents).toBe(21313);
    at(new Date(DEADLINE.getTime() + 1).toISOString());
    // A per-day deadline would give Friday 100% here; the booking's one deadline gives 50% x ($219.60 - $6.47) = $106.57.
    expect(await readDatedCancellationQuote(1, chef, { visitIds: [3] })).toMatchObject({ chefRefundCents: 10657, feeRetainedCents: 647, kitchenShareRetainedCents: 10026,
      kitchenPaysCents: 10027, localCooksPaysCents: 630, refundPercent: 50, deadlineAt: DEADLINE.toISOString(), beforeDeadline: false });
  });
  it('keeps $100 paid / $3 fee at 50% = $48.50, and leaves single-day per-session tiers unchanged', () => {
    const base = { ...snapshot, sessions: [{ startAt: '2099-11-02T09:00:00Z' }, { startAt: '2099-11-06T09:00:00Z' }] };
    const input = { cancelAt: '2099-11-01T12:00:00Z', confirmedAt: null, capturedCents: 20000, processingFeeCents: 600, cause: 'chef' as const,
      components: [0, 1].map(sessionIndex => ({ id: `kitchen:1:${sessionIndex}`, kind: 'kitchen' as const, sessionIndex, kitchenCents: 9000, platformCents: 1000 })) };
    expect(quoteCancellation(base, input).perComponent.map(row => row.refundCents)).toEqual([4850, 4850]);
    const { deadlineBasis, ...singleSession } = base; void deadlineBasis;
    expect(quoteCancellation(singleSession, input).perComponent.map(row => row.refundCents)).toEqual([4850, 9700]);
  });
  it('drops Wednesday before the deadline: $219.60 - $6.47 = $213.13; Monday and Friday ($439.20) stay booked', async () => {
    const result = await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-early', expectedRefundCents: 21313 });
    expect(result).toMatchObject({ success: true, state: 'refunded', refundCents: 21313, action: 'days_cancelled' });
    expect(h.refunds).toEqual([expect.objectContaining({ amount: 21313, metadata: expect.objectContaining({ customer_receives: '21313', manager_debited: '20053',
      platform_service_fee_returned: '1260', refund_operation_id: 'kitchen-day-refund:1:drop-wed-early:1' }) })]);
    const [booking] = await get(s.kitchenBookings), visits = await get(s.kitchenBookingVisits);
    expect(booking).toMatchObject({ status: 'confirmed', paymentStatus: 'partially_refunded' });
    expect(visits.map((v: any) => v.scheduleState)).toEqual(['active', 'cancelled', 'active']);
    expect(Array.from(occupiedOperatingDates(booking))).toEqual([MON, FRI]);
    const remaining = (await get(s.kitchenBookingDayAllocations)).filter((row: any) => row.visitId !== 2);
    expect(remaining.reduce((t: number, r: any) => t + r.subtotalCents + r.taxCents + r.serviceFeeCents, 0)).toBe(43920);
    expect((await allocation(2)).evidence).toMatchObject({ managerDebitedCents: 20053, refunds: [expect.objectContaining({ customerCents: 21313, kitchenCents: 20053, platformCents: 1260, feeCents: 647 })] });
    const codes = await get(s.kitchenVisitArrivalChallenges);
    expect(codes.map((c: any) => !!c.revokedAt)).toEqual([false, true, false]);
    expect(await op()).toMatchObject({ dated: true, status: 'succeeded', customerRefund: 21313, managerRefund: 20053, platformRefund: 1260, visitIds: [2] });
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 1, 'day_cancelled', 'Wed, Nov 4 cancelled', expect.stringContaining('Refunded $213.13; card fee kept $6.47'), 3,
      expect.objectContaining({ roleText: expect.objectContaining({ chef: expect.objectContaining({ message: expect.stringContaining('Your refund is $213.13; the $6.47 card processing fee is kept') }),
        manager: expect.objectContaining({ message: 'Your payout for that day is $0.00. Their other days stay booked.' }) }) }));
  });
  it('drops Wednesday after the deadline at 50%: $106.57; the kitchen keeps $100.26 of that day', async () => {
    at('2099-11-01T10:00:00Z');
    await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-late' });
    expect(h.refunds.map(r => r.amount)).toEqual([10657]);
    expect((await allocation(2)).evidence.managerDebitedCents).toBe(10027);
    expect(dayEntitlement([await allocation(2)])).toBe(10026);
  });
  it('dropping the first day never moves the deadline: Wednesday after Sunday 9 a.m. stays 50%', async () => {
    at('2099-10-31T09:00:00Z');
    await cancelDatedDays(1, chef, { target: { visitIds: [1] }, operationKey: 'drop-mon-early' });
    at('2099-11-02T10:00:00Z'); // Monday is gone; Tuesday 9 a.m. would be the moved deadline. It is not.
    expect(await readDatedCancellationQuote(1, chef, { visitIds: [2] })).toMatchObject({ chefRefundCents: 10657, deadlineAt: DEADLINE.toISOString() });
    expect(Array.from(occupiedOperatingDates((await get(s.kitchenBookings))[0]))).toEqual([WED, FRI]);
  });
  it('refuses a started or no-show day and treats "cancel all" as the remaining days only', async () => {
    at('2099-11-02T10:00:00Z');
    await expect(cancelDatedDays(1, chef, { target: { visitIds: [1] }, operationKey: 'drop-started' })).rejects.toThrow('has already started');
    expect(await remainingDayIds(1)).toEqual([2, 3]);
    const result = await cancelChefBooking(1, 3, 'cancel-the-rest') as any;
    expect(result).toMatchObject({ refundCents: 21313, action: 'days_cancelled', visitIds: [2, 3] }); // one cumulative rounding: 10657 + 10656
    expect((await get(s.kitchenBookings))[0].status).toBe('confirmed'); // Monday was delivered; the booking completes with it.
    expect(h.refunds).toHaveLength(1);
  });
  it('cancelling every day cancels the booking with one whole-booking notice', async () => {
    const result = await cancelChefBooking(1, 3, 'cancel-everything') as any;
    expect(result).toMatchObject({ action: 'cancelled', refundCents: 63939 });
    expect((await get(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', cancellationCause: 'chef', cancellationOperationKey: 'cancel-everything' });
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 1, 'cancelled', 'Booking cancelled', expect.stringContaining('$639.39'), 3,
      expect.objectContaining({ cancellationNotice: expect.objectContaining({ cause: 'chef', refundCents: 63939, feeCents: 1941 }) }));
  });
  it('replays by operation key and requires the quoted refund', async () => {
    await expect(cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-q', expectedRefundCents: 21300 })).rejects.toThrow('refund changed');
    expect(h.refunds).toEqual([]);
    await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-q' });
    expect(await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-q' })).toMatchObject({ replayed: true, refundCents: 21313 });
    expect(h.refunds).toHaveLength(1);
    await expect(cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-again' })).rejects.toThrow('no longer part of this booking');
  });
  it('waits for the actual fee and for an open support flag', async () => {
    await h.db.update(s.kitchenBookingDayAllocations).set({ stripeFeeCents: null }).where(eq(s.kitchenBookingDayAllocations.visitId, 3));
    expect(await readDatedCancellationQuote(1, chef, { visitIds: [2] })).toMatchObject({ quoteReady: false, reasonCode: 'processing_fee_pending' });
    await expect(cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-fee-pending' })).rejects.toThrow('card processing fee');
    await seed();
    await h.db.insert(s.bookingFlags).values({ bookingId: 1, kind: 'manual_hold' });
    await expect(cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-flagged' })).rejects.toThrow('paused');
    expect((await get(s.kitchenBookingVisits)).every((v: any) => v.scheduleState === 'active')).toBe(true);
  });
});

describe('CP6 equipment per day (WP-AO)', () => {
  it('removes later equipment after an earlier visit; never the started day; conserves item-then-day-then-all', async () => {
    const { items, total, fee } = await seed({ mon: 2000, fri: 2000 });
    await useFacts(total, fee);
    const [monItem, friItem] = items;
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_in', checkedInAt: new Date('2099-11-02T09:05:00Z') }).where(eq(s.kitchenBookingVisits.id, 1));
    at('2099-11-02T10:00:00Z');
    await expect(removeChefAddon(1, 3, { kind: 'equipment', id: monItem }, { operationKey: 'remove-mon-mixer' })).rejects.toThrow('already started');
    const quote = await readChefAddonQuote(1, 3, { kind: 'equipment', id: friItem }) as any;
    const friRow = await allocation(3, `equipment:${friItem}`), paid = friRow.subtotalCents + friRow.taxCents + friRow.serviceFeeCents;
    const late = Math.round((paid - friRow.stripeFeeCents) / 2);
    expect(quote).toMatchObject({ chefRefundCents: late, itemName: 'Mixer', lateCancel: true, free: false });
    expect(await removeChefAddon(1, 3, { kind: 'equipment', id: friItem }, { operationKey: 'remove-fri-mixer', expectedRefundCents: late })).toMatchObject({ state: 'removed', refundCents: late });
    expect((await get(s.equipmentBookings)).map((row: any) => row.status)).toEqual(['confirmed', 'cancelled']);
    // Day then all: the removed item is settled once and never refunded again.
    await cancelDatedDays(1, chef, { target: { visitIds: [3] }, operationKey: 'drop-fri-after-item' });
    await cancelChefBooking(1, 3, 'drop-rest');
    const rows = await get(s.kitchenBookingDayAllocations);
    const refunded = rows.filter((row: any) => row.evidence.refunds?.length);
    expect(refunded.map((row: any) => row.componentKey)).toEqual(['kitchen', 'kitchen', `equipment:${friItem}`]);
    expect(h.refunds.reduce((t, r) => t + r.amount, 0)).toBe(refunded.reduce((t: number, r: any) => t + r.evidence.refunds.reduce((u: number, x: any) => u + x.customerCents, 0), 0));
    expect(rows.find((row: any) => row.componentKey === `equipment:${monItem}`).evidence.refunds).toBeUndefined();
  });
  it('removes free equipment with no refund and no provider call', async () => {
    const { items, total, fee } = await seed({ fri: 0 });
    await useFacts(total, fee);
    expect(await removeChefAddon(1, 3, { kind: 'equipment', id: items[0] }, { operationKey: 'remove-free-item' })).toMatchObject({ refundCents: 0, state: 'removed' });
    expect(h.providerCalls).toEqual([]); expect((await get(s.equipmentBookings))[0].status).toBe('cancelled');
  });
  it('lets the kitchen remove a day’s item with a full refund incl. its card fee', async () => {
    const { items, total, fee } = await seed({ fri: 2000 });
    await useFacts(total, fee);
    const { refundKitchenCausedAddons } = await import('./booking-cancellation-refund');
    const row = await allocation(3, `equipment:${items[0]}`);
    const result = await refundKitchenCausedAddons(1, 2, 2, 'kitchen-no-mixer', [{ kind: 'equipment', id: items[0] }]);
    expect(result).toMatchObject({ amountCents: 2300 + row.serviceFeeCents, managerPaysCents: 2300 - row.stripeFeeCents, processingCostAbsorbedCents: row.stripeFeeCents });
  });
});

describe('CP6 kitchen cancels one day and the #10 drop-rest offer', () => {
  it('refunds Wednesday $219.60 incl. fee; Local Cooks absorbs $6.47; Friday then drops without the late charge until it starts', async () => {
    at('2099-11-02T18:00:00Z'); // after the deadline; Monday is done.
    const result = await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-wed-maintenance', 'Maintenance', { visitIds: [2] }) as any;
    expect(result).toMatchObject({ refundCents: 21960, managerPaysCents: 20053, localCooksPaysCents: 1907, processingCostAbsorbedCents: 647 });
    expect(h.refunds[0].metadata).toMatchObject({ customer_receives: '21960', manager_debited: '20053', platform_service_fee_returned: '1260', platform_processing_cost_cents: '647' });
    const [booking] = await get(s.kitchenBookings);
    expect(booking.kitchenDayCancellationOffer).toMatchObject({ eligibleVisitIds: [3], cancelledVisitIds: [2], expiresAt: start(FRI).toISOString() });
    expect(dayEntitlement([await allocation(2)])).toBe(0);
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 1, 'day_cancelled', 'The kitchen can’t host you on Wed, Nov 4', expect.stringContaining('Local Cooks absorbs $6.47'), 2,
      expect.objectContaining({ roleText: expect.objectContaining({ chef: expect.objectContaining({ message: expect.stringContaining('without the late charge until') }) }) }));
    // Replay: same refund, same offer (no extension).
    await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-wed-maintenance', 'Maintenance', { visitIds: [2] });
    expect(h.refunds).toHaveLength(1);
    expect((await get(s.kitchenBookings))[0].kitchenDayCancellationOffer).toEqual(booking.kitchenDayCancellationOffer);
    // The chef drops Friday under the offer: $219.60 - $6.47, out of Friday's kitchen entitlement.
    at('2099-11-05T12:00:00Z');
    expect(await readDatedCancellationQuote(1, chef, { visitIds: [3] })).toMatchObject({ mode: 'chef_offer', chefRefundCents: 21313, feeRetainedCents: 647 });
    await cancelDatedDays(1, chef, { target: { visitIds: [3] }, operationKey: 'chef-drops-fri' });
    expect(h.refunds.map(r => r.amount)).toEqual([21960, 21313]);
    expect((await allocation(3)).evidence.managerDebitedCents).toBe(20053);
  });
  it('ends the offer at the next remaining start; a later day then pays the late charge', async () => {
    at('2099-11-01T12:00:00Z'); // after the deadline, before Monday.
    await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-mon-closed', 'Closed', { visitIds: [1] });
    expect((await get(s.kitchenBookings))[0].kitchenDayCancellationOffer).toMatchObject({ eligibleVisitIds: [2, 3], expiresAt: start(WED).toISOString() });
    at('2099-11-03T12:00:00Z');
    expect((await readDatedCancellationQuote(1, chef, { visitIds: [3] }) as any).chefRefundCents).toBe(21313);
    // Quoted before the offer ends, confirmed after: the refund changed and nothing is cancelled.
    at('2099-11-04T09:00:00Z');
    await expect(cancelDatedDays(1, chef, { target: { visitIds: [3] }, operationKey: 'chef-fri-race', expectedRefundCents: 21313 })).rejects.toThrow('refund changed');
    expect((await readDatedCancellationQuote(1, chef, { visitIds: [3] }) as any)).toMatchObject({ mode: 'chef', chefRefundCents: 10657 });
  });
  it('kitchen cancelling every remaining day cancels the booking (no offer)', async () => {
    const result = await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-cancels-all', 'Flood') as any;
    expect(result).toMatchObject({ action: 'cancelled', refundCents: 65880, processingCostAbsorbedCents: 1941 });
    expect((await get(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', cancellationCause: 'kitchen', kitchenDayCancellationOffer: null });
  });
});

describe('CP6 installments: unsent reduce, sent reverse that exact day, else kitchen debt', () => {
  const sendFriday = async () => h.db.update(s.kitchenBookingDayPayouts).set({ transferId: 'tr_fri', transferAmountCents: 20053, releasedAt: new Date(),
    evidence: { state: 'sent', sentAt: '2099-10-20T12:00:00Z' } }).where(eq(s.kitchenBookingDayPayouts.visitId, 3));
  it('reverses only Friday’s own transfer by its kitchen debit', async () => {
    await sendFriday();
    h.transfers.push({ id: 'tr_fri', amount: 20053, amount_reversed: 0, metadata: {} });
    await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-fri', 'Closed', { visitIds: [3] });
    expect(h.reversals).toEqual([{ transferId: 'tr_fri', amount: 20053, operationId: 'kitchen-day-refund:1:kitchen-fri:1' }]);
    expect((await allocation(3)).evidence.managerDebitedCents).toBeUndefined(); // the transfer was reversed instead
    expect((await allocation(1)).evidence.managerDebitedCents).toBeUndefined(); // never another day
  });
  it('records kitchen debt for that day when its transfer can’t be reversed, then refunds the chef', async () => {
    await sendFriday(); h.insufficient.add('tr_fri');
    await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-fri-debt', 'Closed', { visitIds: [3] });
    const saved = (await sourceRow()).metadata;
    expect(saved.cancellationRefundOperation).toMatchObject({ status: 'succeeded', platformFunding: true, kitchenDebtCents: 20053 });
    expect(saved.kitchenRefundDebts).toEqual([expect.objectContaining({ visitId: 3, transferId: 'tr_fri', amountCents: 20053, status: 'open' })]);
    expect(h.refunds[0]).toMatchObject({ amount: 21960, metadata: expect.objectContaining({ kitchen_debt_cents: '20053' }) });
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 1, 'payment_recovery_needed', 'A kitchen owes Local Cooks for a refunded day', expect.stringContaining('$200.53'),
      undefined, expect.objectContaining({ recipientPolicy: 'admins' }));
  });
  it('blocks day payouts while the refund is pending, then pays the untouched day in full', async () => {
    h.loseRefund = true;
    await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-lost' });
    expect((await op()).status).toBe('recovery_required');
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_out', checkoutApprovedBy: 2, checkoutApprovedAt: new Date('2099-11-02T17:30:00Z') })
      .where(eq(s.kitchenBookingVisits.id, 1));
    at('2099-11-03T12:00:00Z');
    await releaseDayPayout((await installment(1)).id);
    expect(h.created).not.toHaveBeenCalled();
    await retryCancellationRefund(1, 2); // the original receipt is recovered by its key, no second refund
    expect(h.refunds).toHaveLength(1); expect((await op()).status).toBe('succeeded');
    expect(refundsAllocated(await sourceRow())).toBe(true);
    await releaseDayPayout((await installment(1)).id);
    expect(h.created).toHaveBeenCalledWith(expect.objectContaining({ amount: 20053, metadata: expect.objectContaining({ visit_id: '1' }) }));
    // The dropped day pays nothing once its window ends.
    at('2099-11-05T12:00:00Z');
    await releaseDayPayout((await installment(2)).id);
    expect(await installment(2)).toMatchObject({ noEntitlement: true, transferAmountCents: 0 });
  });
  it('an unallocated refund (made outside the day engine) still holds every day', async () => {
    h.refunds.push({ id: 're_outside', amount: 500, status: 'succeeded', metadata: {} });
    await h.db.update(s.paymentTransactions).set({ refundAmount: '500', metadata: { refunds: [{ id: 're_outside', customerReceived: 500, managerDebited: 500, platformServiceFeeReturned: 0 }] } });
    expect(refundsAllocated(await sourceRow())).toBe(false);
    await h.db.update(s.paymentTransactions).set({ metadata: { refunds: [{ id: 're_outside', customerReceived: 500, managerDebited: 0, platformServiceFeeReturned: 0, platformGoodwillCents: 500 }] } });
    expect(refundsAllocated(await sourceRow())).toBe(true); // Local Cooks goodwill debits no day
  });
});

describe('CP5 carry-overs', () => {
  const closeMonday = () => h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_out', checkoutApprovedBy: 2, checkoutApprovedAt: new Date('2099-11-02T17:30:00Z') })
    .where(eq(s.kitchenBookingVisits.id, 1));
  it('#5: an unstarted reservation is cleared when its day becomes held, so it never freezes other money actions', async () => {
    await closeMonday(); at('2099-11-03T12:00:00Z');
    const row = await installment(1);
    await h.db.update(s.kitchenBookingDayPayouts).set({ releasedAt: new Date(), transferAmountCents: 20053, evidence: { state: 'pending',
      params: { amount: 20053, currency: 'cad', destination: 'acct_days', source_transaction: 'ch_days', transfer_group: 'pi_pi_days', metadata: { operation_key: row.operationKey } } } })
      .where(eq(s.kitchenBookingDayPayouts.id, row.id));
    await expect(assertBookingMoneyWritable({ bookingId: 1 })).rejects.toThrow('paused');
    await h.db.insert(s.bookingFlags).values({ bookingId: 1, visitId: 1, kind: 'manual_hold' });
    await releaseDayPayout(row.id);
    expect(await installment(1)).toMatchObject({ releasedAt: null, transferAmountCents: null, holdReason: 'support_flag' });
    expect((await installment(1)).evidence.state).toBeUndefined();
    expect(h.created).not.toHaveBeenCalled();
    await h.db.update(s.bookingFlags).set({ resolvedAt: new Date() });
    await expect(assertBookingMoneyWritable({ bookingId: 1 })).resolves.toBeUndefined();
  });
  it('#4: support releases a day over a chef-reported problem; nothing due yet is a successful no-op', async () => {
    expect(await releaseBookingDayPayouts(1, new Date(), undefined, (await installment(3)).id, { supportRelease: true }))
      .toMatchObject({ success: false, transferred: false, deferred: true, failures: 0, overrideRecorded: true });
    await closeMonday(); at('2099-11-03T12:00:00Z');
    await h.db.insert(s.commitmentProblems).values({ sourceKey: 'p1', kind: 'live', bookingId: 1, visitId: 1, reportedBy: 3, description: 'Fridge warm' });
    await releaseDayPayout((await installment(1)).id);
    expect((await installment(1)).holdReason).toBe('reported_issue');
    await releaseBookingDayPayouts(1, new Date(), undefined, (await installment(1)).id, { supportRelease: true });
    expect(h.created).toHaveBeenCalledWith(expect.objectContaining({ amount: 20053 }));
  });
});

describe('CP6 support previews', () => {
  it('prices each remaining day and all of them, for the chef and for the kitchen, before support acts', async () => {
    at('2099-11-01T10:00:00Z');
    const preview = await readDatedDayPreviews(1);
    expect(preview.days.map(day => [day.date, day.forChef?.chefReceivesCents, day.byKitchen?.chefReceivesCents, day.byKitchen?.localCooksPaysCents]))
      .toEqual([[MON, 10657, 21960, 1907], [WED, 10657, 21960, 1907], [FRI, 10657, 21960, 1907]]);
    expect(preview.all).toMatchObject({ forChef: { chefReceivesCents: 31970, feeRetainedCents: 1941 }, byKitchen: { chefReceivesCents: 65880, managerPaysCents: 60159 } });
  });
});

describe('CP6 notices', () => {
  it('tracks day cancellations for Local Cooks (in-app to all admins, email per the admin toggle)', () => {
    expect(ADMIN_BOOKING_KINDS.has('day_cancelled')).toBe(true);
    expect(adminBookingNotice('day_cancelled', { chef: 'Alex', kitchen: 'Harbour kitchen', reference: 'KB-DAYS', when: 'Nov 2', message: 'The chef cancelled Wed, Nov 4. Refunded $213.13.' }))
      .toEqual({ title: 'Days cancelled · KB-DAYS', message: 'Alex at Harbour kitchen · Nov 2 · KB-DAYS. The chef cancelled Wed, Nov 4. Refunded $213.13.' });
  });
});

describe('CP6 fix round', () => {
  const closeMonday = () => h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_out', checkoutApprovedBy: 2, checkoutApprovedAt: new Date('2099-11-02T17:30:00Z') })
    .where(eq(s.kitchenBookingVisits.id, 1));
  const paid = (row: any) => row.subtotalCents + row.taxCents + row.serviceFeeCents;
  it('M1: the kitchen cancelling a day tops up an item the chef removed late, so the whole day comes back incl. its card fee', async () => {
    const { items, total, fee } = await seed({ fri: 2000 });
    await useFacts(total, fee);
    const item = await allocation(3, `equipment:${items[0]}`), kitchenTime = await allocation(3);
    at('2099-11-01T10:00:00Z');
    await removeChefAddon(1, 3, { kind: 'equipment', id: items[0] }, { operationKey: 'chef-removes-fri-item' });
    const late = h.refunds[0].amount, earlier = (await allocation(3, `equipment:${items[0]}`)).evidence.refunds[0];
    expect(late).toBe(Math.round((paid(item) - item.stripeFeeCents) / 2));
    await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-cancels-fri', 'Closed', { visitIds: [3] });
    expect(late + h.refunds[1].amount).toBe(paid(kitchenTime) + paid(item));
    expect((await allocation(3, `equipment:${items[0]}`)).evidence.refunds[1]).toMatchObject({ mode: 'kitchen', absorbedFeeCents: item.stripeFeeCents,
      kitchenCents: 2300 - item.stripeFeeCents - earlier.kitchenCents, platformCents: 140 - earlier.platformCents });
    expect(dayEntitlement([await allocation(3), await allocation(3, `equipment:${items[0]}`)])).toBe(0);
  });
  it('M2: a dated request charged after it was declined is refunded in full by the whole-charge command, not the day engine', async () => {
    await h.db.update(s.kitchenBookings).set({ status: 'pending', paymentStatus: 'paid',
      paymentDecision: { state: 'pending', target: 'cancelled', deadEnd: { kind: 'captured_before_release' } } }).where(eq(s.kitchenBookings.id, 1));
    await cancelKitchenCausedBooking(1, 2, 1, 'support-refund-captured');
    expect(h.refunds).toEqual([expect.objectContaining({ amount: 65880, metadata: expect.objectContaining({ manager_debited: '60159',
      platform_service_fee_returned: '3780', platform_processing_cost_cents: '1941' }) })]);
    expect(h.providerCalls[0].options.installmentReversals).toEqual([]);
    const [booking] = await get(s.kitchenBookings);
    expect(booking).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', cancellationCause: 'kitchen' });
    expect((await get(s.kitchenBookingDayPayouts)).every((row: any) => row.noEntitlement)).toBe(true);
  });
  it('M4: the kitchen refunds more for one day, out of that day only, capped at its remaining share', async () => {
    await expect(refundDatedDay(1, 2, { visitId: 1, amountCents: 20054, operationKey: 'kitchen-extra-too-much' })).rejects.toThrow('most the kitchen can refund for Mon, Nov 2 is $200.53');
    const result = await refundDatedDay(1, 2, { visitId: 1, amountCents: 5000, reason: 'Oven ran slow', operationKey: 'kitchen-extra-mon' });
    expect(result).toMatchObject({ action: 'refunded', refundCents: 5000, managerPaysCents: 5000, localCooksPaysCents: 0 });
    expect(h.refunds[0].metadata).toMatchObject({ customer_receives: '5000', manager_debited: '5000', platform_service_fee_returned: '0' });
    expect(dayEntitlement([await allocation(1)])).toBe(15053); expect((await allocation(2)).evidence.managerDebitedCents).toBeUndefined();
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 1, 'refund_issued', 'The kitchen refunded you $50.00', expect.stringContaining('Mon, Nov 2: Oven ran slow'), 2,
      expect.objectContaining({ noticeDay: expect.objectContaining({ date: MON }) }));
    await expect(refundDatedDay(1, 2, { visitId: 1, amountCents: 15054, operationKey: 'kitchen-extra-mon-2' })).rejects.toThrow('$150.53');
  });
  it('M4: an extra refund counts toward a later drop of that day, as on a one-day booking', async () => {
    await refundDatedDay(1, 2, { visitId: 2, amountCents: 5000, operationKey: 'kitchen-extra-wed' });
    await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-after-extra' });
    expect(h.refunds[1]).toMatchObject({ amount: 16313, metadata: expect.objectContaining({ manager_debited: '15053', platform_service_fee_returned: '1260' }) });
    expect(dayEntitlement([await allocation(2)])).toBe(0);
  });
  it.each([[[2, 3]], [[3, 2]]])('L1: late days dropped one at a time (order %j) refund exactly what dropping them together does', async order => {
    at('2099-11-01T10:00:00Z');
    for (const visitId of order) await cancelDatedDays(1, chef, { target: { visitIds: [visitId] }, operationKey: `drop-${visitId}-late` });
    expect(h.refunds.map(r => r.amount)).toEqual([10657, 10656]);
  });
  it('L4: a refund made outside the app holds day payouts until Local Cooks assigns it to a day (debited there only)', async () => {
    h.refunds.push({ id: 're_dash', amount: 500, currency: 'cad', charge: 'ch_days', payment_intent: 'pi_days', status: 'succeeded', metadata: {} });
    await closeMonday(); at('2099-11-03T12:00:00Z');
    await expect(releaseDayPayout((await installment(1)).id)).rejects.toThrow('need reconciliation');
    await assignOutsideRefund(1, 99, { refundId: 're_dash', visitId: 2, kitchenDebitCents: 500, note: 'Refunded in Stripe by mistake' });
    expect((await sourceRow()).refundAmount).toBe('500');
    expect((await allocation(2)).evidence.managerDebitedCents).toBe(500);
    expect((await get(s.paymentHistory)).some((row: any) => row.eventType === 'outside_refund_assigned' && row.createdBy === 99)).toBe(true);
    await releaseDayPayout((await installment(1)).id);
    expect(h.created).toHaveBeenCalledWith(expect.objectContaining({ amount: 20053 }));
  });
  it('L4: or marks it Local Cooks-funded, debiting no day', async () => {
    h.refunds.push({ id: 're_dash', amount: 500, currency: 'cad', charge: 'ch_days', payment_intent: 'pi_days', status: 'succeeded', metadata: {} });
    await assignOutsideRefund(1, 99, { refundId: 're_dash' });
    expect(refundsAllocated(await sourceRow())).toBe(true);
    expect((await get(s.kitchenBookingDayAllocations)).every((row: any) => !row.evidence.managerDebitedCents)).toBe(true);
    await expect(assignOutsideRefund(1, 99, { refundId: 're_dash', visitId: 1, kitchenDebitCents: 100 })).resolves.toMatchObject({ replayed: true });
  });
  it('L5: Local Cooks goodwill counts toward a later drop (its own part first); a large one reduces later drops to $0, never blocks them', async () => {
    await refundSupportGoodwill(1, 2, 99, 500, 'support-goodwill-small');
    await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-after-goodwill' });
    expect(h.refunds[1]).toMatchObject({ amount: 20813, metadata: expect.objectContaining({ manager_debited: '20053', platform_service_fee_returned: '760' }) });
    expect((await op()).goodwillAppliedCents).toBe(500);
    await seed();
    await refundSupportGoodwill(1, 2, 99, 30000, 'support-goodwill-large');
    await cancelDatedDays(1, chef, { target: { visitIds: [2] }, operationKey: 'drop-wed-covered' });
    expect(h.refunds).toHaveLength(1); expect(await op()).toMatchObject({ status: 'succeeded', customerRefund: 0, goodwillAppliedCents: 21313 });
    expect(dayEntitlement([await allocation(2)])).toBe(20053); // Local Cooks' goodwill already paid this drop
    await cancelDatedDays(1, chef, { target: { visitIds: [3] }, operationKey: 'drop-fri-rest-of-goodwill' });
    expect(h.refunds[1].amount).toBe(21313 - (30000 - 21313));
  });
  it('L6: a day notice carries the affected day, not the booking’s first date', async () => {
    await cancelDatedDays(1, chef, { target: { visitIds: [3] }, operationKey: 'drop-fri-notice' });
    expect(h.event).toHaveBeenCalledWith(expect.anything(), 1, 'day_cancelled', expect.any(String), expect.any(String), 3,
      expect.objectContaining({ noticeDay: { date: FRI, startTime: '09:00', endTime: '17:00' } }));
  });
  it('L7: reversing an already-paid day records that day’s reversed amount (revenue nets it)', async () => {
    await h.db.update(s.kitchenBookingDayPayouts).set({ transferId: 'tr_fri', transferAmountCents: 20053, releasedAt: new Date(),
      evidence: { state: 'sent', sentAt: '2099-10-20T12:00:00Z' } }).where(eq(s.kitchenBookingDayPayouts.visitId, 3));
    await cancelKitchenCausedBooking(1, 2, 2, 'kitchen-fri-paid', 'Closed', { visitIds: [3] });
    expect((await installment(3)).evidence).toMatchObject({ reversedCents: 20053 });
    expect((await installment(1)).evidence.reversedCents).toBeUndefined();
  });
});
