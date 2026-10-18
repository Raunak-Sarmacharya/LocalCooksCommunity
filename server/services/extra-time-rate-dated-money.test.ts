/**
 * Extra time on dated bookings: day-1 installment (CP5), later-day cancel still quotes main source (CP6),
 * whole-booking change fails support-only after a paid extension (CP7). Never moves non-refundable extension money.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { DATED_DISCLOSURE_VERSION, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({
  db: null as any, client: null as any, refunds: [] as any[], transfers: [] as any[],
  evidence: {} as any, event: vi.fn(), create: vi.fn(),
}));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ enqueueBookingLifecycleEvent: h.event }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./booking-money-guard', async () => ({ ...await vi.importActual<object>('./booking-money-guard'), assertBookingMoneyWritable: async () => undefined }));
vi.mock('./kitchen-booking-changes', async () => ({
  ...await vi.importActual<object>('./kitchen-booking-changes'),
  withdrawOpenKitchenChangesInTx: vi.fn(),
}));
vi.mock('./stripe-service', () => ({
  getCancellationPaymentFacts: async () => ({
    captured: 65880, processingCost: 1941, balanceTransactionId: 'bt_days', feeDetails: [], currency: 'cad',
    chargeId: 'ch_days', refunded: h.refunds.filter(r => r.status === 'succeeded').reduce((sum, row) => sum + row.amount, 0),
    refunds: structuredClone(h.refunds),
  }),
  getCancellationReversalEvidence: async () => [],
  createRefund: async (intent: string, amount: number, _reason: string, options: any) => {
    const refund = { id: `re_${h.refunds.length + 1}`, amount, currency: 'cad', charge: 'ch_days', payment_intent: intent, status: 'succeeded',
      metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
    h.refunds.push(refund); return refund;
  },
  getPaymentIntentRefunds: async () => structuredClone(h.refunds),
  reverseTransferAndRefund: async () => ({ refundId: 're_x', refundAmount: 0, refundStatus: 'succeeded', chargeId: 'ch_days', transferReversalId: null }),
  getStripeClient: () => ({
    transfers: {
      list: async () => ({ data: structuredClone(h.transfers), has_more: false }),
      create: h.create,
    },
    charges: {
      retrieve: async (id: string) => id === 'ch_extra'
        ? { id: 'ch_extra', payment_intent: 'pi_extra', paid: true, captured: true, currency: 'cad', amount_captured: 3000, amount_refunded: 0 }
        : { id: 'ch_days', payment_intent: 'pi_days', paid: true, captured: true, currency: 'cad', amount_captured: 65880, amount_refunded: 0 },
    },
  }),
  getDatedCaptureEvidence: async () => h.evidence,
}));

import { cancelDatedDays, readDatedCancellationQuote } from './dated-booking-cancellation';
import { ensureDayPayoutRows, releaseDayPayout, readDayPayouts } from './kitchen-day-payouts';
import { partitionDatedSupplement, syncDayPayoutSource } from './kitchen-day-payout-sources';
import { readBookingDayMoney } from './booking-day-money';
import * as engine from './kitchen-booking-changes';

beforeAll(async () => {
  const ddl = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const ledger = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), ddl.indexOf('DROP TRIGGER'));
  const test = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.paymentTransactions,
    s.equipmentListings, s.equipmentBookings, s.storageBookings, s.bookingFlags, s.supportActions, s.commitmentProblems, s.kitchenBookingChanges,
    s.kitchenBookingExtensions, s.paymentHistory, s.kitchenVisitArrivalChallenges, s.kitchenCheckoutHolds, s.kitchenAvailability],
    [ledger,
      'ALTER TABLE booking_flags DROP COLUMN visit_id; ALTER TABLE commitment_problems DROP COLUMN visit_id',
      readFileSync('migrations/0102_day_payout_problem_scope.sql', 'utf8'),
      readFileSync('migrations/0104_extra_time_rate.sql', 'utf8')]);
  h.db = test.db; h.client = test.client;
}, 90_000);
afterAll(async () => { await h.client?.close(); });

const MON = '2099-11-02', WED = '2099-11-04', FRI = '2099-11-06';
const start = (date: string) => new Date(`${date}T09:00:00Z`);
const slots = Array.from({ length: 8 }, (_, i) => ({ startTime: `${String(9 + i).padStart(2, '0')}:00`, endTime: `${String(10 + i).padStart(2, '0')}:00` }));
const snapshot: CancellationPolicySnapshot = {
  policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50, deadlineBasis: 'booking_first_day',
  tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'UTC',
  sessions: [MON, WED, FRI].map(date => ({ startAt: start(date).toISOString() })),
  disclosureVersion: DATED_DISCLOSURE_VERSION, acceptedAt: '2099-10-01T00:00:00.000Z',
};
const get = async (table: any) => (await h.db.select().from(table)).sort((a: any, b: any) => a.id - b.id);
const chef = { role: 'chef' as const, id: 3 };

async function seedWithPaidDay1Extension() {
  await h.client.exec(`TRUNCATE users, locations, kitchens, kitchen_bookings, kitchen_booking_visits, payment_transactions, equipment_listings, equipment_bookings,
    kitchen_booking_day_allocations, kitchen_booking_day_payouts, booking_flags, commitment_problems, support_actions, kitchen_booking_changes,
    kitchen_booking_extensions, payment_history, kitchen_visit_arrival_challenges, kitchen_checkout_holds, kitchen_availability RESTART IDENTITY CASCADE`);
  h.refunds = []; h.transfers = []; h.event.mockReset();
  await h.db.insert(s.users).values([
    { id: 2, username: 'kitchen@test.invalid', password: 'x', role: 'manager', stripeConnectAccountId: 'acct_days' },
    { id: 3, username: 'chef@test.invalid', password: 'x', role: 'chef' },
  ]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Harbour', address: 'Test', timezone: 'UTC' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Harbour kitchen', hourlyRate: null, dailyRate: '18000', extraTimeRateCents: 2500 });
  const dates = [MON, WED, FRI];
  const [booking] = await h.db.insert(s.kitchenBookings).values({
    id: 1, referenceCode: 'KB-EXTRA', kitchenId: 4, chefId: 3, bookingDate: new Date(`${MON}T12:00:00Z`),
    startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', totalPrice: '54000', status: 'confirmed',
    paymentStatus: 'paid', scheduleRevision: 1, pricingMode: 'daily', hourlyRate: '18000', extraTimeRateCents: 2500,
    paymentIntentId: 'pi_days', cancellationPolicyHours: 24, cancellationPolicySnapshot: snapshot,
    createdAt: new Date('2099-10-01T00:00:00Z'),
    selectedSlots: dates.flatMap(date => slots.map(slot => ({ ...slot, date, windowStartTime: '09:00' }))),
  }).returning();
  const visits = await h.db.insert(s.kitchenBookingVisits).values(dates.map((date, i) => ({
    id: i + 1, bookingId: 1, blockIndex: i, visitDate: date, scheduleRevision: 1, scheduleState: 'active',
    startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', pricingMode: 'daily', selectedSlots: slots,
    checkinStatus: i === 0 ? 'checked_out' : 'not_checked_in',
    checkoutApprovedBy: i === 0 ? 2 : null, checkoutApprovedAt: i === 0 ? new Date('2099-11-02T17:30:00Z') : null,
  }))).returning();
  const clock = makeCloseoutSnapshot(booking, 'UTC', { serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }, visits);
  await h.db.update(s.kitchenBookings).set({ visitDuties: { clockCloseout: clock } }).where(eq(s.kitchenBookings.id, 1));
  // Main charge: 3 × $180 + 15% HST + 7% fee; card fee $19.41.
  await h.db.insert(s.paymentTransactions).values({
    id: 1, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '65880',
    baseAmount: '62100', taxAmount: '8100', serviceFee: '3780', stripeProcessingFee: '1941',
    managerRevenue: '60159', netAmount: '65880', status: 'succeeded', currency: 'cad', refundAmount: '0',
    paymentIntentId: 'pi_days', chargeId: 'ch_days', payoutPartition: 'per_day', payoutTiming: 'after_closeout', metadata: {},
  });
  const { allocateCents } = await import('@shared/cancellation-policy');
  const dayFees = allocateCents(1941, [18000 + 2700, 18000 + 2700, 18000 + 2700]);
  await h.db.insert(s.kitchenBookingDayAllocations).values([1, 2, 3].map((visitId, i) => ({
    sourceId: 1, visitId, componentKey: 'kitchen', subtotalCents: 18000, taxCents: 2700, serviceFeeCents: 1260,
    stripeFeeCents: dayFees[i], evidence: { chargeId: 'ch_days', balanceTransactionId: 'bt_days', sessionIndex: i, kind: 'kitchen' },
  })));
  await h.db.transaction((tx: any) => ensureDayPayoutRows(tx, 1));
  // Paid day-1 extension at the booking's saved extra time rate ($25/h → $30 total with tax/fee).
  await h.db.insert(s.kitchenBookingExtensions).values({
    id: 1, bookingId: 1, visitId: 1, blockIndex: 0, kind: 'extra_time', status: 'paid', minutes: 60,
    originalEndTime: '17:00', endTime: '18:00', requestKey: 'extra-day1', originalEndAt: new Date('2099-11-02T17:00:00Z'),
    endAt: new Date('2099-11-02T18:00:00Z'), expiresAt: new Date('2099-11-04T17:00:00Z'), requestedBy: 2,
    amountCents: 3000, paymentIntentId: 'pi_extra', paidAt: new Date('2099-11-02T18:10:00Z'), quote: {} as any,
  });
  await h.db.insert(s.paymentTransactions).values({
    id: 2, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '3000', baseAmount: '2875',
    serviceFee: '125', taxAmount: '375', managerRevenue: '2875', netAmount: '3000', status: 'succeeded', currency: 'cad',
    paymentIntentId: 'pi_extra', chargeId: 'ch_extra', payoutPartition: 'per_day', payoutTiming: 'after_closeout',
    metadata: { sessionExtensionId: 1, nonRefundable: true, type: 'session_extension' },
  });
  h.evidence = {
    intentId: 'pi_extra', capturedCents: 3000, currency: 'cad', feeCents: 90, chargeId: 'ch_extra',
    balanceTransactionId: 'bt_extra', feeDetails: [],
  };
  expect(await h.db.transaction((tx: any) => partitionDatedSupplement(2, tx))).toBe(true);
  await syncDayPayoutSource(2);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2099-10-20T12:00:00Z'));
  await seedWithPaidDay1Extension();
  h.create.mockImplementation(async (params: any, options: any) => {
    let transfer = h.transfers.find(t => t.metadata?.operation_key === options.idempotencyKey);
    if (!transfer) {
      transfer = { id: `tr_${h.transfers.length + 1}`, ...structuredClone(params), amount_reversed: 0,
        metadata: { ...params.metadata, operation_key: options.idempotencyKey } };
      h.transfers.push(transfer);
    }
    return transfer;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('extra time rate × dated money safety', () => {
  it('(a) CP5: paid day-1 extension gets its own day-1 installment, paid with day 1 after inspection', async () => {
    const rows = await readDayPayouts([1]);
    const main = rows.find(r => r.sourceId === 1 && r.visitId === 1);
    const extra = rows.find(r => r.sourceId === 2 && r.visitId === 1);
    expect(extra).toMatchObject({ visitId: 1, amountCents: 2785 }); // 2875 − 90 fee
    expect(main?.visitId).toBe(1);
    // Day-1 inspection already cleared in seed; release both main and extension installments.
    expect((await releaseDayPayout(main!.installmentId, new Date('2099-11-03T14:00:00Z'))).transferred).toBe(true);
    expect((await releaseDayPayout(extra!.installmentId, new Date('2099-11-03T14:00:00Z'))).transferred).toBe(true);
    expect(h.transfers.map(t => t.metadata.visit_id)).toEqual(['1', '1']);
    expect(h.transfers.some(t => Number(t.amount) === 2785)).toBe(true);
  });

  it('(b) CP6: cancelling a later day still quotes/refunds only the main source; extension does not block', async () => {
    const quote = await readDatedCancellationQuote(1, chef, { visitIds: [2] }, new Date('2099-10-20T12:00:00Z'));
    expect(quote).toMatchObject({ quoteReady: true, chefRefundCents: 21313 }); // $219.60 − $6.47
    const result = await cancelDatedDays(1, chef, {
      target: { visitIds: [2] }, operationKey: 'drop-wed-with-extra', expectedRefundCents: 21313,
    });
    expect(result).toMatchObject({ success: true, refundCents: 21313 });
    // Extension source untouched (non-refundable; not part of day cancel).
    const extra = (await get(s.paymentTransactions)).find((row: any) => row.id === 2);
    expect(Number(extra.refundAmount || 0)).toBe(0);
    expect(extra.status).toBe('succeeded');
    expect((await get(s.kitchenBookingDayAllocations)).filter((row: any) => row.sourceId === 2)).toHaveLength(1);
  });

  it('(c) CP7: whole-booking change after a paid extension fails support-only (never moves extension money)', async () => {
    const read = await engine.readKitchenChanges(1, chef, new Date('2099-10-20T12:00:00Z'));
    expect(read.canRequest).toMatchObject({ allowed: false, code: 'datedChangeSupport' });
  });

  it('(d) CP9: readBookingDayMoney includes the day-1 extension in that day’s allocated total', async () => {
    const money = await readBookingDayMoney(1);
    const day1 = money.find(day => day.visitId === 1);
    // Kitchen day $219.60 + extension $30.00.
    expect(day1).toMatchObject({ visitId: 1, allocatedCents: 24960, refundedCents: 0 });
    expect(money.find(day => day.visitId === 2)?.allocatedCents).toBe(21960);
  });
});
