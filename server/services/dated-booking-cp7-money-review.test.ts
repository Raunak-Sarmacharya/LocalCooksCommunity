/** Regression proofs from the independent CP7 money review, asserting fixed behavior. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { allocateCents, DATED_DISCLOSURE_VERSION, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, policy: {} as any, closed: new Set<string>(),
  intents: new Map<string, any>(), refunds: [] as any[], next: 1, availability: [] as any[] }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }), pool: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://app.test' }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./booking-money-guard', async () => ({ ...await vi.importActual<object>('./booking-money-guard'), assertBookingMoneyWritable: async () => undefined }));
vi.mock('./visit-code-challenge', () => ({ arrivalModeForChangedBooking: async () => undefined, revokeForBooking: vi.fn(), revokeForVisit: vi.fn(), ensureChallengesForBooking: async () => 0 }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: async () => undefined }));
vi.mock('./booking-policy-settings', () => ({ kitchenBookingPolicies: async () => h.policy }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 9, minimumBookingHours: 1 }) } }));
const hours = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ startTime: `${String(from + i).padStart(2, '0')}:00`, endTime: `${String(from + i + 1).padStart(2, '0')}:00` }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {
  operatingWindow: async () => ({ startTime: '09:00', endTime: '17:00' }),
  validateBookingAvailability: async (_k: number, date: Date, _a: string, _b: string, options: any) => {
    const day = date.toISOString().slice(0, 10);
    if (h.closed.has(day)) return { valid: false, code: 'booked', error: `${day} was just booked by someone else` };
    return { valid: true, windowStartTime: '09:00', slots: options.fullDay ? hours(9, 17) : options.selectedSlots };
  },
} }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: async (subtotal: number) => ({ platformCommissionInCents: Math.round(subtotal * 0.07) }) }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }),
  persistBookingCloseout: async () => ({ changed: true }) }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: vi.fn() }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./kitchen-change-payout', () => ({ releaseKitchenChangePayoutForSource: vi.fn(async () => ({ success: true })), sweepKitchenChangePayouts: vi.fn() }));
vi.mock('./stripe-service', () => ({
  getCancellationPaymentFacts: async () => ({ captured: 65880, processingCost: 1941, currency: 'cad', chargeId: 'ch_days', balanceTransactionId: 'bt', feeDetails: [], refunded: 31969, refunds: h.refunds }),
  getCancellationReversalEvidence: async () => [],
  getPaymentIntentRefunds: async () => structuredClone(h.refunds),
  verifyCancellationRefundFunding: async () => ({ transferId: null, available: null }),
  reverseTransferAndRefund: async () => ({ refundId: 're_x', refundAmount: 31969, refundStatus: 'succeeded', chargeId: 'ch_days', transferReversalId: null }),
  getDatedCaptureEvidence: async () => ({ intentId: 'pi_x', capturedCents: 0, currency: 'cad', feeCents: null, chargeId: null, balanceTransactionId: null, feeDetails: [], metadata: {} }),
}));

import * as engine from './kitchen-booking-changes';
import { readDatedCancellationQuote } from './dated-booking-cancellation';
import { dayEntitlement, refundsAllocated } from './kitchen-day-payouts';

beforeAll(async () => {
  const ddl = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const ledger = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), ddl.indexOf('DROP TRIGGER'));
  const test = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.paymentTransactions,
    s.equipmentListings, s.equipmentBookings, s.storageBookings, s.bookingFlags, s.supportActions, s.commitmentProblems, s.kitchenBookingChanges,
    s.kitchenBookingExtensions, s.paymentHistory, s.kitchenVisitArrivalChallenges, s.kitchenCheckoutHolds, s.bookingLifecycleEvents, s.kitchenViewings], [ledger,
    'ALTER TABLE booking_flags DROP COLUMN visit_id; ALTER TABLE commitment_problems DROP COLUMN visit_id',
    readFileSync('migrations/0102_day_payout_problem_scope.sql', 'utf8'),
    'CREATE UNIQUE INDEX cp7_mr_group_day ON kitchen_checkout_holds(group_id, operating_date) WHERE group_id IS NOT NULL',
    'CREATE UNIQUE INDEX cp7_mr_visit_block ON kitchen_booking_visits(booking_id, block_index)',
    'CREATE UNIQUE INDEX cp7_mr_visit_date ON kitchen_booking_visits(booking_id, schedule_revision, visit_date)',
    'CREATE UNIQUE INDEX cp7_mr_change_open ON kitchen_booking_changes(booking_id) WHERE state IN (\'requested\',\'awaiting_consent\',\'awaiting_payment\',\'payment_pending\',\'authorized\',\'capture_pending\',\'refund_pending\',\'release_pending\',\'recovery_required\')',
    'CREATE UNIQUE INDEX cp7_mr_payment_intent ON payment_transactions(payment_intent_id)',
    readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
    'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()']);
  h.db = test.db; h.client = test.client;
}, 60_000);
afterAll(async () => { await h.client?.close(); });

const MON = '2099-11-02', TUE = '2099-11-03', THU = '2099-11-05', WED = '2099-11-04', FRI = '2099-11-06';
const NOW = new Date('2099-10-25T12:00:00Z');
const at9 = (date: string) => `${date}T09:00:00.000Z`;
const slots8 = hours(9, 17);
const chef = { id: 3, role: 'chef' };
const snapshot: CancellationPolicySnapshot = { policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50, deadlineBasis: 'booking_first_day',
  tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'UTC',
  sessions: [MON, WED, FRI].map(date => ({ startAt: at9(date) })), disclosureVersion: DATED_DISCLOSURE_VERSION, acceptedAt: '2099-10-01T00:00:00.000Z' };
const sum = (rows: any[], key: string) => rows.reduce((n, row) => n + Number(row[key]), 0);

async function seedKeepRefundShape() {
  await h.client.exec(`TRUNCATE users, locations, kitchens, kitchen_bookings, kitchen_booking_visits, payment_transactions, equipment_listings, equipment_bookings,
    kitchen_booking_day_allocations, kitchen_booking_day_payouts, booking_flags, commitment_problems, support_actions, kitchen_booking_changes,
    kitchen_booking_extensions, payment_history, kitchen_visit_arrival_challenges, kitchen_checkout_holds, booking_lifecycle_events, storage_bookings RESTART IDENTITY CASCADE`);
  h.closed = new Set(); h.refunds = []; h.intents.clear();
  h.policy = { timezone: 'UTC', bookingBufferMinutes: 0, maxBookingDays: 7, allowMultiDayBookings: true, multidayCreationEnabled: false,
    defaultDailyBookingLimit: null, minimumBookingWindowHours: 1, weeklyChefHoursLimit: null, maxAdvanceBookingDays: 90 };
  await h.db.insert(s.users).values([{ id: 1, username: 'staff@test.invalid', password: 'x', role: 'admin' },
    { id: 2, username: 'kitchen@test.invalid', password: 'x', role: 'manager', stripeConnectAccountId: 'acct_days', preferredLocale: 'en-CA' },
    { id: 3, username: 'chef@test.invalid', password: 'x', role: 'chef', preferredLocale: 'en-CA' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Harbour', address: 'Test', timezone: 'UTC' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Harbour kitchen', hourlyRate: '2250', dailyRate: '18000', taxRatePercent: '15', isActive: true, listingStatus: 'active' });
  const dates = [MON, WED, FRI];
  const [row] = await h.db.insert(s.kitchenBookings).values({ id: 1, referenceCode: 'KB-DAYS', kitchenId: 4, chefId: 3, bookingDate: new Date(`${MON}T12:00:00Z`),
    startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', pricingMode: 'daily', totalPrice: '54000', serviceFee: '3780', status: 'confirmed', paymentStatus: 'partially_refunded',
    scheduleRevision: 1, paymentIntentId: 'pi_days', cancellationPolicyHours: 24, cancellationPolicySnapshot: snapshot, createdAt: new Date('2099-10-01T00:00:00Z'),
    bufferMinutesSnapshot: 0, stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', currency: 'CAD',
    selectedSlots: dates.flatMap(date => slots8.map(slot => ({ ...slot, date, windowStartTime: '09:00' }))) }).returning();
  const visits = await h.db.insert(s.kitchenBookingVisits).values(dates.map((date, i) => ({ id: i + 1, bookingId: 1, blockIndex: i, visitDate: date, scheduleRevision: 1,
    scheduleState: 'active', startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', pricingMode: 'daily', selectedSlots: slots8 }))).returning();
  await h.db.update(s.kitchenBookings).set({ visitDuties: { clockCloseout: makeCloseoutSnapshot(row, 'UTC', { serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }, visits) } }).where(eq(s.kitchenBookings.id, 1));
  const rows = dates.map((_, i) => ({ visitId: i + 1, key: 'kitchen', sub: 18000, tax: 2700, svc: 1260, index: i }));
  const fee = 1941, fees = allocateCents(fee, rows.map(r => r.sub + r.tax)), total = sum(rows.map(r => ({ v: r.sub + r.tax + r.svc })), 'v');
  // Post keep-refund shape: Stripe refund exists, allocated via outsideRefunds (LC-funded), day ledger untouched, changeGrossRefundedCents recorded.
  const refundId = 're_keep';
  h.refunds.push({ id: refundId, amount: 31969, currency: 'cad', payment_intent: 'pi_days', status: 'succeeded',
    metadata: { type: 'kitchen_booking_change', refund_operation_id: 'kitchen-change:chg1:refund', kitchen_change_id: 'chg1',
      transaction_id: '1', customer_receives: '31969', manager_debited: '30079', platform_service_fee_returned: '1890', platform_processing_cost_cents: '0' } });
  await h.db.insert(s.paymentTransactions).values({ id: 1, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: String(total),
    baseAmount: String(sum(rows.map(r => ({ v: r.sub + r.tax })), 'v')), taxAmount: String(sum(rows, 'tax')), serviceFee: String(sum(rows, 'svc')),
    stripeProcessingFee: String(fee), managerRevenue: String(sum(rows.map(r => ({ v: r.sub + r.tax })), 'v') - fee), netAmount: String(total),
    status: 'partially_refunded', currency: 'cad', refundAmount: '31969', paymentIntentId: 'pi_days', chargeId: 'ch_days', payoutPartition: 'per_day', payoutTiming: 'after_closeout',
    metadata: {
      refunds: [{ id: refundId, customerReceived: 31969, managerDebited: 30079, platformServiceFeeReturned: 1890, kitchenChangeId: 'chg1' }],
      changeGrossRefundedCents: 32940,
      changeGrossRefundOperations: { chg1: refundId },
      outsideRefunds: [{ refundId, visitId: null, kitchenDebitCents: 0, actorId: 1, at: NOW.toISOString(), note: 'Booking change chg1 closed; refund kept by Local Cooks' }],
    } });
  await h.db.insert(s.kitchenBookingDayAllocations).values(rows.map((r, i) => ({ sourceId: 1, visitId: r.visitId, componentKey: r.key,
    subtotalCents: r.sub, taxCents: r.tax, serviceFeeCents: r.svc, stripeFeeCents: fees[i],
    evidence: { chargeId: 'ch_days', balanceTransactionId: 'bt_days', sessionIndex: r.index, kind: 'kitchen' } })));
  for (const table of ['kitchen_booking_visits', 'payment_transactions']) await h.client.exec(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`);
  const { ensureDayPayoutRows } = await import('./kitchen-day-payouts');
  await h.db.transaction((tx: any) => ensureDayPayoutRows(tx, 1));
}

const hourly = (date: string, from: number, to: number) => ({ date, pricingMode: 'hourly' as const, slots: hours(from, to), windowStart: '09:00', equipmentIds: [] as number[] });
const full = (date: string) => ({ date, pricingMode: 'daily' as const, slots: [] as any[], windowStart: '09:00', equipmentIds: [] as number[] });
const days = (...list: any[]) => ({ version: 'days-v1' as const, days: list });

beforeEach(async () => { vi.setSystemTime(NOW); await seedKeepRefundShape(); });

describe('CP7 money review regressions', () => {
  it('M1/M2/S4: kept 31969 refund stays unallocated and blocks both change and day refund', async () => {
    const [source] = await h.db.select().from(s.paymentTransactions);
    expect(refundsAllocated(source)).toBe(false);
    expect(source.refundAmount).toBe('31969');
    expect(dayEntitlement(await h.db.select().from(s.kitchenBookingDayAllocations))).toBe(60159);
    await expect(engine.previewKitchenChange(1, chef, { destination: days(hourly(TUE, 9, 13), full(THU)) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
    await expect(readDatedCancellationQuote(1, chef, { visitIds: [2] }, NOW)).rejects.toThrow('Local Cooks');
  });

  it('M1 lateral: kept refund blocks an equal-price move too', async () => {
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(TUE), full(THU), full('2099-11-07')) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
    expect(Number((await h.db.select().from(s.paymentTransactions))[0].refundAmount)).toBe(31969);
  });

  it('S5: kept refund blocks a larger price-down before another refund can be quoted', async () => {
    await expect(engine.previewKitchenChange(1, chef, { destination: days(hourly(TUE, 9, 13)) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
    expect(h.refunds).toHaveLength(1);
  });
  it.each([32940, 0])('S5: residual cap refuses an unbacked 54900-cent reduction (gross previously refunded %i)', async (grossRefunded) => {
    const [source] = await h.db.select().from(s.paymentTransactions);
    // Even incorrectly reconciled historical data cannot quote beyond captured minus max(gross, provider refund).
    await h.db.update(s.paymentTransactions).set({ metadata: { ...source.metadata, changeGrossRefundedCents: grossRefunded,
      allocatedChangeRefunds: ['re_keep'] } }).where(eq(s.paymentTransactions.id, 1));
    await expect(engine.previewKitchenChange(1, chef, { destination: days(hourly(TUE, 9, 13)) }, NOW))
      .rejects.toMatchObject({ code: 'refundReview' });
    expect(h.refunds).toHaveLength(1);
  });

});
