/**
 * Oct 18 independent money review on in-process PGlite: one change request for a whole dated booking, through the real WP-RS engine, the real CP3
 * day validator (count/span/notice/equipment/weekly; only the single-day availability engine is stubbed), CP4 pricing, the
 * CP5 day ledger and the CP6 refund reader. The actual 0099 ledger DDL, 0102 scopes and the 0098 policy trigger execute here.
 * Only provider I/O, delivery, reminders and closeout persistence are in memory.
 *
 * Worked example (team test plan C): Mon/Wed/Fri full days at $180, 15% HST, 7% service fee; total $658.80, actual card fee $19.41.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { allocateCents, DATED_DISCLOSURE_VERSION, type CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, connection: null as any, policy: {} as any, closed: new Set<string>(), failAfterMoney: false,
  intents: new Map<string, any>(), sessions: [] as any[], refunds: [] as any[], next: 1, availability: [] as any[], revoked: [] as number[], enrolled: [] as number[],
  refundCalls: [] as any[], fundingChecks: 0, captures: 0, closeout: [] as number[] }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => {
  const reader = h.connection?.getStore() ?? h.db;
  if (key === 'transaction') return (work: any) => reader.transaction((tx: any) => h.connection.run(tx, () => work(tx)));
  return typeof reader[key] === 'function' ? reader[key].bind(reader) : reader[key];
} }), pool: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://app.test' }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Ana' }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./booking-money-guard', async () => ({ ...await vi.importActual<object>('./booking-money-guard'), assertBookingMoneyWritable: async () => undefined }));
vi.mock('./visit-code-challenge', async () => {
  const actual = await vi.importActual<typeof import('./visit-code-challenge')>('./visit-code-challenge');
  return { ...actual, revokeForBooking: vi.fn(), revokeForVisit: async (tx: any, bookingId: number, visitId: number) => {
    h.revoked.push(visitId); return actual.revokeForVisit(tx, bookingId, visitId, 'booking_changed');
  }, ensureChallengesForBooking: async (tx: any, bookingId: number, actor?: number, mode?: any) => {
    h.enrolled.push(bookingId); return actual.ensureChallengesForBooking(tx, bookingId, actor, mode);
  } };
});
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
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `REVIEW-${h.next++}` }));
vi.mock('./session-extension-settings', () => ({ sessionExtensionsEnabled: async () => true }));
vi.mock('./session-extension-notice', () => ({ queueSessionExtensionNotices: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn() } }));
vi.mock('./kitchen-change-payout', () => ({ releaseKitchenChangePayoutForSource: vi.fn(async () => ({ success: true })), sweepKitchenChangePayouts: vi.fn() }));
vi.mock('./stripe-service', () => ({
  getBookingPaymentIntent: async (id: string) => structuredClone(h.intents.get(id)),
  getBookingCheckoutSession: async (id: string) => h.sessions.find(row => row.payment_intent === id),
  capturePaymentIntent: async (id: string, amount: number) => {
    const intent = h.intents.get(id);
    if (intent.status === 'requires_capture') { h.captures++; Object.assign(intent, { status: 'succeeded', amount_received: amount, amount_capturable: 0 }); }
    return structuredClone(intent);
  },
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
    if (!refund) { refund = { id: `re_${h.refunds.length + 1}`, amount, currency: 'cad', charge: 'ch_days', payment_intent: intentId, status: 'succeeded',
      metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } }; h.refunds.push(refund); }
    return { refundId: refund.id, refundAmount: refund.amount, refundStatus: refund.status, chargeId: 'ch_days', transferReversalId: null };
  },
  getDatedCaptureEvidence: async (intentId: string) => ({ intentId, capturedCents: h.intents.get(intentId).amount_received, currency: 'cad', feeCents: 278,
    chargeId: 'ch_chg', balanceTransactionId: 'bt_chg', feeDetails: [], metadata: h.intents.get(intentId).metadata }),
}));

import * as engine from './kitchen-booking-changes';
import { readDatedCancellationQuote } from './dated-booking-cancellation';
import { syncDayPayoutSource } from './kitchen-day-payout-sources';
import { dayEntitlement } from './kitchen-day-payouts';

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Review tests must remain offline'); }));
  const ddl = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const ledger = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), ddl.indexOf('DROP TRIGGER'));
  const test = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings, s.kitchenBookingVisits, s.paymentTransactions,
    s.equipmentListings, s.equipmentBookings, s.storageBookings, s.bookingFlags, s.supportActions, s.commitmentProblems, s.kitchenBookingChanges,
    s.kitchenBookingExtensions, s.paymentHistory, s.kitchenVisitArrivalChallenges, s.kitchenCheckoutHolds, s.bookingLifecycleEvents, s.kitchenViewings,
    s.kitchenAvailability, s.kitchenDateOverrides, s.platformSettings, s.emailLogs, s.kitchenCheckoutIncidents,
    s.kitchenInvitations, s.kitchenInvitationEvents], [ledger,
    'ALTER TABLE booking_flags DROP COLUMN visit_id; ALTER TABLE commitment_problems DROP COLUMN visit_id',
    readFileSync('migrations/0102_day_payout_problem_scope.sql', 'utf8'),
    'CREATE UNIQUE INDEX cp7_group_day ON kitchen_checkout_holds(group_id, operating_date) WHERE group_id IS NOT NULL',
    'CREATE UNIQUE INDEX cp7_arrival_target ON kitchen_visit_arrival_challenges(target_key)',
    'CREATE UNIQUE INDEX cp7_visit_block ON kitchen_booking_visits(booking_id, block_index)',
    'CREATE UNIQUE INDEX cp7_visit_date ON kitchen_booking_visits(booking_id, schedule_revision, visit_date)',
    'CREATE UNIQUE INDEX cp7_change_open ON kitchen_booking_changes(booking_id) WHERE state IN (\'requested\',\'awaiting_consent\',\'awaiting_payment\',\'payment_pending\',\'authorized\',\'capture_pending\',\'refund_pending\',\'release_pending\',\'recovery_required\')',
    'CREATE UNIQUE INDEX cp7_payment_intent ON payment_transactions(payment_intent_id)',
    'CREATE UNIQUE INDEX review_incident ON kitchen_checkout_incidents(session_id)',
    'CREATE UNIQUE INDEX review_invite_notice ON kitchen_invitation_events(notice_key)',
    readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
    'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()']);
  h.db = test.db; h.client = test.client; h.connection = new AsyncLocalStorage();
}, 60_000);
afterAll(async () => { await h.client?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const MON = '2099-11-02', TUE = '2099-11-03', WED = '2099-11-04', THU = '2099-11-05', FRI = '2099-11-06', SAT = '2099-11-07';
const NOW = new Date('2099-10-25T12:00:00Z');
const at9 = (date: string) => `${date}T09:00:00.000Z`;
const slots8 = hours(9, 17);
const chef = { id: 3, role: 'chef' as const }, manager = { id: 2, role: 'manager' as const };
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
    kitchen_booking_extensions, payment_history, kitchen_visit_arrival_challenges, kitchen_checkout_holds, booking_lifecycle_events, storage_bookings,
    kitchen_availability, kitchen_date_overrides, platform_settings, email_logs, kitchen_checkout_incidents,
    kitchen_invitations, kitchen_invitation_events RESTART IDENTITY CASCADE`);
  Object.assign(h, { closed: new Set(), failAfterMoney: false, refunds: [], next: 1, availability: [], revoked: [], enrolled: [], refundCalls: [], fundingChecks: 0, captures: 0, closeout: [] });
  h.intents.clear(); h.sessions = [];
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
  for (const table of ['kitchen_bookings', 'kitchen_booking_visits', 'payment_transactions']) await h.client.exec(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`);
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
  return { quote: { ...quote, money: (await change()).quote }, change: result.change ?? result };
}
async function detailedPreview(destination: any, bookingId = 1) {
  const shown = await engine.previewKitchenChange(bookingId, chef, { destination }, NOW);
  const { priceDatedChange, validateDatedDestination } = await import('./dated-booking-changes');
  const { publicChangeMoney } = await import('@shared/kitchen-booking-reschedule');
  return h.db.transaction(async (tx: any) => {
    const [b] = await tx.select().from(s.kitchenBookings).where(eq(s.kitchenBookings.id, bookingId));
    const [kitchen] = await tx.select().from(s.kitchens).where(eq(s.kitchens.id, b.kitchenId));
    const row = { booking: b, kitchen, managerId: 2, timezone: 'UTC' };
    const { validated } = await validateDatedDestination(tx, row, destination, NOW, null, 'request');
    const { money } = await priceDatedChange(tx, row, validated);
    expect(publicChangeMoney(money)).toEqual(shown.money);
    return { ...shown, money };
  });
}
const decide = async (action: 'approve' | 'decline' | 'withdraw', now = NOW) => {
  const open = await change();
  return engine.decideKitchenChange(stripe, 1, open.id, action === 'withdraw' ? chef : manager, { action, revision: open.revision }, now);
};
beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); await seed(); });

describe('Oct 18 live fixes: independent money proofs', () => {
  it('keeps paid days and prices only the added day at the raised list rate', async () => {
    await h.db.update(s.kitchens).set({ dailyRate: '20000' }).where(eq(s.kitchens.id, 4));
    const { quote } = await request(days(full(MON), full(WED), full(FRI), full(SAT)));
    expect(quote.money).toMatchObject({ oldTotalCents: 65880, newTotalCents: 90280, payCents: 24400 });
    expect((await decide('approve')).state).toBe('applied');
    const extra = (await get(s.paymentTransactions)).find((row: any) => row.id !== 1);
    expect(extra.metadata.dayComponents.map((part: any) => part.subtotalCents)).toEqual([0, 0, 0, 20000]);
    await syncDayPayoutSource(extra.id);
    const rows = live(await get(s.kitchenBookingDayAllocations));
    expect(sum(rows, 'subtotalCents')).toBe(74000);
    expect(sum(rows, 'taxCents')).toBe(11100);
    expect(sum(rows, 'serviceFeeCents')).toBe(5180);
  });

  it('binds the hash to current prices and applies the saved quote despite later listing changes', async () => {
    const dest = days(full(MON), full(WED), full(FRI), full(SAT));
    const preview = await engine.previewKitchenChange(1, chef, { destination: dest }, NOW);
    await h.db.update(s.kitchens).set({ dailyRate: '20000' });
    await expect(engine.requestKitchenChange(stripe, 1, chef, { destination: dest, quoteHash: preview.quoteHash, requestKey: crypto.randomUUID() }, NOW))
      .rejects.toMatchObject({ code: 'priceChanged' });
    const { quote } = await request(dest);
    await h.db.update(s.kitchens).set({ dailyRate: '50000' });
    expect((await decide('approve')).state).toBe('applied');
    expect((await booking()).totalPrice).toBe(String(quote.money.newTerms.kitchenCents));
    expect(h.captures).toBe(1);
  });

  it('does not carry an old rate across a changed date, changed hours, or daily/hourly switch', async () => {
    await h.db.update(s.kitchens).set({ dailyRate: '20000', hourlyRate: '3000' });
    const quote = await detailedPreview(days(full(MON), hourly(WED, 9, 17), full(SAT)));
    expect(quote.money.datedDays.map((day: any) => day.kitchenCents)).toEqual([18000, 24000, 20000]);
    await request(days(hourly(MON, 9, 13), full(WED), full(FRI)));
    expect((await decide('approve')).state).toBe('applied');
    const short = await detailedPreview(days(hourly(MON, 10, 14), full(WED), full(FRI)));
    expect(short.money.datedDays[0].kitchenCents).toBe(12000);
  });

  it('keeps frozen equipment cents, prices new equipment at list, and refunds removal from a kept day', async () => {
    await seed({ mixerOnMon: 'active' });
    await h.db.update(s.kitchens).set({ dailyRate: '20000' });
    await h.db.update(s.equipmentListings).set({ sessionRate: '4000' });
    const added = await detailedPreview(days(full(MON, [7]), full(WED, [7]), full(FRI)));
    expect(added.money.datedDays.map((day: any) => [day.kitchenCents, day.equipment.map((item: any) => item.cents)]))
      .toEqual([[18000, [2500]], [18000, [4000]], [18000, []]]);
    const { quote } = await request(days(full(MON), full(WED), full(FRI)));
    expect(quote.money).toMatchObject({ oldTotalCents: 68930, newTotalCents: 65880, refundCents: 2961, feeKeptCents: 89 });
    expect((await decide('approve')).state).toBe('applied');
    expect((await get(s.equipmentBookings)).every((item: any) => item.status === 'cancelled')).toBe(true);
    const rows = live(await get(s.kitchenBookingDayAllocations));
    expect(sum(rows, 'subtotalCents')).toBe(56500);
    expect(sum(rows, 'stripeFeeCents')).toBe(2019);
    expect(rows.filter((part: any) => part.componentKey === 'kitchen').map((part: any) => part.subtotalCents)).toEqual([18000, 18000, 18000]);
  });

  it('does not refund an earlier removed item twice; re-adding it charges current list cents', async () => {
    await seed({ mixerOnMon: 'removed' });
    await h.db.update(s.equipmentListings).set({ sessionRate: '4000' });
    const { quote } = await request(days(full(MON, [7]), full(WED), full(FRI)));
    expect(quote.money).toMatchObject({ oldTotalCents: 65880, newTotalCents: 70760, payCents: 4880 });
    expect(quote.money.datedDays[0].equipment[0].cents).toBe(4000);
    expect((await decide('approve')).state).toBe('applied');
    const extra = (await get(s.paymentTransactions)).find((row: any) => row.id !== 1);
    expect(extra.metadata.dayComponents.map((part: any) => part.subtotalCents)).toEqual([0, 4000, 0, 0]);
    expect(h.refunds).toHaveLength(1);
    const settled = live(await get(s.kitchenBookingDayAllocations)).find((part: any) => part.componentKey === 'equipment:1');
    expect(settled.evidence.refunds).toHaveLength(1);
    expect(dayEntitlement([settled])).toBe(0);
  });

  it('refuses kept parts with a partial refund or extra kitchen debit', async () => {
    const [part] = await get(s.kitchenBookingDayAllocations);
    for (const extra of [{ refunds: [{ customerCents: 100, kitchenCents: 100 }] }, { managerDebitedCents: 100 }]) {
      await h.db.update(s.kitchenBookingDayAllocations).set({ evidence: { ...part.evidence, ...extra } }).where(eq(s.kitchenBookingDayAllocations.id, part.id));
      await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(WED), full(FRI), full(SAT)) }, NOW))
        .rejects.toMatchObject({ code: 'datedChangeSupport' });
    }
  });

  it('does not resurrect a CP6 dropped day at its historical rate', async () => {
    const { cancelDatedDays } = await import('./dated-booking-cancellation');
    const quote = await readDatedCancellationQuote(1, chef, { visitIds: [3] }, NOW);
    await cancelDatedDays(1, chef, { target: { visitIds: [3] }, expectedRefundCents: quote.chefRefundCents, operationKey: crypto.randomUUID() });
    expect((await get(s.paymentTransactions))[0].metadata.cancellationRefundOperation.error).toBeFalsy();
    expect((await get(s.paymentTransactions))[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded' });
    await h.db.update(s.kitchens).set({ dailyRate: '20000' });
    const next = await detailedPreview(days(full(MON), full(WED), full(FRI)));
    expect(next.money.datedDays.map((day: any) => day.kitchenCents)).toEqual([18000, 18000, 20000]);
    expect(next.money.oldTotalCents).toBe(43920);
    expect(next.money.payCents).toBe(24400);
    const dropped = (await get(s.kitchenBookingDayAllocations)).find((part: any) => part.visitId === 3);
    await request(days(full(MON), full(WED), full(FRI)));
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(2);
    expect((await get(s.kitchenBookingDayAllocations)).find((part: any) => part.id === dropped.id)).toEqual(dropped);
    const active = (await get(s.kitchenBookingVisits)).filter((visit: any) => visit.scheduleState === 'active');
    const all = live(await get(s.kitchenBookingDayAllocations));
    expect(active.map((visit: any) => sum(all.filter((part: any) => part.visitId === visit.id), 'subtotalCents'))).toEqual([18000, 18000, 20000]);
  });

  it('moves two sources conservatively on a second change; CP5 replay never restores an old manifest', async () => {
    await request(days(full(MON), full(WED, [7]), full(FRI)));
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(2);
    const before = live(await get(s.kitchenBookingDayAllocations));
    expect(before.filter((part: any) => part.sourceId === 2 && part.subtotalCents > 0)).toHaveLength(1);
    await h.db.update(s.kitchens).set({ dailyRate: '20000' });
    const { quote } = await request(days(full(MON), full(WED, [7]), full(FRI), full(SAT)));
    expect(quote.money).toMatchObject({ oldTotalCents: 68930, payCents: 24400 });
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(3);
    const moved = live(await get(s.kitchenBookingDayAllocations));
    await syncDayPayoutSource(2);
    expect(live(await get(s.kitchenBookingDayAllocations))).toEqual(moved);
    for (const source of await get(s.paymentTransactions)) {
      const parts = moved.filter((part: any) => part.sourceId === source.id);
      expect(sum(parts, 'subtotalCents') + sum(parts, 'taxCents') + sum(parts, 'serviceFeeCents')).toBe(Number(source.amount));
      expect(sum(parts, 'stripeFeeCents')).toBe(Number(source.stripeProcessingFee));
    }
    // M2: source conservation and exact destination component cents must both hold.
    const current = (await get(s.kitchenBookingVisits)).filter((visit: any) => visit.scheduleState === 'active');
    const kitchenByDay = current.map((visit: any) => sum(moved.filter((part: any) => part.visitId === visit.id && part.componentKey === 'kitchen'), 'subtotalCents'));
    expect(kitchenByDay.slice(0, 3)).toEqual([18000, 18000, 18000]);
    expect(kitchenByDay[3]).toBe(20000);
    const { allocateDatedCapture } = await import('./dated-booking-quote');
    const expected = allocateDatedCapture(quote.money.datedDays.flatMap((day: any, i: number) => [
      { visitId: current[i].id, sessionIndex: i, componentKey: 'kitchen', kind: 'kitchen' as const, bookingId: 1, subtotalCents: day.kitchenCents },
      ...day.equipment.map((item: any) => ({ visitId: current[i].id, sessionIndex: i, componentKey: 'equipment', kind: 'equipment' as const, bookingId: 1, subtotalCents: item.cents }))]),
      { taxCents: quote.money.newTerms.taxCents, serviceFeeCents: quote.money.newTerms.feeCents, totalCents: quote.money.newTotalCents } as any, null);
    for (const part of expected) {
      const actual = moved.filter((row: any) => row.visitId === part.visitId && (part.kind === 'kitchen' ? row.componentKey === 'kitchen' : row.componentKey.startsWith('equipment:')));
      expect(['subtotalCents', 'taxCents', 'serviceFeeCents'].map(key => sum(actual, key))).toEqual([part.subtotalCents, part.taxCents, part.serviceFeeCents]);
    }
    expect(moved.filter((part: any) => part.sourceId === 2 && part.subtotalCents > 0)).toHaveLength(1);
    expect(quote.money.datedDays.slice(0, 3).map((day: any) => day.kitchenCents)).toEqual([18000, 18000, 18000]);
    const next = await detailedPreview(days(full(MON), full(WED, [7]), full(FRI), full(SAT), full('2099-11-08')));
    expect(next.money.datedDays.slice(0, 3).map((day: any) => day.kitchenCents)).toEqual([18000, 18000, 18000]);
    await expect(readDatedCancellationQuote(1, chef, { visitIds: [8] }, NOW)).rejects.toThrow(/separate change payment|Local Cooks/);
  });

  it('fills shared residual budgets exactly when two sources move to entirely different days', async () => {
    await request(days(full(MON), full(WED, [7]), full(FRI)));
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(2);
    const { quote } = await request(days(full(TUE), full(THU), full(SAT), hourly('2099-11-08', 9, 13)));
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(3);
    const parts = live(await get(s.kitchenBookingDayAllocations));
    const visits = (await get(s.kitchenBookingVisits)).filter((visit: any) => visit.scheduleState === 'active');
    expect(visits.map((visit: any) => sum(parts.filter((part: any) => part.visitId === visit.id), 'subtotalCents'))).toEqual([18000, 18000, 18000, 9000]);
    expect(visits.map((visit: any) => sum(parts.filter((part: any) => part.visitId === visit.id), 'taxCents'))).toEqual([2700, 2700, 2700, 1350]);
    expect(visits.map((visit: any) => sum(parts.filter((part: any) => part.visitId === visit.id), 'serviceFeeCents'))).toEqual([1260, 1260, 1260, 630]);
    for (const source of await get(s.paymentTransactions)) {
      const moved = parts.filter((part: any) => part.sourceId === source.id);
      expect(sum(moved, 'subtotalCents') + sum(moved, 'taxCents') + sum(moved, 'serviceFeeCents')).toBe(Number(source.amount));
      expect(sum(moved, 'stripeFeeCents')).toBe(Number(source.stripeProcessingFee));
    }
    expect(quote.money.newTerms).toEqual({ kitchenCents: 63000, taxCents: 9450, feeCents: 4410 });
  });

  it('uses the quote component order for a new charge when kitchen and equipment tax remainders tie', async () => {
    await h.db.update(s.kitchens).set({ dailyRate: '3003' });
    await h.db.update(s.equipmentListings).set({ sessionRate: '3003' });
    const { quote } = await request(days(full(MON), full(WED), full(FRI), full(SAT, [7])));
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(2);
    const parts = live(await get(s.kitchenBookingDayAllocations));
    const visit = (await get(s.kitchenBookingVisits)).find((visit: any) => visit.scheduleState === 'active' && visit.visitDate === SAT);
    expect(quote.money.newTerms).toEqual({ kitchenCents: 60006, taxCents: 9001, feeCents: 4200 });
    expect(sum(parts.filter((part: any) => part.visitId === visit.id && part.componentKey === 'kitchen'), 'taxCents')).toBe(451);
    expect(sum(parts.filter((part: any) => part.visitId === visit.id && part.componentKey.startsWith('equipment:')), 'taxCents')).toBe(450);
    await syncDayPayoutSource(2);
    expect(live(await get(s.kitchenBookingDayAllocations))).toEqual(parts);
  });

  it('M1: a tax change preserves quoted kept subtotals after a price-down apply', async () => {
    await h.db.update(s.kitchens).set({ taxRatePercent: '10' });
    const { quote } = await request(days(full(MON), full(WED)));
    expect(quote.money.newTerms).toMatchObject({ kitchenCents: 36000, taxCents: 3600, feeCents: 2520 });
    expect((await decide('approve')).state).toBe('applied');
    const kept = live(await get(s.kitchenBookingDayAllocations)).filter((part: any) => part.componentKey === 'kitchen');
    expect(sum(kept, 'subtotalCents')).toBe(36000);
    expect(sum(kept, 'taxCents')).toBe(3600);
    expect(sum(kept, 'serviceFeeCents')).toBe(2520);
    expect((await change()).policy.refundSources[0].datedReduction).toEqual({ subtotalCents: 18000, taxCents: 4500, serviceFeeCents: 1260 });
    const again = await detailedPreview(days(full(MON), full(WED), full(FRI)));
    expect(again.money.datedDays.slice(0, 2).map((day: any) => day.kitchenCents)).toEqual([18000, 18000]);
  });

  it('M1 rounding: unchanged tax settings preserve exact subtotal and tax cents', async () => {
    const [first] = await get(s.kitchenBookingDayAllocations);
    // Valid offered subtotal split: 54001 -> 18001,18000,18000, tax round(54001*.15)=8100.
    await h.db.update(s.kitchenBookingDayAllocations).set({ subtotalCents: 18001 }).where(eq(s.kitchenBookingDayAllocations.id, first.id));
    await h.db.update(s.paymentTransactions).set({ amount: '65881', baseAmount: '62101', managerRevenue: '60160', netAmount: '65881' });
    await h.db.update(s.kitchenBookings).set({ totalPrice: '54001' });
    await h.db.update(s.equipmentListings).set({ sessionRate: '9' });
    const { quote } = await request(days(full(MON, [7]), full(WED)));
    expect(quote.money.newTerms).toEqual({ kitchenCents: 36010, taxCents: 5402, feeCents: 2521 });
    expect((await decide('approve')).state).toBe('applied');
    const parts = live(await get(s.kitchenBookingDayAllocations)).filter((part: any) => !part.componentKey.startsWith('change-refund:'));
    expect([sum(parts, 'subtotalCents'), sum(parts, 'taxCents'), sum(parts, 'serviceFeeCents')]).toEqual([36010, 5402, 2521]);
    expect(parts.filter((part: any) => part.componentKey === 'kitchen').map((part: any) => part.subtotalCents)).toEqual([18001, 18000]);
  });

  it('refuses an exact refund split that the selected source cannot fund before provider money', async () => {
    await request(days(full(MON), full(WED, [7]), full(FRI)));
    expect((await decide('approve')).state).toBe('applied');
    await syncDayPayoutSource(2);
    await h.db.update(s.kitchens).set({ taxRatePercent: '10' });
    // Only tax falls; the newest source cannot fund the whole reduction from its tax column.
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(WED, [7]), full(FRI), hourly(SAT, 9, 10)) }, NOW))
      .rejects.toMatchObject({ code: 'pricingReview' });
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON, [7]), full(WED), full(FRI)) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
    expect(h.refundCalls).toHaveLength(0);
    expect(h.captures).toBe(1);
  });

  it.each(['charge', 'refund'])('refuses a broken saved component budget before %s money moves', async mode => {
    await request(mode === 'charge' ? days(full(MON), full(WED), full(FRI), full(SAT)) : days(full(MON), full(WED)));
    const saved = await change();
    saved.quote.datedDays[0].kitchenCents++;
    await h.db.update(s.kitchenBookingChanges).set({ quote: saved.quote });
    await expect(decide('approve')).rejects.toMatchObject({ code: 'datedChangeSupport' });
    expect(h.captures).toBe(0);
    expect(h.refundCalls).toHaveLength(0);
  });

  it('refuses missing frozen refund reductions before approval', async () => {
    await request(days(full(MON), full(WED)));
    const saved = await change();
    expect(saved.policy.refundSources[0].datedReduction).toEqual({ subtotalCents: 18000, taxCents: 2700, serviceFeeCents: 1260 });
    delete saved.policy.refundSources[0].datedReduction;
    await h.db.update(s.kitchenBookingChanges).set({ policy: saved.policy });
    await expect(decide('approve')).rejects.toMatchObject({ code: 'datedChangeSupport' });
    expect(h.refundCalls).toHaveLength(0);
  });

  it('refuses a real CP6 extra refund on a kept day', async () => {
    const { refundDatedDay } = await import('./dated-booking-cancellation');
    await refundDatedDay(1, manager.id, { visitId: 2, amountCents: 1000, operationKey: crypto.randomUUID() });
    expect((await get(s.paymentTransactions))[0].metadata.cancellationRefundOperation.error).toBeFalsy();
    expect((await get(s.paymentTransactions))[0].metadata.cancellationRefundOperation).toMatchObject({ status: 'succeeded' });
    const part = (await get(s.kitchenBookingDayAllocations)).find((part: any) => part.visitId === 2);
    expect(part.evidence.managerDebitedCents).toBe(1000);
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(WED), full(FRI), full(SAT)) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
  });

  it('preserves non-divisible invited hourly cents without multiplying a rounded display rate into money', async () => {
    await h.db.update(s.kitchenBookingVisits).set({ pricingMode: 'hourly', selectedSlots: hours(9, 16), endTime: '16:00' }).where(eq(s.kitchenBookingVisits.id, 1));
    await h.db.update(s.kitchens).set({ hourlyRate: '3000' });
    const { quote } = await request(days(hourly(MON, 9, 16), full(WED), full(FRI), full(SAT)));
    expect(quote.money.datedDays[0]).toMatchObject({ rateCents: 2571, kitchenCents: 18000 });
    expect(2571 * 7).toBe(17997);
    expect((await decide('approve')).state).toBe('applied');
    const kept = live(await get(s.kitchenBookingDayAllocations)).filter((part: any) => part.componentKey === 'kitchen');
    expect(kept[0].subtotalCents).toBe(18000);
  });

  it('S1: removing the current daily offering still preserves already-paid daily days', async () => {
    await h.db.update(s.kitchens).set({ dailyRate: '0' });
    // The only new day is hourly; every daily day is already paid and unchanged.
    const { quote } = await request(days(full(MON), full(WED), full(FRI), hourly(SAT, 9, 13)));
    expect(quote.money.datedDays.map((day: any) => day.kitchenCents)).toEqual([18000, 18000, 18000, 9000]);
    expect(quote.money.payCents).toBe(10980);
    expect((await decide('approve')).state).toBe('applied');
    expect(h.captures).toBe(1);
  });

  it('sorts reordered destination days before pricing/hash; adding the same item is the same quote', async () => {
    await h.db.update(s.kitchens).set({ dailyRate: '20000' });
    const ordered = await detailedPreview(days(full(MON, [7]), full(WED), full(FRI)));
    const shuffled = await detailedPreview(days(full(FRI), full(MON, [7]), full(WED)));
    expect(shuffled.quoteHash).toBe(ordered.quoteHash);
    expect(shuffled.money).toEqual(ordered.money);
    expect(shuffled.money.datedDays.map((day: any) => day.kitchenCents)).toEqual([18000, 18000, 18000]);
  });

  it('refuses an unallocated outside refund and a nonrefundable supplemental extension source', async () => {
    await h.db.update(s.paymentTransactions).set({ refundAmount: '1000', status: 'partially_refunded' });
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(WED), full(FRI), full(SAT)) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
    await h.db.update(s.paymentTransactions).set({ refundAmount: '0', status: 'succeeded' });
    const [extra] = await h.db.insert(s.paymentTransactions).values({ bookingId: 1, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '3050',
      baseAmount: '2875', taxAmount: '375', serviceFee: '175', stripeProcessingFee: '100', managerRevenue: '2775', netAmount: '3050', currency: 'cad',
      status: 'succeeded', paymentIntentId: 'pi_extension_review', chargeId: 'ch_extension_review', payoutPartition: 'per_day',
      metadata: { sessionExtensionId: 99, nonRefundable: true } }).returning();
    await h.db.insert(s.kitchenBookingDayAllocations).values({ sourceId: extra.id, visitId: 2, componentKey: 'extension:99', subtotalCents: 2500,
      taxCents: 375, serviceFeeCents: 175, stripeFeeCents: 100, evidence: { kind: 'kitchen', feeStatus: 'verified' } });
    await expect(engine.previewKitchenChange(1, chef, { destination: days(full(MON), full(WED), full(FRI), full(SAT)) }, NOW))
      .rejects.toMatchObject({ code: 'datedChangeSupport' });
    expect(h.captures).toBe(0);
  });

  it('uses display fallback for a pending dated source with zero day rows, without releasing booking-level money', async () => {
    const { readKitchenPayout, releaseKitchenPayout, recoverCaptureTransfer } = await import('./kitchen-payout-service');
    await h.db.delete(s.kitchenBookingDayPayouts);
    await h.db.delete(s.kitchenBookingDayAllocations);
    await h.db.update(s.kitchenBookings).set({ status: 'pending', paymentStatus: 'authorized' });
    await h.db.update(s.paymentTransactions).set({ status: 'authorized', stripeProcessingFee: '0', managerRevenue: '62100' });
    expect(await readKitchenPayout(1)).toMatchObject({ status: 'scheduled', amountCents: 62100 });
    const before = await get(s.paymentTransactions);
    await releaseKitchenPayout(1, 'independent_review', NOW);
    expect(await get(s.paymentTransactions)).toEqual(before);
    expect(await recoverCaptureTransfer(before[0])).toBe('skipped');
    expect(await get(s.kitchenBookingDayPayouts)).toEqual([]);
  });

  it('chef day-money projection contains only chef cents and visit ids after stripping the kitchen share', async () => {
    const { readBookingDayMoney } = await import('./booking-day-money');
    const money = await readBookingDayMoney(1);
    expect(money[0].kitchenRemainingCents).toBe(20053);
    // Exact projection used by /chef/bookings/:id/details; route authorization is reviewed in source.
    const chefMoney = money.map(({ kitchenRemainingCents: _private, ...day }) => day);
    expect(chefMoney).toEqual([1, 2, 3].map(visitId => ({ visitId, allocatedCents: 21960, refundedCents: 0 })));
    expect(JSON.stringify(chefMoney)).not.toMatch(/20053|stripe|sourceId|manager|kitchenRemaining/);
  });

  it('pending reminder and confirmed reminder clocks use the frozen first day/explicit visits without changing money', async () => {
    const { currentManagerDecisionReminders } = await import('./manager-decision-reminders');
    const { bookingFirstStart, firstBookingVisitStart } = await import('@shared/booking-response-deadline');
    const actual = await vi.importActual<typeof import('./advance-reminders')>('./advance-reminders');
    await h.db.update(s.kitchenBookings).set({ status: 'pending', paymentStatus: 'authorized', createdAt: NOW, visitDuties: null });
    const pending = await booking();
    expect(() => firstBookingVisitStart(pending, 'UTC')).toThrow(/schedule is missing/);
    expect(bookingFirstStart(pending, 'UTC').toISOString()).toBe(at9(MON));
    const money = await get(s.paymentTransactions);
    const reminders = await currentManagerDecisionReminders(h.db, 1, NOW);
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.every(reminder => reminder.start === at9(MON))).toBe(true);
    expect(actual.reminderVisitTimes(pending, 'UTC', await get(s.kitchenBookingVisits)).map(visit => visit.start.toISOString()))
      .toEqual([MON, WED, FRI].map(at9));
    expect(await get(s.paymentTransactions)).toEqual(money);
    expect(h.captures).toBe(0);
  });
});

async function extensionSchedule() {
  await h.db.update(s.kitchenBookings).set({ visitDuties: null, extraTimeRateCents: 2500, durationHours: '21',
    startTime: '10:00', endTime: '17:00', operatingWindowStartTime: '08:00',
    selectedSlots: [MON, WED, FRI].flatMap(date => hours(10, 17).map(slot => ({ ...slot, date, windowStartTime: '08:00' }))) });
  await h.db.update(s.kitchenBookingVisits).set({ startTime: '10:00', operatingWindowStartTime: '08:00', selectedSlots: hours(10, 17) });
  await h.db.update(s.kitchens).set({ hourlyRate: '9000', extraTimeRateCents: 9000 });
  await h.db.insert(s.kitchenAvailability).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({ kitchenId: 4, dayOfWeek, isAvailable: true, startTime: '08:00', endTime: '20:00' })));
}

describe('Oct 18 session selection: reads choose a day; every write stays on that visit', () => {
  it('chooses day 2 in session, prices from the snapshot, rejects implicit/stale writes, and stores an explicit offer', async () => {
    await extensionSchedule();
    const { readSessionExtensions, createSessionExtension } = await import('./session-extensions');
    const now = new Date(`${WED}T16:30:00Z`);
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_in', checkedInAt: new Date(`${WED}T10:05:00Z`) }).where(eq(s.kitchenBookingVisits.id, 2));
    const view = await readSessionExtensions(1, manager, undefined, now);
    expect(view).toMatchObject({ visitId: 2, inSession: true, unavailableReason: null });
    expect(view.options.find(option => option.minutes === 60)).toMatchObject({ amountCents: 3050, subtotalCents: 2500 });
    const input = { kind: 'offer' as const, minutes: 60, expectedEndAt: view.endAt!, expectedAmountCents: 3050, requestKey: crypto.randomUUID() };
    await expect(createSessionExtension(stripe, 1, manager, input, now)).rejects.toThrow('Choose a dated visit');
    await expect(createSessionExtension(stripe, 1, manager, { ...input, visitId: 1 }, now)).rejects.toThrow(/time changed/);
    const offered = await createSessionExtension(stripe, 1, manager, { ...input, visitId: view.visitId! }, now);
    expect(offered.extension).toMatchObject({ visitId: 2, amountCents: 3050, status: 'offered' });
    expect((await get(s.kitchenBookingExtensions)).map((row: any) => row.visitId)).toEqual([2]);
    expect(h.captures).toBe(0);
  });

  it('finds day 2 before arrival and anchors the paid early-start offer to that visit', async () => {
    await extensionSchedule();
    const { readSessionExtensions, createSessionExtension } = await import('./session-extensions');
    const now = new Date(`${WED}T09:15:00Z`);
    const view = await readSessionExtensions(1, manager, undefined, now);
    expect(view).toMatchObject({ visitId: 2, beforeStart: true, unavailableReason: null });
    expect(view.earlyOptions.find(option => option.minutes === 30)).toMatchObject({ amountCents: 1526, subtotalCents: 1250 });
    const result = await createSessionExtension(stripe, 1, manager, { kind: 'early_start', minutes: 30, visitId: view.visitId!,
      expectedEndAt: view.startAt!, expectedAmountCents: 1526, requestKey: crypto.randomUUID() }, now);
    expect(result.extension).toMatchObject({ visitId: 2, kind: 'early_start', status: 'offered', amountCents: 1526 });
  });

  it('finds day 2 overstay, charges only its recorded elapsed time, and cannot bill the same day twice', async () => {
    await extensionSchedule();
    const { readSessionExtensions, createSessionExtension } = await import('./session-extensions');
    const now = new Date(`${WED}T18:00:00Z`);
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_out', checkedInAt: new Date(`${WED}T10:05:00Z`),
      checkoutRequestedAt: new Date(`${WED}T17:40:00Z`), checkedOutAt: new Date(`${WED}T17:40:00Z`) }).where(eq(s.kitchenBookingVisits.id, 2));
    const view = await readSessionExtensions(1, manager, undefined, now);
    expect(view).toMatchObject({ visitId: 2, extraTime: { actualMinutes: 40, minutes: 60, amountCents: 3050 } });
    const input = { kind: 'extra_time' as const, amountCents: 3050, note: 'Recorded late departure', visitId: view.visitId!, expectedEndAt: view.endAt!,
      expectedAmountCents: 3050, requestKey: crypto.randomUUID() };
    expect((await createSessionExtension(stripe, 1, manager, input, now)).extension).toMatchObject({ visitId: 2, amountCents: 3050, kind: 'extra_time' });
    await expect(createSessionExtension(stripe, 1, manager, { ...input, requestKey: crypto.randomUUID() }, now)).rejects.toThrow(/already sent/);
  });
});

describe('Oct 18 dated checkout customer: real fulfillment and invitation acceptance, fake provider', () => {
  it.each([false, true])('persists customer/payment method and replays without another booking or capture (invitation=%s)', async invited => {
    const { priceBookingDays, datedManifestHash } = await import('./dated-booking-quote');
    const { createDatedKitchenCheckoutSession } = await import('./stripe-checkout-service');
    const { fulfillDatedKitchenBooking } = await import('./dated-booking-fulfillment');
    const priced = priceBookingDays([TUE, THU, SAT].map(date => ({ date, pricingMode: 'daily', slots: slots8, startTime: '09:00', endTime: '17:00',
      windowStartTime: '09:00', equipmentIds: [7] })), { hourlyRate: 2250, dailyRate: 18000 }, await get(s.equipmentListings));
    const head = `review-checkout-${invited}`;
    const manifest: any = { contract: 'kitchen-days-v1', headId: head, chefId: 3, kitchenId: 4, managerId: 2, destination: 'acct_days', timezone: 'UTC',
      bufferMinutes: 0, createdAt: NOW.toISOString(), checkoutExpiresAt: Math.floor(NOW.getTime() / 1000) + 1800, days: priced,
      subtotalCents: 61500, taxCents: 9225, serviceFeeCents: 4305, totalCents: 75030, taxRatePercent: 15, serviceFeeRate: .07,
      policy: { ...snapshot, sessions: [TUE, THU, SAT].map(date => ({ startAt: at9(date) })) }, specialNotes: null,
      ...(invited ? { invitation: { id: 'review-invite', version: 1, listKitchenCents: 60000, offeredKitchenCents: 54000,
        days: [TUE, THU, SAT].map(date => ({ date, listKitchenCents: 20000, offeredKitchenCents: 18000 })) } } : {}) };
    const quote = { manifest, hash: datedManifestHash(manifest) };
    const invitation = invited ? { id: 'review-invite', version: 1, listSubtotalCents: 60000, offeredSubtotalCents: 54000 } : undefined;
    if (invited) await h.db.insert(s.kitchenInvitations).values({ ...invitation, requestKey: 'review-invite-key', kitchenId: 4, locationId: 9, managerId: 2, chefId: 3,
      status: 'accepted_pending_payment', date: TUE, startTime: '09:00', endTime: '17:00', operatingWindowStartTime: '09:00', timezone: 'UTC', pricingMode: 'daily',
      selectedSlots: slots8, daysSnapshot: priced, taxCents: 9225, serviceFeeCents: 4305, totalCents: 75030, managerEstimatedPayoutCents: 70000,
      cancellationPolicyHours: 24, cancellationChargePercent: 50, expiresInHours: 24, expiresAt: new Date(NOW.getTime() + 86400_000) });
    await h.db.insert(s.kitchenCheckoutHolds).values(priced.map((day, i) => ({ id: i ? `${head}:${day.date}` : head, groupId: head, kitchenId: 4, chefId: 3,
      operatingDate: day.date, windowStartTime: '09:00', selectedSlots: slots8, bufferMinutesSnapshot: 0, expiresAt: new Date(NOW.getTime() + 1800_000),
      quoteSnapshot: i ? null : quote })));
    const create = vi.fn(async (params: any, options: any) => {
      expect(params).toMatchObject({ customer_creation: 'always', payment_intent_data: { capture_method: 'manual', setup_future_usage: 'off_session' } });
      expect(params.payment_intent_data).not.toHaveProperty('transfer_data');
      expect(params.payment_intent_data).not.toHaveProperty('application_fee_amount');
      const previous = h.sessions.find(row => row.key === options.idempotencyKey);
      if (previous) return previous;
      const intent = { id: 'pi_review_checkout', status: 'requires_capture', capture_method: 'manual', amount: 75030, amount_capturable: 75030,
        amount_received: 0, currency: 'cad', customer: invited ? { id: 'cus_review' } : 'cus_review', payment_method: invited ? { id: 'pm_review' } : 'pm_review',
        metadata: params.payment_intent_data.metadata, latest_charge: null };
      h.intents.set(intent.id, intent);
      const session = { id: 'cs_review', key: options.idempotencyKey, url: 'https://checkout.test.invalid', status: 'complete', mode: 'payment', currency: 'cad',
        amount_total: 75030, payment_intent: intent.id, metadata: params.metadata };
      h.sessions.push(session); return session;
    });
    const provider: any = { checkout: { sessions: { create } } };
    const params = { quote, invitation, customerEmail: 'chef@test.invalid', successUrl: 'https://test.invalid/success', cancelUrl: 'https://test.invalid/cancel' };
    expect(await createDatedKitchenCheckoutSession(params, provider)).toEqual(await createDatedKitchenCheckoutSession(params, provider));
    expect(h.sessions).toHaveLength(1);
    const session = h.sessions[0], intent = h.intents.get(session.payment_intent);
    const id = await fulfillDatedKitchenBooking(session, intent, provider);
    const saved = (await get(s.kitchenBookings)).find((row: any) => row.id === id);
    expect(saved).toMatchObject({ stripeCustomerId: 'cus_review', stripePaymentMethodId: 'pm_review', paymentStatus: invited ? 'paid' : 'authorized' });
    const count = (await get(s.paymentTransactions)).length;
    expect(await fulfillDatedKitchenBooking(session, h.intents.get(intent.id), provider)).toBe(id);
    expect((await get(s.paymentTransactions)).length).toBe(count);
    expect(h.captures).toBe(invited ? 1 : 0);
    if (invited) {
      expect((await get(s.kitchenInvitations))[0]).toMatchObject({ status: 'accepted', bookingId: id });
      // The checkout's offered kitchen and equipment cents remain frozen after the listing rises.
      await h.db.update(s.kitchens).set({ dailyRate: '30000' });
      await h.db.update(s.equipmentListings).set({ sessionRate: '6000' });
      const next = await detailedPreview(days(full(TUE, [7]), full(THU, [7]), full(SAT, [7]), full('2099-11-08')), id);
      expect(next.money.datedDays.map((day: any) => [day.kitchenCents, day.equipment.map((item: any) => item.cents)]))
        .toEqual([[18000, [2500]], [18000, [2500]], [18000, [2500]], [30000, []]]);
    }
  });
});
