/**
 * CP7 on real Postgres (PGlite): one change request for a whole dated booking, through the real WP-RS engine, the real CP3
 * day validator (count/span/notice/equipment/weekly; only the single-day availability engine is stubbed), CP4 pricing, the
 * CP5 day ledger and the CP6 refund reader. The actual 0099 ledger DDL, 0102 scopes and the 0098 policy trigger execute here.
 * Only provider I/O, delivery, reminders and closeout persistence are in memory.
 *
 * Worked example (team test plan C): Mon/Wed/Fri full days at $180, 15% HST, 7% service fee; total $658.80, actual card fee $19.41.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { allocateCents, DATED_DISCLOSURE_VERSION, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, policy: {} as any, closed: new Set<string>(), failAfterMoney: false,
  intents: new Map<string, any>(), refunds: [] as any[], next: 1, availability: [] as any[], revoked: [] as number[], enrolled: [] as number[],
  refundCalls: [] as any[], fundingChecks: 0, captures: 0, closeout: [] as number[] }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }), pool: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://app.test' }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Ana' }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./booking-money-guard', async () => ({ ...await vi.importActual<object>('./booking-money-guard'), assertBookingMoneyWritable: async () => undefined }));
vi.mock('./visit-code-challenge', () => ({ revokeForBooking: vi.fn(), revokeForVisit: async (_tx: any, _b: number, visitId: number) => { h.revoked.push(visitId); },
  ensureChallengesForBooking: async (_tx: any, bookingId: number) => { h.enrolled.push(bookingId); return 0; } }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: async (tx: any, bookingId: number, kind: string, title: string, message: string, actorId: number | undefined, metadata: any) => {
  await tx.insert(s.bookingLifecycleEvents).values({ bookingId, kind, title, message, actorId: actorId ?? null, metadata: metadata ?? {}, emails: [] });
} }));
vi.mock('./booking-policy-settings', () => ({ kitchenBookingPolicies: async () => h.policy }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 9, minimumBookingHours: 1 }) } }));
const hours = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ startTime: `${String(from + i).padStart(2, '0')}:00`, endTime: `${String(from + i + 1).padStart(2, '0')}:00` }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {
  operatingWindow: async () => ({ startTime: '09:00', endTime: '17:00' }),
  validateBookingAvailability: async (_k: number, date: Date, _a: string, _b: string, options: any) => {
    h.availability.push(options);
    const day = date.toISOString().slice(0, 10);
    // Money moved, then someone else took a day: the change can't follow (capture/refund-then-apply recovery).
    if (h.closed.has(day) || h.failAfterMoney && (h.captures > 0 || h.refunds.length > 0)) return { valid: false, code: 'booked', error: `${day} was just booked by someone else` };
    return { valid: true, windowStartTime: '09:00', slots: options.fullDay ? hours(9, 17) : options.selectedSlots };
  },
} }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: async (subtotal: number) => ({ platformCommissionInCents: Math.round(subtotal * 0.07) }) }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }),
  persistBookingCloseout: async (id: number) => { h.closeout.push(id); return { changed: true }; } }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: vi.fn() }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./kitchen-change-payout', () => ({ releaseKitchenChangePayoutForSource: vi.fn(async () => ({ success: true })), sweepKitchenChangePayouts: vi.fn() }));
vi.mock('./stripe-service', () => ({
  getCancellationPaymentFacts: async (intentId: string) => {
    const [source] = await h.db.select().from(s.paymentTransactions).where(eq(s.paymentTransactions.paymentIntentId, intentId));
    const refunds = structuredClone(h.refunds.filter(r => r.payment_intent === intentId));
    return { captured: Number(source.amount), processingCost: Number(source.stripeProcessingFee), currency: 'cad', chargeId: source.chargeId, balanceTransactionId: 'bt',
      feeDetails: [], refunded: refunds.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0), refunds };
  },
  getCancellationReversalEvidence: async () => [],
  getPaymentIntentRefunds: async (intentId: string) => structuredClone(h.refunds.filter(r => r.payment_intent === intentId)),
  verifyCancellationRefundFunding: async () => { h.fundingChecks++; return { transferId: null, available: null }; },
  reverseTransferAndRefund: async (intentId: string, amount: number, _reason: string, options: any) => {
    h.refundCalls.push({ intentId, amount, installmentReversals: options.installmentReversals, reverseTransferAmount: options.reverseTransferAmount, metadata: options.metadata });
    let refund = h.refunds.find(r => r.payment_intent === intentId && r.metadata.refund_operation_id === options.idempotencyKey);
    if (!refund) { refund = { id: `re_${h.refunds.length + 1}`, amount, currency: 'cad', payment_intent: intentId, status: 'succeeded',
      metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } }; h.refunds.push(refund); }
    return { refundId: refund.id, refundAmount: refund.amount, refundStatus: refund.status, chargeId: 'ch_days', transferReversalId: null };
  },
  getDatedCaptureEvidence: async (intentId: string) => ({ intentId, capturedCents: h.intents.get(intentId).amount_received, currency: 'cad', feeCents: 278,
    chargeId: 'ch_chg', balanceTransactionId: 'bt_chg', feeDetails: [], metadata: {} }),
}));

import * as engine from './kitchen-booking-changes';
import { readDatedCancellationQuote } from './dated-booking-cancellation';
import { syncDayPayoutSource } from './kitchen-day-payout-sources';
import { dayEntitlement, refundsAllocated, releaseDayPayout } from './kitchen-day-payouts';
import { changeScheduleDays } from '@shared/kitchen-booking-change';

beforeAll(async () => {
  const ddl = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const ledger = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), ddl.indexOf('DROP TRIGGER'));
  const test = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.paymentTransactions,
    s.equipmentListings, s.equipmentBookings, s.storageBookings, s.bookingFlags, s.supportActions, s.commitmentProblems, s.kitchenBookingChanges,
    s.kitchenBookingExtensions, s.paymentHistory, s.kitchenVisitArrivalChallenges, s.kitchenCheckoutHolds, s.bookingLifecycleEvents, s.kitchenViewings], [ledger,
    'ALTER TABLE booking_flags DROP COLUMN visit_id; ALTER TABLE commitment_problems DROP COLUMN visit_id',
    readFileSync('migrations/0102_day_payout_problem_scope.sql', 'utf8'),
    'CREATE UNIQUE INDEX cp7_group_day ON kitchen_checkout_holds(group_id, operating_date) WHERE group_id IS NOT NULL',
    'CREATE UNIQUE INDEX cp7_visit_block ON kitchen_booking_visits(booking_id, block_index)',
    'CREATE UNIQUE INDEX cp7_visit_date ON kitchen_booking_visits(booking_id, schedule_revision, visit_date)',
    'CREATE UNIQUE INDEX cp7_change_open ON kitchen_booking_changes(booking_id) WHERE state IN (\'requested\',\'awaiting_consent\',\'awaiting_payment\',\'payment_pending\',\'authorized\',\'capture_pending\',\'refund_pending\',\'release_pending\',\'recovery_required\')',
    'CREATE UNIQUE INDEX cp7_payment_intent ON payment_transactions(payment_intent_id)',
    readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
    'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()']);
  h.db = test.db; h.client = test.client;
}, 60_000);
afterAll(async () => { await h.client?.close(); });

const MON = '2099-11-02', TUE = '2099-11-03', WED = '2099-11-04', THU = '2099-11-05', FRI = '2099-11-06', SAT = '2099-11-07';
const NOW = new Date('2099-10-25T12:00:00Z');
const at9 = (date: string) => `${date}T09:00:00.000Z`;
const slots8 = hours(9, 17);
const chef = { id: 3, role: 'chef' }, manager = { id: 2, role: 'manager' }, admin = { id: 1, role: 'admin' };
const snapshot: CancellationPolicySnapshot = { policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50, deadlineBasis: 'booking_first_day',
  tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'UTC',
  sessions: [MON, WED, FRI].map(date => ({ startAt: at9(date) })), disclosureVersion: DATED_DISCLOSURE_VERSION, acceptedAt: '2099-10-01T00:00:00.000Z' };
const get = async (table: any) => (await h.db.select().from(table)).sort((a: any, b: any) => a.id - b.id);
const booking = async () => (await get(s.kitchenBookings))[0];
const change = async () => (await get(s.kitchenBookingChanges)).at(-1);
const sum = (rows: any[], key: string) => rows.reduce((n, row) => n + Number(row[key]), 0);
const live = (rows: any[]) => rows.filter(row => !row.evidence?.supersededBy);

/** Equipment: a Mixer at $25 per day (listing 7). `mixerOnMon`: the original Monday has it (optionally already removed and refunded). */
async function seed(options: { mixerOnMon?: 'active' | 'removed' } = {}) {
  await h.client.exec(`TRUNCATE users, locations, kitchens, kitchen_bookings, kitchen_booking_visits, payment_transactions, equipment_listings, equipment_bookings,
    kitchen_booking_day_allocations, kitchen_booking_day_payouts, booking_flags, commitment_problems, support_actions, kitchen_booking_changes,
    kitchen_booking_extensions, payment_history, kitchen_visit_arrival_challenges, kitchen_checkout_holds, booking_lifecycle_events, storage_bookings RESTART IDENTITY CASCADE`);
  Object.assign(h, { closed: new Set(), failAfterMoney: false, refunds: [], next: 1, availability: [], revoked: [], enrolled: [], refundCalls: [], fundingChecks: 0, captures: 0, closeout: [] });
  h.intents.clear();
  h.policy = { timezone: 'UTC', bookingBufferMinutes: 0, maxBookingDays: 7, allowMultiDayBookings: true, multidayCreationEnabled: false,
    defaultDailyBookingLimit: null, minimumBookingWindowHours: 1, weeklyChefHoursLimit: null, maxAdvanceBookingDays: 90 };
  await h.db.insert(s.users).values([{ id: 1, username: 'staff@test.invalid', password: 'x', role: 'admin' },
    { id: 2, username: 'kitchen@test.invalid', password: 'x', role: 'manager', stripeConnectAccountId: 'acct_days', preferredLocale: 'en-CA' },
    { id: 3, username: 'chef@test.invalid', password: 'x', role: 'chef', preferredLocale: 'en-CA' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Harbour', address: 'Test', timezone: 'UTC' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Harbour kitchen', hourlyRate: '2250', dailyRate: '18000', taxRatePercent: '15', isActive: true, listingStatus: 'active' });
  await h.db.insert(s.equipmentListings).values({ id: 7, kitchenId: 4, equipmentType: 'Mixer', category: 'food-prep', condition: 'excellent', pricingModel: 'daily',
    availabilityType: 'rental', sessionRate: '2500', isActive: true } as any);
  const dates = [MON, WED, FRI];
  const [row] = await h.db.insert(s.kitchenBookings).values({ id: 1, referenceCode: 'KB-DAYS', kitchenId: 4, chefId: 3, bookingDate: new Date(`${MON}T12:00:00Z`),
    startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', pricingMode: 'daily', totalPrice: '54000', serviceFee: '3780', status: 'confirmed', paymentStatus: 'paid',
    scheduleRevision: 1, paymentIntentId: 'pi_days', cancellationPolicyHours: 24, cancellationPolicySnapshot: snapshot, createdAt: new Date('2099-10-01T00:00:00Z'),
    bufferMinutesSnapshot: 0, stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', currency: 'CAD',
    selectedSlots: dates.flatMap(date => slots8.map(slot => ({ ...slot, date, windowStartTime: '09:00' }))) }).returning();
  const visits = await h.db.insert(s.kitchenBookingVisits).values(dates.map((date, i) => ({ id: i + 1, bookingId: 1, blockIndex: i, visitDate: date, scheduleRevision: 1,
    scheduleState: 'active', startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', pricingMode: 'daily', selectedSlots: slots8 }))).returning();
  const clock = makeCloseoutSnapshot(row, 'UTC', { serviceEndGraceMinutes: 30, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }, visits);
  await h.db.update(s.kitchenBookings).set({ visitDuties: { clockCloseout: clock } }).where(eq(s.kitchenBookings.id, 1));
  const components: Array<{ visitId: number; key: string; sub: number; index: number }> = dates.map((_, i) => ({ visitId: i + 1, key: 'kitchen', sub: 18000, index: i }));
  if (options.mixerOnMon) {
    const [item] = await h.db.insert(s.equipmentBookings).values({ kitchenBookingId: 1, kitchenBookingVisitId: 1, chefId: 3, equipmentListingId: 7,
      startDate: new Date(at9(MON)), endDate: new Date(`${MON}T17:00:00Z`), status: options.mixerOnMon === 'removed' ? 'cancelled' : 'confirmed', paymentStatus: 'paid',
      paymentIntentId: 'pi_days', totalPrice: '2500', pricingModel: 'daily', damageDeposit: '0' }).returning();
    components.splice(1, 0, { visitId: 1, key: `equipment:${item.id}`, sub: 2500, index: 0 });
  }
  const rows = components.map(c => ({ ...c, tax: c.sub * 15 / 100, svc: c.sub * 7 / 100 }));
  const gross = sum(rows.map(r => ({ v: r.sub + r.tax })), 'v'), fee = options.mixerOnMon ? 2019 : 1941;
  const fees = allocateCents(fee, rows.map(r => r.sub + r.tax)), total = sum(rows.map(r => ({ v: r.sub + r.tax + r.svc })), 'v');
  const removed = options.mixerOnMon === 'removed';
  // An item the chef removed before the deadline (CP6): refunded its paid share minus its card-fee share; the kitchen keeps nothing for it.
  const item = rows[1], itemFee = fees[1], itemRefund = removed ? item.sub + item.tax + item.svc - itemFee : 0;
  await h.db.insert(s.paymentTransactions).values({ id: 1, bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: String(total),
    baseAmount: String(gross), taxAmount: String(sum(rows, 'tax')), serviceFee: String(sum(rows, 'svc')), stripeProcessingFee: String(fee),
    managerRevenue: String(gross - fee), netAmount: String(total), status: removed ? 'partially_refunded' : 'succeeded', currency: 'cad', refundAmount: String(itemRefund),
    paymentIntentId: 'pi_days', chargeId: 'ch_days', payoutPartition: 'per_day', payoutTiming: 'after_closeout',
    metadata: removed ? { refunds: [{ id: 're_item', customerReceived: itemRefund, managerDebited: item.sub + item.tax - itemFee, platformServiceFeeReturned: item.svc }],
      cancellationRefundOperations: [{ id: 'op_item', dated: true, status: 'succeeded', refundId: 're_item' }] } : {} });
  if (removed) h.refunds.push({ id: 're_item', amount: itemRefund, currency: 'cad', payment_intent: 'pi_days', status: 'succeeded',
    metadata: { refund_operation_id: 'op_item', customer_receives: String(itemRefund), manager_debited: String(item.sub + item.tax - itemFee), platform_service_fee_returned: String(item.svc) } });
  await h.db.insert(s.kitchenBookingDayAllocations).values(rows.map((r, i) => ({ sourceId: 1, visitId: r.visitId, componentKey: r.key,
    subtotalCents: r.sub, taxCents: r.tax, serviceFeeCents: r.svc, stripeFeeCents: fees[i],
    evidence: { chargeId: 'ch_days', balanceTransactionId: 'bt_days', sessionIndex: r.index, kind: r.key === 'kitchen' ? 'kitchen' : 'equipment',
      ...(removed && i === 1 ? { managerDebitedCents: r.sub + r.tax - fees[i], refunds: [{ operationId: 'op_item', mode: 'chef', customerCents: itemRefund,
        kitchenCents: r.sub + r.tax - fees[i], platformCents: r.svc, absorbedFeeCents: 0, feeCents: fees[i], refundPercent: 100, policyNumerator: (itemRefund) * 100, policyCents: itemRefund }] } : {}) } })));
  // Explicit fixture ids do not advance the serial sequences.
  for (const table of ['kitchen_booking_visits', 'payment_transactions']) await h.client.exec(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`);
  const { ensureDayPayoutRows } = await import('./kitchen-day-payouts');
  await h.db.transaction((tx: any) => ensureDayPayoutRows(tx, 1));
}

/** An in-memory Stripe with the surface the engine uses. */
const stripe: any = { paymentIntents: {
  create: async (params: any) => { const intent = { id: `pi_chg_${h.next++}`, amount: params.amount, currency: params.currency, customer: params.customer,
    payment_method: params.payment_method, metadata: params.metadata, status: 'requires_capture', amount_received: 0, latest_charge: 'ch_chg' }; h.intents.set(intent.id, intent); return { ...intent }; },
  retrieve: async (id: string) => ({ ...h.intents.get(id) }),
  capture: async (id: string) => { const intent = h.intents.get(id); if (intent.status === 'requires_capture') { h.captures++; intent.status = 'succeeded'; intent.amount_received = intent.amount; } return { ...intent }; },
  cancel: async (id: string) => { const intent = h.intents.get(id); intent.status = 'canceled'; return { ...intent }; },
  search: async () => ({ data: [...h.intents.values()] }),
} };

const full = (date: string, equipmentIds: number[] = []) => ({ date, pricingMode: 'daily' as const, slots: [], windowStart: '09:00', equipmentIds });
const hourly = (date: string, from: number, to: number, equipmentIds: number[] = []) => ({ date, pricingMode: 'hourly' as const, slots: hours(from, to), windowStart: '09:00', equipmentIds });
const days = (...list: any[]) => ({ version: 'days-v1' as const, days: list });
async function request(destination: any, now = NOW) {
  const quote = await engine.previewKitchenChange(1, chef, { destination }, now);
  const result: any = await engine.requestKitchenChange(stripe, 1, chef, { destination, quoteHash: quote.quoteHash, requestKey: crypto.randomUUID() }, now);
  return { quote, change: result.change ?? result };
}
const decide = async (action: 'approve' | 'decline' | 'withdraw', now = NOW) => {
  const open = await change();
  return engine.decideKitchenChange(stripe, 1, open.id, action === 'withdraw' ? chef : manager, { action, revision: open.revision }, now);
};
const originalIntact = async (held = false) => {
  const b = await booking();
  expect(b.scheduleRevision).toBe(1);
  expect((b.cancellationPolicySnapshot as any).sessions).toEqual(snapshot.sessions);
  const visits = await get(s.kitchenBookingVisits);
  expect(visits.map((v: any) => [v.visitDate, v.scheduleState])).toEqual([[MON, 'active'], [WED, 'active'], [FRI, 'active']]);
  expect((await get(s.kitchenBookingDayAllocations)).every((row: any) => !row.evidence.supersededBy && row.allocationRevision === 1)).toBe(true);
  if (!held) expect(await get(s.kitchenCheckoutHolds)).toEqual([]);
};

beforeEach(async () => { vi.setSystemTime(NOW); await seed(); });

describe('CP7 dated changes: validation and eligibility', () => {
  it('offers a change on a dated booking with its current days, before the one deadline only', async () => {
    const read = await engine.readKitchenChanges(1, chef, NOW);
    expect(read).toMatchObject({ dated: true, canRequest: { allowed: true, until: '2099-11-01T09:00:00.000Z' } });
    expect(changeScheduleDays(read.original).map(day => day.date)).toEqual([MON, WED, FRI]);
    const late = await engine.readKitchenChanges(1, chef, new Date('2099-11-01T09:00:00Z'));
    expect(late.canRequest).toMatchObject({ allowed: false, code: 'eligibilityTooClose' });
  });

  it('applies the count and 14-day span rules, the kitchen switch and per-date availability (gate off: an existing booking can still change)', async () => {
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(TUE), full('2099-11-18')) }, NOW)).rejects.toThrow('All selected days must fall within 14 days of the first day.');
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(TUE), full('2099-11-17')) }, NOW)).resolves.toBeTruthy();
    h.policy.maxBookingDays = 2;
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(TUE), full(THU), full(SAT)) }, NOW)).rejects.toThrow('Select up to 2 days in one booking.');
    h.policy.allowMultiDayBookings = false;
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(TUE), full(THU)) }, NOW)).rejects.toThrow('This kitchen accepts one day per booking.');
    h.policy = { ...h.policy, allowMultiDayBookings: true, maxBookingDays: 7 };
    h.closed.add(THU);
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(TUE), full(THU)) }, NOW)).rejects.toThrow(`${THU} was just booked by someone else`);
    // The booking's own days never block it; the advance window still applies at request time.
    h.closed.clear();
    await engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(THU)) }, NOW);
    expect(h.availability.at(-1)).toMatchObject({ excludeBookingId: 1, keepAdvanceWindow: true, bufferMinutes: 0 });
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(WED), full(FRI)) }, NOW)).rejects.toMatchObject({ code: 'chooseDifferentTime' });
  });

  it('allows only one open change, and makes the change support-only once any day was paid out', async () => {
    await request(days(full(TUE), full(THU), full(SAT)));
    await expect(request(days(full(TUE), full(THU)))).rejects.toMatchObject({ code: 'changeAlreadyOpen' });
    await decide('withdraw');
    await h.db.update(s.kitchenBookingDayPayouts).set({ transferId: 'tr_paid' }).where(eq(s.kitchenBookingDayPayouts.visitId, 1));
    expect((await engine.readKitchenChanges(1, chef, NOW)).canRequest).toMatchObject({ allowed: false, code: 'datedChangeSupport' });
    await expect(request(days(full(TUE), full(THU), full(SAT)))).rejects.toMatchObject({ code: 'datedChangeSupport' });
  });
});

describe('CP7 dated changes: money and apply', () => {
  it('equal price, mixed mode: approval moves Mon/Wed/Fri to Tue (8 hours)/Thu/Sat at once, with new visits, codes, sessions (0098) and a moved ledger', async () => {
    // 8 hours x $22.50 = one $180 full day, so the whole total is unchanged.
    const { quote } = await request(days(hourly(TUE, 9, 17), full(THU), full(SAT)));
    expect(quote.money).toMatchObject({ oldTotalCents: 65880, newTotalCents: 65880, payCents: 0, refundCents: 0 });
    expect(quote.freeCancelAfter).toBe('2099-11-02T09:00:00.000Z');
    // The whole destination is held while the original days stay booked.
    const head = (await change()).holdId;
    expect((await get(s.kitchenCheckoutHolds)).map((hold: any) => [hold.operatingDate, hold.groupId])).toEqual([TUE, THU, SAT].map(date => [date, head]));
    expect((await get(s.kitchenBookingVisits)).every((v: any) => v.scheduleState === 'active')).toBe(true);
    const applied: any = await decide('approve');
    expect(applied.state).toBe('applied');
    const b = await booking();
    expect([b.scheduleRevision, b.bookingDate.toISOString().slice(0, 10), b.startTime, b.endTime]).toEqual([2, TUE, '09:00', '17:00']);
    // 0098: only `sessions` moved; the one deadline follows the new first day.
    expect(b.cancellationPolicySnapshot).toEqual({ ...snapshot, sessions: [TUE, THU, SAT].map(date => ({ startAt: at9(date) })) });
    const visits = await get(s.kitchenBookingVisits);
    expect(visits.map((v: any) => [v.visitDate, v.scheduleRevision, v.scheduleState, v.blockIndex, v.pricingMode])).toEqual([[MON, 1, 'superseded', 0, 'daily'],
      [WED, 1, 'superseded', 1, 'daily'], [FRI, 1, 'superseded', 2, 'daily'], [TUE, 2, 'active', 3, 'hourly'], [THU, 2, 'active', 4, 'daily'], [SAT, 2, 'active', 5, 'daily']]);
    expect(h.revoked).toEqual([1, 2, 3]);
    expect(h.enrolled).toEqual([1]);
    expect(await get(s.kitchenCheckoutHolds)).toEqual([]);
    const rows = await get(s.kitchenBookingDayAllocations);
    expect(rows.filter((r: any) => r.allocationRevision === 1).every((r: any) => r.evidence.supersededBy?.allocationRevision === 2)).toBe(true);
    const moved = live(rows);
    expect(moved.map((r: any) => [r.visitId, r.componentKey, r.subtotalCents, r.taxCents, r.serviceFeeCents, r.stripeFeeCents, r.allocationRevision]))
      .toEqual([[4, 'kitchen', 18000, 2700, 1260, 647, 2], [5, 'kitchen', 18000, 2700, 1260, 647, 2], [6, 'kitchen', 18000, 2700, 1260, 647, 2]]);
    const installments = await get(s.kitchenBookingDayPayouts);
    expect(installments.map((p: any) => [p.visitId, p.allocationRevision, p.noEntitlement])).toEqual([[1, 1, true], [2, 1, true], [3, 1, true], [4, 2, false], [5, 2, false], [6, 2, false]]);
    expect(dayEntitlement(moved.filter((r: any) => r.visitId === 5))).toBe(20053);
    // Notices name the old and the new dates.
    const asked = (await get(s.bookingLifecycleEvents)).find((e: any) => e.kind === 'booking_change_requested' && e.metadata.audience === 'manager');
    expect(asked.message).toContain('from Mon, Nov 2, 9:00 a.m.–5:00 p.m.; Wed, Nov 4, 9:00 a.m.–5:00 p.m.; Fri, Nov 6, 9:00 a.m.–5:00 p.m. to Tue, Nov 3');
    const notice = (await get(s.bookingLifecycleEvents)).find((e: any) => e.kind === 'booking_change_approved' && e.metadata.audience === 'chef');
    expect(notice.message).toContain('now Tue, Nov 3, 9:00 a.m.–5:00 p.m.; Thu, Nov 5, 9:00 a.m.–5:00 p.m.; Sat, Nov 7');
    const admin = (await get(s.bookingLifecycleEvents)).find((e: any) => e.kind === 'booking_changed');
    expect(admin.message).toMatch(/from Mon, Nov 2.*Fri, Nov 6.* to Tue, Nov 3.*Sat, Nov 7/);
    // A superseded installment never pays out.
    expect(await releaseDayPayout(installments[0].id, NOW)).toMatchObject({ transferred: false });
    // The accepted terms themselves stay immutable (0098 executes in this database).
    await expect(h.client.exec(`UPDATE kitchen_bookings SET cancellation_policy_snapshot = jsonb_set(cancellation_policy_snapshot, '{noticeHours}', '1') WHERE id = 1`))
      .rejects.toThrow(/immutable/);
  });

  it('negative, mixed mode: refunds the difference minus its card-fee share through a per-day refund, then the CP6 reader prices the new days', async () => {
    const { quote } = await request(days(hourly(TUE, 9, 13), full(THU)));
    // $90 + $180 = $270, HST $40.50, fee $18.90 -> $329.40; difference $329.40, card-fee share round(1941 x 32940 / 65880) = $9.71.
    expect(quote.money).toMatchObject({ oldTotalCents: 65880, newTotalCents: 32940, payCents: 0, refundCents: 31969, feeKeptCents: 971 });
    const result: any = await decide('approve');
    expect(result.state).toBe('applied');
    expect(h.refundCalls).toEqual([expect.objectContaining({ intentId: 'pi_days', amount: 31969, installmentReversals: [], reverseTransferAmount: undefined,
      metadata: expect.objectContaining({ customer_receives: '31969', manager_debited: '30079', platform_service_fee_returned: '1890' }) })]);
    expect(h.fundingChecks).toBe(0);
    const rows = live(await get(s.kitchenBookingDayAllocations));
    const part = rows.find((r: any) => r.componentKey.startsWith('change-refund:'));
    expect([part.visitId, part.subtotalCents, part.taxCents, part.serviceFeeCents, part.stripeFeeCents, part.evidence.managerDebitedCents]).toEqual([1, 27000, 4050, 1890, 971, 30079]);
    expect(dayEntitlement([part])).toBe(0);
    const tue = rows.filter((r: any) => r.visitId === 4), thu = rows.filter((r: any) => r.visitId === 5);
    expect(tue.map((r: any) => [r.subtotalCents, r.taxCents, r.serviceFeeCents, r.stripeFeeCents])).toEqual([[9000, 1350, 630, 323]]);
    expect(thu.map((r: any) => [r.subtotalCents, r.taxCents, r.serviceFeeCents, r.stripeFeeCents])).toEqual([[18000, 2700, 1260, 647]]);
    // Conservation: the source still sums to what it captured and its actual fee; the kitchen's remaining net is the original minus its debit.
    expect([sum(rows.map((r: any) => ({ v: r.subtotalCents + r.taxCents + r.serviceFeeCents })), 'v'), sum(rows, 'stripeFeeCents')]).toEqual([65880, 1941]);
    expect(dayEntitlement(tue) + dayEntitlement(thu)).toBe(62100 - 1941 - 30079);
    const [source] = await get(s.paymentTransactions);
    expect(refundsAllocated(source)).toBe(true);
    // CP6 on the new days: dropping Thursday before the (moved) deadline returns its paid share minus its card-fee share.
    const drop: any = await readDatedCancellationQuote(1, { role: 'chef', id: 3 }, { visitIds: [5] }, NOW);
    expect(drop).toMatchObject({ chefRefundCents: 21313, deadlineAt: '2099-11-02T09:00:00.000Z', beforeDeadline: true });
  });

  it('positive, mixed mode with equipment: holds only the difference, captures it on approval and splits that charge over the new days', async () => {
    const destination = days(full(MON), full(WED, [7]), hourly(FRI, 9, 11), full(SAT));
    const { quote, change: sent } = await request(destination);
    // $180 + $180 + $25 + $45 + $180 = $610, HST $91.50, fee $42.70 -> $744.20; the chef pays $85.40 more.
    expect(quote.money).toMatchObject({ oldTotalCents: 65880, newTotalCents: 74420, payCents: 8540 });
    expect(sent.state).toBe('authorized');
    expect([...h.intents.values()].map(i => [i.amount, i.status, i.metadata.kitchen_change_id])).toEqual([[8540, 'requires_capture', sent.id]]);
    expect((await get(s.kitchenCheckoutHolds)).map((hold: any) => hold.operatingDate)).toEqual([MON, WED, FRI, SAT]);
    expect((await decide('approve') as any).state).toBe('applied');
    expect(h.captures).toBe(1);
    const sources = await get(s.paymentTransactions);
    expect(sources[1]).toMatchObject({ amount: '8540', baseAmount: '8050', taxAmount: '1050', serviceFee: '490', payoutPartition: 'per_day', payoutTiming: 'after_closeout' });
    const visits = (await get(s.kitchenBookingVisits)).filter((v: any) => v.scheduleRevision === 2);
    const [mixer] = (await get(s.equipmentBookings)).filter((e: any) => e.status === 'confirmed');
    expect([mixer.kitchenBookingVisitId, mixer.totalPrice]).toEqual([visits[1].id, '2500']);
    expect(sources[1].metadata.dayComponents.map((c: any) => [c.visitId, c.componentKey, c.subtotalCents])).toEqual([[visits[0].id, 'kitchen', 2066],
      [visits[1].id, 'kitchen', 2066], [visits[1].id, `equipment:${mixer.id}`, 287], [visits[2].id, 'kitchen', 516], [visits[3].id, 'kitchen', 2065]]);
    // CP5 then allocates that separate charge (with its own verified fee) over the new days.
    await syncDayPayoutSource(2);
    const extra = (await get(s.kitchenBookingDayAllocations)).filter((r: any) => r.sourceId === 2);
    expect([sum(extra, 'subtotalCents'), sum(extra, 'taxCents'), sum(extra, 'serviceFeeCents'), sum(extra, 'stripeFeeCents')]).toEqual([7000, 1050, 490, 278]);
    const original = live((await get(s.kitchenBookingDayAllocations)).filter((r: any) => r.sourceId === 1));
    expect([sum(original, 'subtotalCents'), sum(original, 'taxCents'), sum(original, 'serviceFeeCents'), sum(original, 'stripeFeeCents')]).toEqual([54000, 8100, 3780, 1941]);
    expect(original.every((r: any) => r.allocationRevision === 2 && visits.some((v: any) => v.id === r.visitId))).toBe(true);
    // Both sources together pay exactly the new booking total.
    expect(sum([...extra, ...original].map((r: any) => ({ v: r.subtotalCents + r.taxCents + r.serviceFeeCents })), 'v')).toBe(74420);
  });

  it('keeps a settled add-on: an item removed earlier stays refunded, out of the old total, and is never refunded again', async () => {
    await seed({ mixerOnMon: 'removed' });
    const { quote } = await request(days(full(TUE), full(THU), full(SAT)));
    expect(quote.money).toMatchObject({ oldTotalCents: 65880, newTotalCents: 65880, payCents: 0, refundCents: 0 });
    await decide('approve');
    const rows = await get(s.kitchenBookingDayAllocations);
    const item = rows.find((r: any) => r.componentKey.startsWith('equipment:'));
    expect(item.evidence.supersededBy).toBeUndefined();
    expect(item.evidence.refunds).toHaveLength(1);
    // Fees by manager gross: Mon/Wed/Fri $6.43 each, the removed Mixer $0.90 (kept by its earlier refund); only the days' $19.29 moves.
    expect(live(rows).filter((r: any) => r.allocationRevision === 2).map((r: any) => r.stripeFeeCents)).toEqual([643, 643, 643]);
    expect(sum(live(rows), 'stripeFeeCents')).toBe(2019);
    expect(h.refundCalls).toEqual([]);
  });
});

describe('CP7 dated changes: closing and recovery', () => {
  it('decline, expiry and withdrawal release the whole destination and leave the original intact', async () => {
    await request(days(full(TUE), full(THU), full(SAT)));
    expect((await decide('decline') as any).state).toBe('declined');
    await originalIntact();
    await request(days(full(TUE), full(THU), full(SAT)));
    await engine.expireKitchenChangeForBooking(stripe, 1, new Date('2099-10-26T13:00:00Z'));
    expect((await change()).state).toBe('expired');
    await originalIntact();
    await request(days(full(MON), full(WED, [7]), full(FRI), full(SAT)));
    expect([...h.intents.values()].at(-1).status).toBe('requires_capture');
    expect((await decide('withdraw') as any).state).toBe('withdrawn');
    expect([...h.intents.values()].at(-1).status).toBe('canceled');
    await originalIntact();
  });

  it('capture then apply failure: recovery keeps the booking, finish applies once without a second charge', async () => {
    h.failAfterMoney = true;
    await request(days(full(MON), full(WED), full(FRI), full(SAT)));
    expect((await decide('approve') as any).state).toBe('recovery_required');
    expect(h.captures).toBe(1);
    await originalIntact(true);
    expect((await get(s.paymentTransactions))[1].metadata.dayComponents).toBeUndefined();
    h.failAfterMoney = false;
    const open = await change();
    const result: any = await engine.resolveKitchenChange(stripe, 1, open.id, admin, { action: 'finish', revision: open.revision }, NOW);
    expect(result.change.state).toBe('applied');
    expect(h.captures).toBe(1);
    expect((await booking()).scheduleRevision).toBe(2);
    expect((await get(s.paymentTransactions))[1].metadata.dayComponents).toHaveLength(4);
  });

  it('refund then apply failure: finish applies without a second refund; keep-refund closes it Local Cooks-funded and holds all payouts', async () => {
    h.failAfterMoney = true;
    await request(days(full(TUE), full(THU)));
    expect((await decide('approve') as any).state).toBe('recovery_required');
    expect(h.refunds).toHaveLength(1);
    await originalIntact(true);
    expect(refundsAllocated((await get(s.paymentTransactions))[0])).toBe(false);
    const open = await change();
    const kept: any = await engine.resolveKitchenChange(stripe, 1, open.id, admin, { action: 'close_keep_refund', revision: open.revision }, NOW);
    expect(kept.change.state).toBe('withdrawn');
    expect(refundsAllocated((await get(s.paymentTransactions))[0])).toBe(false);
    expect(await get(s.bookingFlags)).toEqual([expect.objectContaining({ bookingId: 1, kind: 'support', visitId: null, resolvedAt: null })]);
    await originalIntact();

    await seed();
    h.failAfterMoney = true;
    await request(days(full(TUE), full(THU)));
    await decide('approve');
    h.failAfterMoney = false;
    const again = await change();
    expect((await engine.resolveKitchenChange(stripe, 1, again.id, admin, { action: 'finish', revision: again.revision }, NOW) as any).change.state).toBe('applied');
    expect(h.refunds).toHaveLength(1);
    expect((await booking()).scheduleRevision).toBe(2);
    expect(refundsAllocated((await get(s.paymentTransactions))[0])).toBe(true);
  });

});
