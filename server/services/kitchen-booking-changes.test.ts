/**
 * Chef changes a confirmed booking: request -> kitchen decision -> apply -> money.
 * Runs the real engine against a real in-process Postgres (PGlite) built from the Drizzle schema, so transactions, row locks,
 * savepoints and unique indexes are real. Only the outside world is replaced: Stripe, the outbox's delivery, availability,
 * reminders, closeout persistence, payout scheduling, documents and the Inngest timer.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

const h = vi.hoisted(() => ({
  db: null as any, txDepth: 0, afterFacts: null as null | ((facts: any) => Promise<void>), provider: null as any, beforeRefund: null as null | (() => Promise<void>), checkoutByKey: new Map<string, any>(),
  frozen: false, unavailable: false,
  intents: new Map<string, any>(), sessions: new Map<string, any>(), refunds: [] as any[],
  declineCard: false, failCapture: false, failRefund: false, refundStatus: 'succeeded', nextIntent: 1,
  calls: { create: 0, capture: 0, cancel: 0, refund: 0, availability: [] as any[], timers: [] as any[], reminders: [] as any[], closeout: [] as number[],
    payout: [] as number[], documents: [] as string[], changePayout: [] as number[], revoked: [] as number[], reconcile: [] as string[], refundOptions: [] as any[], checkout: [] as any[] },
}));

// No test can construct a network-capable Stripe client, even if the developer has a key configured.
vi.mock('stripe', () => ({ default: class {
  static createFetchHttpClient() { return {}; }
  constructor() { return new Proxy({}, { get: (_target, key) => h.provider[key] }); }
} }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => { const value = h.db[key]; return typeof value === 'function' ? value.bind(h.db) : value; } }), pool: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://app.test' }));
// A name lookup must never share (or poison) the change's own transaction, so the notice reads it on its own connection.
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Ana' }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./visit-code-challenge', () => ({ revokeForBooking: async (_tx: any, bookingId: number) => { h.calls.revoked.push(bookingId); } }));
vi.mock('./booking-money-guard', async () => {
  const real = await vi.importActual<typeof import('./booking-money-guard')>('./booking-money-guard');
  return { ...real, assertBookingMoneyWritable: async () => { if (h.frozen) throw new real.BookingMoneyFrozen(); } };
});
vi.mock('./booking-lifecycle-delivery', async () => {
  const { bookingLifecycleEvents } = await import('@shared/schema');
  return { queueBookingLifecycleEvent: async (tx: any, bookingId: number, kind: string, title: string, message: string, actorId: number | undefined, metadata: any) => {
    const audience = metadata?.recipientPolicy;
    await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, title, message, actorId: actorId ?? null, metadata: metadata ?? {},
      emails: metadata?.emailRecipientPolicy === 'none' ? [] : [{ to: `${audience}@example.test`, locale: 'en-CA', recipientName: audience, facts: [] }] });
  } };
});
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: { validateBookingAvailability: vi.fn(async (...args: any[]) => {
  h.calls.availability.push(args);
  const options = args[4];
  return h.unavailable ? { valid: false, error: 'That time is no longer available. Pick another.' } : { valid: true, slots: options.selectedSlots, windowStartTime: '08:00' };
}) } }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: vi.fn(async (kitchenCents: number) => ({ platformCommissionInCents: Math.round(kitchenCents * 0.05) })) }));
vi.mock('./clock-closeout', () => ({
  closeoutTiming: async () => ({ serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }),
  projectBookingCloseouts: async (items: any[]) => items,
  persistBookingCloseout: async (bookingId: number) => { h.calls.closeout.push(bookingId); return { changed: true }; },
}));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: async (_tx: any, source: string, id: number) => { h.calls.reminders.push([source, id]); } }));
vi.mock('./kitchen-payout-service', () => ({ scheduleKitchenPayout: async (id: number) => { h.calls.payout.push(id); } }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: (kind: string, id: number, dueAt: Date | null) => { h.calls.timers.push({ kind, id, dueAt }); } }));
vi.mock('./booking-documents', async importOriginal => ({ ...(await importOriginal<typeof import('./booking-documents')>()),
  issueBookingDocumentsSafely: async (id: number, reason: string) => { h.calls.documents.push(`${id}:${reason}`); } }));
vi.mock('./kitchen-change-payout', () => ({ releaseKitchenChangePayoutForSource: async (id: number) => { h.calls.changePayout.push(id); return { success: true }; },
  sweepKitchenChangePayouts: async () => ({ checked: 0, sent: 0 }) }));
vi.mock('./stripe-service', () => ({
  // Reversal receipts (read before the reconciliation lock): none recovered in these flows; never called inside a transaction.
  getCancellationReversalEvidence: async () => { expect(h.txDepth).toBe(0); return []; },
  getCancellationPaymentFacts: async (intentId: string) => {
    expect(h.txDepth).toBe(0);
    const [source] = await h.db.select().from((await import('@shared/schema')).paymentTransactions).where((await import('drizzle-orm')).eq((await import('@shared/schema')).paymentTransactions.paymentIntentId, intentId));
    const refunds = h.refunds.filter(r => r.intentId === intentId);
    const facts = { captured: Number(source.amount), processingCost: Number(source.stripeProcessingFee || 300), currency: 'cad', refunded: refunds.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0), refunds };
    if (h.afterFacts) await h.afterFacts(facts);
    return facts;
  },
  getStripePaymentAmounts: async () => { expect(h.txDepth).toBe(0); return { stripeProcessingFee: 300, stripeAmount: 9600, chargeId: 'ch_original' }; },
  verifyCancellationRefundFunding: async () => ({ transferId: null, available: null }),
  getPaymentIntentRefunds: async (intentId: string) => { expect(h.txDepth).toBe(0); return h.refunds.filter(r => r.intentId === intentId); },
  reverseTransferAndRefund: async (intentId: string, amount: number, _reason: string, options: any) => {
    expect(h.txDepth).toBe(0);
    if (h.beforeRefund) await h.beforeRefund();
    h.calls.refundOptions.push({ intentId, amount, ...options });
    if (h.failRefund) throw new Error('provider refused');
    let receipt = h.refunds.find(item => item.intentId === intentId && item.metadata?.refund_operation_id === options.idempotencyKey);
    if (!receipt) { receipt = { id: `re_${h.refunds.length + 1}`, intentId, amount, status: h.refundStatus, metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } }; h.refunds.push(receipt); h.calls.refund++; }
    return { refundId: receipt.id, refundAmount: receipt.amount, refundStatus: receipt.status };
  },
}));

import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { bookingLifecycleEvents, equipmentBookings, equipmentListings, kitchenBookings, kitchenBookingChanges, kitchenBookingVisits, kitchenCheckoutHolds, kitchens, locations,
  paymentHistory, paymentTransactions, storageBookings, users, kitchenViewings, bookingFlags, supportActions } from '@shared/schema';
import { policySessionStart } from './cancellation-policy-settings';
import * as engine from './kitchen-booking-changes';
import { expireKitchenChanges, KitchenChangeError, withdrawOpenKitchenChangesInTx } from './kitchen-booking-changes';
import { RESCHEDULE_MESSAGES } from '@shared/kitchen-booking-reschedule';
import { deriveBookingMoney } from './booking-documents';

const chef = { id: 3, role: 'chef' }, manager = { id: 2, role: 'manager' }, otherManager = { id: 9, role: 'manager' }, otherChef = { id: 8, role: 'chef' };
const TZ = 'America/Toronto';
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const startOf = (date: string, time = '09:00') => new Date(policySessionStart(`${date}T12:00:00.000Z`, time, '08:00', TZ));
const hour = (start: number) => ({ startTime: `${String(start).padStart(2, '0')}:00`, endTime: `${String(start + 1).padStart(2, '0')}:00` });
const dest = (date: string, from: number, count: number) => ({ date, windowStart: '08:00', slots: Array.from({ length: count }, (_, i) => hour(from + i)) });
let ORIGINAL_DATE = dayFromNow(10), NEW_DATE = dayFromNow(12);
const snapshotFor = (date: string) => ({ policyId: 1, version: 1, noticeHours: 24, lateChargePercent: 50, tiers: [], timezone: TZ,
  sessions: [{ startAt: startOf(date).toISOString(), endAt: startOf(date, '11:00').toISOString() }], disclosureVersion: 'v1', acceptedAt: new Date().toISOString() });
const uuid = () => crypto.randomUUID();

/** An in-memory Stripe with the surface the engine uses. */
function fakeStripe() {
  const intents = h.intents, sessions = h.sessions;
  const byKey = new Map<string, any>();
  return {
    paymentIntents: {
      create: async (params: any, options: any) => {
        expect(h.txDepth).toBe(0);
        if (byKey.has(options.idempotencyKey)) return byKey.get(options.idempotencyKey);
        h.calls.create++;
        const intent: any = { id: `pi_chg_${h.nextIntent++}`, amount: params.amount, currency: params.currency, customer: params.customer, payment_method: params.payment_method,
          metadata: params.metadata, capture_method: params.capture_method, status: 'requires_capture', amount_received: 0, latest_charge: 'ch_chg', client_secret: 'secret' };
        if (h.declineCard) {
          intent.status = 'requires_payment_method'; intents.set(intent.id, intent);
          throw Object.assign(new Error('Your card was declined.'), { payment_intent: intent });
        }
        intents.set(intent.id, intent); byKey.set(options.idempotencyKey, intent);
        return intent;
      },
      retrieve: async (id: string) => { expect(h.txDepth).toBe(0); return { ...intents.get(id) }; },
      capture: async (id: string) => {
        expect(h.txDepth).toBe(0);
        if (h.failCapture) throw new Error('capture failed');
        const intent = intents.get(id); if (intent.status === 'requires_capture') { h.calls.capture++; intent.status = 'succeeded'; intent.amount_received = intent.amount; } return { ...intent };
      },
      cancel: async (id: string) => { expect(h.txDepth).toBe(0); const intent = intents.get(id); if (intent.status !== 'canceled') h.calls.cancel++; intent.status = 'canceled'; return { ...intent }; },
      search: async () => ({ data: [...intents.values()] }),
    },
    checkout: { sessions: {
      create: async (params: any, options: any) => { expect(h.txDepth).toBe(0);
        if (h.checkoutByKey.has(options.idempotencyKey)) return h.checkoutByKey.get(options.idempotencyKey);
        const session: any = { id: `cs_${sessions.size + 1}`, url: 'https://checkout.test/pay', status: 'open', payment_intent: null, metadata: params.metadata, params };
        sessions.set(session.id, session); h.checkoutByKey.set(options.idempotencyKey, session); h.calls.checkout.push(params); return session; },
      list: async () => ({ data: [...sessions.values()], has_more: false }),
      retrieve: async (id: string) => ({ ...sessions.get(id) }),
      expire: async (id: string) => { const session = sessions.get(id); session.status = 'expired'; return { ...session }; },
    } },
  } as any;
}
/** The chef finishes the Checkout page with a new card. */
function payCheckout(sessionId: string) {
  const session = h.sessions.get(sessionId), params = session.params;
  // Checkout reuses the booking's customer, and saves the card that was just used.
  const intent: any = { id: `pi_chk_${h.nextIntent++}`, amount: params.line_items[0].price_data.unit_amount, currency: params.line_items[0].price_data.currency, customer: params.customer ?? 'cus_new',
    payment_method: 'pm_new', metadata: params.payment_intent_data.metadata, status: 'requires_capture', amount_received: 0, latest_charge: 'ch_chk' };
  h.intents.set(intent.id, intent); session.payment_intent = intent.id; session.status = 'complete';
  return intent;
}

let sequence = 0;
async function reset() {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_wp_rs';
  h.beforeRefund = null; h.afterFacts = null; h.checkoutByKey.clear();
  h.frozen = false; h.unavailable = false; h.declineCard = false; h.failCapture = false; h.failRefund = false; h.refundStatus = 'succeeded';
  h.intents.clear(); h.sessions.clear(); h.refunds.length = 0;
  for (const key of ['availability', 'timers', 'reminders', 'closeout', 'payout', 'documents', 'changePayout', 'revoked', 'reconcile', 'refundOptions', 'checkout'] as const) (h.calls[key] as any[]).length = 0;
  Object.assign(h.calls, { create: 0, capture: 0, cancel: 0, refund: 0 });
  await h.db.execute(sql`TRUNCATE equipment_bookings, equipment_listings, storage_bookings, booking_lifecycle_events, payment_history, payment_transactions, kitchen_booking_changes, kitchen_checkout_holds, kitchen_booking_visits,
    kitchen_bookings, kitchens, locations, users RESTART IDENTITY CASCADE`);
  await h.db.insert(users).values([{ id: 1, username: 'staff@example.test', password: 'x', role: 'admin' }, { id: 2, username: 'host@example.test', password: 'x', role: 'manager', preferredLocale: 'en-CA' },
    { id: 3, username: 'chef@example.test', password: 'x', role: 'chef', preferredLocale: 'en-CA' }, { id: 8, username: 'chef2@example.test', password: 'x', role: 'chef' },
    { id: 9, username: 'host2@example.test', password: 'x', role: 'manager' }]);
  await h.db.insert(locations).values({ id: 5, name: 'Test location', address: '1 Test St', managerId: 2, timezone: TZ });
  await h.db.insert(kitchens).values({ id: 4, name: 'Test Kitchen', locationId: 5, isActive: true, listingStatus: 'active', hourlyRate: '4000', dailyRate: '30000', taxRatePercent: '15', defaultDailyBookingLimit: 12 });
  ORIGINAL_DATE = dayFromNow(10); NEW_DATE = dayFromNow(12);
  await h.db.insert(kitchenBookings).values({ id: 10, referenceCode: 'KB-TEST10', chefId: 3, kitchenId: 4, bookingDate: new Date(`${ORIGINAL_DATE}T12:00:00Z`), startTime: '09:00', endTime: '11:00',
    operatingWindowStartTime: '08:00', pricingMode: 'hourly', selectedSlots: [hour(9), hour(10)], status: 'confirmed', totalPrice: '8000', serviceFee: '400', hourlyRate: '4000',
    durationHours: '2', paymentStatus: 'paid', paymentIntentId: 'pi_original', cancellationPolicyHours: 24, cancellationPolicySnapshot: snapshotFor(ORIGINAL_DATE),
    stripePaymentMethodId: 'pm_1', stripeCustomerId: 'cus_1', currency: 'CAD', visitDuties: { note: 'kept' } });
  // 2 hours x $40 = $80.00, 15% tax = $12.00, 5% service fee = $4.00 -> $96.00 captured; Stripe kept $3.00.
  await h.db.insert(paymentTransactions).values({ bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '9600', baseAmount: '9200', taxAmount: '1200', serviceFee: '400',
    managerRevenue: '9200', netAmount: '9600', currency: 'CAD', paymentIntentId: 'pi_original', chargeId: 'ch_original', status: 'succeeded', stripeProcessingFee: '300',
    metadata: { approvedSubtotal: 8000, approvedTax: 1200, platformCommission: 400 } });
  sequence++;
}

const requestKey = () => uuid();
async function preview(destination: any, now = new Date()) { return engine.previewKitchenChange(10, chef, { destination }, now); }
async function request(stripe: any, destination: any, now = new Date(), key = requestKey()) {
  const quote = await preview(destination, now);
  const result: any = await engine.requestKitchenChange(stripe, 10, chef, { destination, quoteHash: quote.quoteHash, requestKey: key }, now);
  return { quote, result, change: result.change ?? result };
}
const getChange = async (id?: string) => (await h.db.select().from(kitchenBookingChanges).where(id ? eq(kitchenBookingChanges.id, id) : sql`true`))[0];
const getBooking = async () => (await h.db.select().from(kitchenBookings).where(eq(kitchenBookings.id, 10)))[0];
const holds = () => h.db.select().from(kitchenCheckoutHolds);
const events = async (kind?: string) => (await h.db.select().from(bookingLifecycleEvents)).filter((event: any) => !kind || event.kind === kind);
const bookingUnchanged = async () => {
  const booking = await getBooking();
  expect(booking.bookingDate.toISOString().slice(0, 10)).toBe(ORIGINAL_DATE);
  expect([booking.startTime, booking.endTime]).toEqual(['09:00', '11:00']);
  expect(booking.selectedSlots).toEqual([hour(9), hour(10)]);
  expect((booking.cancellationPolicySnapshot as any).sessions[0].startAt).toBe(startOf(ORIGINAL_DATE).toISOString());
};
const approve = (stripe: any, change: any, now = new Date()) => engine.decideKitchenChange(stripe, 10, change.id, manager, { action: 'approve', revision: change.revision }, now);
const messageOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return (error as Error).message; } };
const codeOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return (error as KitchenChangeError).code; } };

beforeAll(async () => {
  const created = await createTestDatabase([users, locations, kitchens, kitchenBookings, kitchenBookingVisits, kitchenBookingChanges, kitchenCheckoutHolds, paymentTransactions,
    paymentHistory, bookingLifecycleEvents, equipmentBookings, equipmentListings, storageBookings, kitchenViewings, bookingFlags, supportActions,
    (await import('@shared/schema')).kitchenBookingDayPayouts, (await import('@shared/schema')).kitchenBookingDayAllocations], [
    // The same guarantees the real migration gives: one open change per booking; a request key and a provider id are used once.
    `CREATE UNIQUE INDEX one_open_change ON kitchen_booking_changes (booking_id) WHERE state IN ('requested','awaiting_payment','payment_pending','authorized','capture_pending','refund_pending','release_pending','recovery_required')`,
    `CREATE UNIQUE INDEX change_request_key ON kitchen_booking_changes (booking_id, request_key)`]);
  h.db = created.db;
  const transaction = h.db.transaction.bind(h.db);
  h.db.transaction = (work: any) => transaction(async (tx: any) => { h.txDepth++; try { return await work(tx); } finally { h.txDepth--; } });
}, 120_000);
beforeEach(async () => { await reset(); h.provider = fakeStripe(); }, 60_000);

// =====================================================================================================================
describe('eligibility and the preview', () => {
  it('a chef sees when they can change the booking and until when; the kitchen sees the deadline but cannot request', async () => {
    const read: any = await engine.readKitchenChanges(10, chef);
    expect(read.canRequest).toMatchObject({ allowed: true, until: new Date(startOf(ORIGINAL_DATE).getTime() - 24 * 3_600_000).toISOString() });
    expect(read.freeCancelUntil).toBe(read.canRequest.until);
    expect(read.timezone).toBe(TZ);
    expect(read.original).toMatchObject({ date: ORIGINAL_DATE, windowStart: '08:00' });
    expect(read.history).toEqual([]); expect(read.open).toBeUndefined();
    expect(((await engine.readKitchenChanges(10, manager)) as any).canRequest.allowed).toBe(false);
  });

  it('strangers cannot read a booking’s changes', async () => {
    await expect(engine.readKitchenChanges(10, otherChef)).rejects.toThrow('Booking not found');
    await expect(engine.readKitchenChanges(10, otherManager)).rejects.toThrow('Booking not found');
  });

  it('price up: the chef pays only the difference at the current rate, tax and fee; the time is checked against the booking itself', async () => {
    const result: any = await preview(dest(NEW_DATE, 9, 3));
    expect(result.money).toMatchObject({ oldTotalCents: 9600, newTotalCents: 14400, payCents: 4800, refundCents: 0, feeKeptCents: 0, currency: 'CAD' });
    expect(result.money.lines.map((line: any) => line.key)).toEqual(['old_total', 'new_total', 'pay']);
    expect(result.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    // 5 days before the new start... the free cancellation follows the new time.
    expect(result.freeCancelAfter).toBe(new Date(startOf(NEW_DATE).getTime() - 24 * 3_600_000).toISOString());
    expect(result.overlaps).toEqual([]);
    const [, , , , options] = h.calls.availability.at(-1);
    expect(options).toMatchObject({ excludeBookingId: 10, fullDay: false });
  });

  it('price down: refund is the difference minus the pro-rata card fee, shown as its own line', async () => {
    const result: any = await preview(dest(NEW_DATE, 9, 1));
    // 1 hour: 4000 + 600 + 200 = 4800 -> 4800 less. Stripe kept 300 of 9600, so 150 of the 4800 is not returned.
    expect(result.money).toMatchObject({ oldTotalCents: 9600, newTotalCents: 4800, payCents: 0, feeKeptCents: 150, refundCents: 4650 });
    expect(result.money.lines.map((line: any) => [line.key, line.cents])).toEqual([['old_total', 9600], ['new_total', 4800], ['difference', 4800], ['fee_kept', -150], ['refund', 4650]]);
    expect(Object.keys(result.money)).not.toContain('kitchenDebitCents');
  });

  it('same price: no money moves', async () => {
    const result: any = await preview(dest(NEW_DATE, 13, 2));
    expect(result.money).toMatchObject({ payCents: 0, refundCents: 0, feeKeptCents: 0, oldTotalCents: 9600, newTotalCents: 9600 });
    expect(result.money.lines.map((line: any) => line.key)).toEqual(['old_total', 'new_total', 'same']);
  });

  it('the kitchen’s answer window is the 24-hour cap, or one hour before the chef’s free-cancellation deadline when that comes first', async () => {
    const far: any = await preview(dest(NEW_DATE, 9, 2));
    const now = new Date();
    expect(new Date(far.decisionBy).getTime() - now.getTime()).toBeGreaterThan(23.9 * 3_600_000);
    expect(new Date(far.decisionBy).getTime() - now.getTime()).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
    // Free cancellation ends in 6h -> the kitchen has 5h.
    const sixHoursBefore = new Date(startOf(ORIGINAL_DATE).getTime() - 24 * 3_600_000 - 6 * 3_600_000);
    const near: any = await preview(dest(NEW_DATE, 9, 2), sixHoursBefore);
    expect(new Date(near.decisionBy).getTime()).toBe(sixHoursBefore.getTime() + 5 * 3_600_000);
  });

  it('refuses when fewer than 30 minutes would remain, and after the free-cancellation deadline', async () => {
    const start = startOf(ORIGINAL_DATE).getTime();
    const tooClose = new Date(start - 24 * 3_600_000 - 80 * 60_000 + 61 * 60_000); // free cancel ends in 19 minutes
    expect(await messageOf(preview(dest(NEW_DATE, 9, 2), tooClose))).toBe(RESCHEDULE_MESSAGES.tooClose);
    expect(await messageOf(preview(dest(NEW_DATE, 9, 2), new Date(start - 23 * 3_600_000)))).toBe(RESCHEDULE_MESSAGES.tooClose);
    const read: any = await engine.readKitchenChanges(10, chef, new Date(start - 23 * 3_600_000));
    expect(read.canRequest).toMatchObject({ allowed: false, reason: RESCHEDULE_MESSAGES.tooClose });
  });

  it('uses the booking’s frozen cancellation terms, not the kitchen’s current ones', async () => {
    await h.db.update(kitchenBookings).set({ cancellationPolicyHours: 72, cancellationPolicySnapshot: { ...snapshotFor(ORIGINAL_DATE), noticeHours: 72 } }).where(eq(kitchenBookings.id, 10));
    const result: any = await preview(dest(NEW_DATE, 9, 2));
    expect(result.freeCancelAfter).toBe(new Date(startOf(NEW_DATE).getTime() - 72 * 3_600_000).toISOString());
    expect((await engine.readKitchenChanges(10, chef) as any).freeCancelUntil).toBe(new Date(startOf(ORIGINAL_DATE).getTime() - 72 * 3_600_000).toISOString());
  });

  it('refuses a multi-visit booking with the contact line', async () => {
    await h.db.update(kitchenBookings).set({ selectedSlots: [hour(9), hour(14)] }).where(eq(kitchenBookings.id, 10));
    expect(await messageOf(preview(dest(NEW_DATE, 9, 2)))).toBe('To change these dates, message the kitchen or contact Local Cooks.');
    await h.db.update(kitchenBookings).set({ selectedSlots: [hour(9), hour(10)] }).where(eq(kitchenBookings.id, 10));
    await h.db.insert(kitchenBookingVisits).values({ bookingId: 10, blockIndex: 0, startTime: '09:00', endTime: '10:00' } as any).catch(() => undefined);
    const visits = await h.db.select().from(kitchenBookingVisits);
    if (visits.length) expect(await messageOf(preview(dest(NEW_DATE, 9, 2)))).toBe(RESCHEDULE_MESSAGES.contactKitchen);
  });

  it('refuses a booking that is not confirmed, has started, or has storage attached', async () => {
    await h.db.update(kitchenBookings).set({ status: 'pending' }).where(eq(kitchenBookings.id, 10));
    expect(await messageOf(preview(dest(NEW_DATE, 9, 2)))).toBe(RESCHEDULE_MESSAGES.notConfirmed);
    await h.db.update(kitchenBookings).set({ status: 'confirmed', checkinStatus: 'checked_in', checkedInAt: new Date() }).where(eq(kitchenBookings.id, 10));
    expect(await messageOf(preview(dest(NEW_DATE, 9, 2)))).toBe(RESCHEDULE_MESSAGES.started);
  });

  it('only the chef who booked can preview or request', async () => {
    await expect(engine.previewKitchenChange(10, manager, { destination: dest(NEW_DATE, 9, 2) })).rejects.toThrow('Only the chef who booked');
    await expect(engine.previewKitchenChange(10, otherChef, { destination: dest(NEW_DATE, 9, 2) })).rejects.toThrow('Booking not found');
  });
  it("a change respects the kitchen's booking length limits, like a new booking", async () => {
    await h.db.update(kitchens).set({ defaultDailyBookingLimit: 4, minimumBookingHours: 2 });
    await expect(preview(dest(NEW_DATE, 9, 6))).rejects.toThrow('Test Kitchen takes bookings of 2 to 4 hours');
    await expect(preview(dest(NEW_DATE, 9, 1))).rejects.toThrow('Test Kitchen takes bookings of 2 to 4 hours');
    await expect(preview(dest(NEW_DATE, 9, 4))).resolves.toMatchObject({ destination: { date: NEW_DATE } });
    expect((await engine.readKitchenChanges(10, chef)).limits).toEqual({ minHours: 2, maxHours: 4 });
  });

  it('a move may use only the weekly hours its original frees: the original is not counted, other reservations are', async () => {
    await h.db.update(kitchens).set({ weeklyChefHoursLimit: 3 });
    await expect(preview(dest(NEW_DATE, 9, 3))).resolves.toMatchObject({ destination: { date: NEW_DATE } });
    await h.db.insert(kitchenCheckoutHolds).values({ id: 'other-checkout', kitchenId: 4, chefId: 3, operatingDate: NEW_DATE, windowStartTime: '08:00',
      selectedSlots: [hour(14)], expiresAt: new Date(Date.now() + 60_000) });
    await expect(preview(dest(NEW_DATE, 9, 3))).rejects.toMatchObject({ code: 'WEEKLY_CHEF_HOURS_LIMIT', status: 409 });
    await expect(preview(dest(NEW_DATE, 9, 2))).resolves.toMatchObject({ destination: { date: NEW_DATE } });
  });

  it('turns an unavailable, busy or unchanged time into a plain message', async () => {
    h.unavailable = true;
    expect(await messageOf(preview(dest(NEW_DATE, 9, 2)))).toBe('That time is no longer available. Pick another.');
    h.unavailable = false;
    expect(await messageOf(preview({ date: ORIGINAL_DATE, windowStart: '08:00', slots: [hour(9), hour(10)] }))).toBe('Choose a different date or time.');
    expect(await messageOf(preview({ date: NEW_DATE, windowStart: '08:00', slots: [hour(9), hour(11)] }))).toMatch(/consecutive|back-to-back|hours/i);
  });

  it('the new start must come after the kitchen’s deadline to answer', async () => {
    // Free cancellation ends in 14h, so the kitchen has until now+13h. A new start 2h from now cannot be answered in time.
    const now = new Date(startOf(ORIGINAL_DATE).getTime() - 38 * 3_600_000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
      .formatToParts(new Date(now.getTime() + 2 * 3_600_000)).map(part => [part.type, part.value]));
    const local = { date: `${parts.year}-${parts.month}-${parts.day}`, windowStart: '00:00', slots: [hour(Number(parts.hour))] };
    expect(await messageOf(preview(local, now))).toBe('That time is too soon for the kitchen to answer in time. Pick a later start.');
  });

  it('overlapping the booking’s own current hours is allowed (10-12 after 9-11 on the same day)', async () => {
    const result: any = await preview(dest(ORIGINAL_DATE, 10, 2));
    expect(result.money.payCents).toBe(0);
    expect(result.destination.date).toBe(ORIGINAL_DATE);
  });
});

// =====================================================================================================================
describe('requesting a change and holding the time', () => {
  it('same price: sends the request, holds the new time until the kitchen must answer, schedules the exact-deadline timer, tells both sides with their own copy', async () => {
    const stripe = fakeStripe();
    const { change, quote } = await request(stripe, dest(NEW_DATE, 13, 2));
    expect(change).toMatchObject({ state: 'requested', canDecide: false, canWithdraw: true }); // the chef's view of their own request
    expect(change.decisionBy).toBe(quote.decisionBy);
    expect(h.calls.create).toBe(0);
    const [hold] = await holds();
    expect(hold).toMatchObject({ id: `kitchen-change:${change.id}`, kitchenId: 4, chefId: 3, operatingDate: NEW_DATE, windowStartTime: '08:00' });
    expect(hold.selectedSlots).toEqual(dest(NEW_DATE, 13, 2).slots);
    expect(hold.expiresAt.toISOString()).toBe(quote.decisionBy);
    expect(h.calls.timers).toContainEqual(expect.objectContaining({ kind: 'kitchen_change', id: 10 }));
    expect(h.calls.timers.at(-1).dueAt.toISOString()).toBe(quote.decisionBy);
    await bookingUnchanged();

    const sent = await events('booking_change_requested');
    expect(sent.map((event: any) => event.metadata.audience).sort()).toEqual(['chef', 'manager']);
    const toKitchen = sent.find((event: any) => event.metadata.audience === 'manager');
    expect(toKitchen.message).toMatch(/asked to move KB-TEST10 from .* to .*\. Same price, so your payout doesn’t change\. Answer by .*/);
    expect(toKitchen.message).toContain('Their refund deadline would move to');
    expect(toKitchen.message).not.toMatch(/free/i);
    const toChef = sent.find((event: any) => event.metadata.audience === 'chef');
    expect(toChef.message).toMatch(/^Change request sent to Test Kitchen · they have until .* to answer\.$/);
    expect(toChef.metadata.emailRecipientPolicy).toBe('none'); // the chef already sees it on screen: in-app only
    expect(toChef.emails).toEqual([]);
  });

  it('price up: holds the extra on the saved card (manual capture), nothing is charged yet, and the chef is told the hold', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    expect(change.state).toBe('authorized');
    expect(h.calls.create).toBe(1); expect(h.calls.capture).toBe(0);
    const intent = [...h.intents.values()][0];
    expect(intent).toMatchObject({ amount: 4800, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1', capture_method: 'manual', status: 'requires_capture' });
    expect(intent.metadata).toMatchObject({ type: 'kitchen_booking_change', kitchen_change_id: change.id, booking_id: '10', chef_id: '3' });
    const row = await getChange(change.id);
    expect(row.intentId).toBe(intent.id);
    expect(row.history.map((step: any) => step.state)).toEqual(['payment_pending', 'authorized']);
    const chefNotice = (await events('booking_change_requested')).find((event: any) => event.metadata.audience === 'chef');
    expect(chefNotice.message).toContain('$48.00 is on hold on your card.');
    const kitchenNotice = (await events('booking_change_requested')).find((event: any) => event.metadata.audience === 'manager');
    expect(kitchenNotice.message).toContain('Your payout would change by +$46.00.'); // kitchen share incl. tax, never the chef's card total
    expect(await h.db.select().from(paymentTransactions).then((rows: any[]) => rows.length)).toBe(1); // nothing recorded as paid
    await bookingUnchanged();
  });

  it('the request window never reaches the 7-day card-authorization limit and the hold lasts exactly as long as the kitchen can answer', async () => {
    const { change } = await request(fakeStripe(), dest(NEW_DATE, 9, 3));
    const row = await getChange(change.id);
    expect(row.decisionBy.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000 + 2000);
    expect(row.decisionBy.getTime() - Date.now()).toBeLessThan(7 * 24 * 3_600_000);
    expect((await holds())[0].expiresAt.getTime()).toBe(row.decisionBy.getTime());
  });

  it('is idempotent on the request key: a replay returns the same request and creates no second hold or charge', async () => {
    const stripe = fakeStripe(), key = requestKey();
    const first = await request(stripe, dest(NEW_DATE, 9, 3), new Date(), key);
    const replay: any = await engine.requestKitchenChange(stripe, 10, chef, { destination: dest(NEW_DATE, 9, 3), quoteHash: first.quote.quoteHash, requestKey: key });
    expect((replay.change ?? replay).id).toBe(first.change.id);
    expect(h.calls.create).toBe(1);
    expect((await h.db.select().from(kitchenBookingChanges)).length).toBe(1);
    expect((await holds()).length).toBe(1);
    expect(await messageOf(engine.requestKitchenChange(stripe, 10, chef, { destination: dest(NEW_DATE, 9, 4), quoteHash: first.quote.quoteHash, requestKey: key }))).toBe('That request key belongs to a different change.');
  });

  it('refuses a request whose price changed since the chef looked', async () => {
    const quote = await preview(dest(NEW_DATE, 9, 3));
    await h.db.update(kitchens).set({ hourlyRate: '4500' }).where(eq(kitchens.id, 4));
    const message = await messageOf(engine.requestKitchenChange(fakeStripe(), 10, chef, { destination: dest(NEW_DATE, 9, 3), quoteHash: quote.quoteHash, requestKey: requestKey() }));
    expect(message).toBe('The price changed since you looked. Check the new total.');
    expect((await h.db.select().from(kitchenBookingChanges)).length).toBe(0);
    expect(h.calls.create).toBe(0);
  });

  it('allows one open change at a time, and many over time', async () => {
    const stripe = fakeStripe();
    const first = await request(stripe, dest(NEW_DATE, 13, 2));
    const quote = await preview(dest(NEW_DATE, 14, 2)).catch(error => error);
    expect(quote.message).toBe(RESCHEDULE_MESSAGES.open);
    await engine.decideKitchenChange(stripe, 10, first.change.id, chef, { action: 'withdraw', revision: first.change.revision });
    const second = await request(stripe, dest(NEW_DATE, 14, 2));
    expect(second.change.state).toBe('requested');
    expect((await h.db.select().from(kitchenBookingChanges)).length).toBe(2);
  });

  it('the database itself refuses a second open change for a booking', async () => {
    await request(fakeStripe(), dest(NEW_DATE, 13, 2));
    const [row] = await h.db.select().from(kitchenBookingChanges);
    await expect(h.db.insert(kitchenBookingChanges).values({ ...row, id: uuid(), requestKey: uuid() })).rejects.toThrow();
  });

  it('only the chef can request', async () => {
    const quote = await preview(dest(NEW_DATE, 13, 2));
    await expect(engine.requestKitchenChange(fakeStripe(), 10, manager, { destination: dest(NEW_DATE, 13, 2), quoteHash: quote.quoteHash, requestKey: requestKey() })).rejects.toThrow('Only the chef');
  });

  it('a declined saved card sends nothing and offers another card, with the time held only for the attempt', async () => {
    h.declineCard = true;
    const { result, change } = await request(fakeStripe(), dest(NEW_DATE, 9, 3));
    expect(change.state).toBe('awaiting_payment');
    expect(result.cardDeclined ?? change.cardDeclined).toBe(true);
    expect(await events('booking_change_requested')).toEqual([]); // the kitchen has heard nothing
    const declined = await events('booking_change_card_declined');
    expect(declined).toHaveLength(1); expect(declined[0].metadata.audience).toBe('chef');
    const [hold] = await holds();
    expect(hold.expiresAt.getTime() - Date.now()).toBeLessThan(40 * 60_000);
    expect((await getChange(change.id)).intentId).toBeNull();
    await bookingUnchanged();
  });

  it('no saved card at all is the same state', async () => {
    await h.db.update(kitchenBookings).set({ stripePaymentMethodId: null }).where(eq(kitchenBookings.id, 10));
    const { change } = await request(fakeStripe(), dest(NEW_DATE, 9, 3));
    expect(change.state).toBe('awaiting_payment'); expect(change.cardDeclined).toBe(true);
    expect(h.calls.create).toBe(0);
  });

  it('pay with another card: Checkout with manual capture, the new card sends the request, and the card is saved on this booking', async () => {
    h.declineCard = true;
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.declineCard = false;
    const { url } = await engine.checkoutKitchenChange(stripe, 10, change.id, chef, 'https://app.test/booking/10');
    expect(url).toBe('https://checkout.test/pay');
    const params = h.calls.checkout[0];
    expect(params.payment_intent_data.capture_method).toBe('manual');
    expect(params.line_items[0].price_data.unit_amount).toBe(4800);
    expect(params.metadata).toMatchObject({ type: 'kitchen_booking_change', kitchen_change_id: change.id });
    expect(params.success_url).toContain('changeCheckout=' + change.id);
    expect((await getChange(change.id)).state).toBe('payment_pending');
    // Not paid yet: syncing changes nothing and sends nothing.
    await engine.syncKitchenChange(stripe, 10, change.id, chef);
    expect((await events('booking_change_requested'))).toEqual([]);
    const intent = payCheckout([...h.sessions.keys()][0]);
    const synced: any = await engine.syncKitchenChange(stripe, 10, change.id, chef);
    expect(synced.change.state).toBe('authorized');
    expect((await getChange(change.id)).intentId).toBe(intent.id);
    expect((await getBooking()).stripePaymentMethodId).toBe('pm_new');
    expect((await events('booking_change_requested')).map((event: any) => event.metadata.audience).sort()).toEqual(['chef', 'manager']);
    // The kitchen's answer window starts when the request is actually sent.
    expect((await getChange(change.id)).decisionBy.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    // Replaying the sync (webhook + return) changes nothing.
    await engine.syncKitchenChange(stripe, 10, change.id, chef);
    expect((await events('booking_change_requested'))).toHaveLength(2);
  });

  it('only the chef can open Checkout, and only while another card is being asked for', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await expect(engine.checkoutKitchenChange(stripe, 10, change.id, chef, 'https://app.test/booking/10')).rejects.toThrow('closed');
    await expect(engine.checkoutKitchenChange(stripe, 10, change.id, manager, 'https://app.test/booking/10')).rejects.toThrow('Only the chef');
  });

  it('a card hold that arrives after the request closed is released, never kept', async () => {
    h.declineCard = true;
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.declineCard = false;
    await engine.checkoutKitchenChange(stripe, 10, change.id, chef, 'https://app.test/booking/10');
    await engine.decideKitchenChange(stripe, 10, change.id, chef, { action: 'withdraw', revision: (await getChange(change.id)).revision });
    const intent = payCheckout([...h.sessions.keys()][0]);
    await engine.reconcileKitchenChangeAuthorization(intent as any).catch(() => undefined);
    await engine.syncKitchenChange(stripe, 10, change.id, chef).catch(() => undefined);
    expect(await events('booking_change_requested')).toEqual([]);
    expect((await getChange(change.id)).state).toBe('withdrawn');
  });
});

// =====================================================================================================================
describe('the kitchen approves', () => {
  it('same price: the booking and everything hanging off its time move; no money moves', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    h.calls.documents.length = 0;
    const result: any = await approve(stripe, change);
    expect(result.state).toBe('applied');
    const booking = await getBooking();
    expect(booking.bookingDate.toISOString().slice(0, 10)).toBe(NEW_DATE);
    expect([booking.startTime, booking.endTime]).toEqual(['13:00', '15:00']);
    expect(booking.selectedSlots).toEqual(dest(NEW_DATE, 13, 2).slots);
    expect(booking.operatingWindowStartTime).toBe('08:00');
    expect(Number(booking.totalPrice)).toBe(8000);
    // The frozen cancellation terms keep their terms; only the session start moved, so free cancellation follows the new time.
    const snapshot = booking.cancellationPolicySnapshot as any;
    expect(snapshot.sessions[0].startAt).toBe(startOf(NEW_DATE, '13:00').toISOString());
    expect(snapshot).toMatchObject({ noticeHours: 24, lateChargePercent: 50, policyId: 1, version: 1, disclosureVersion: 'v1' });
    // The saved visit clock is rebuilt from the new schedule and the rest of the visit duties is untouched.
    const closeout = (booking.visitDuties as any).clockCloseout;
    expect(closeout.visits).toHaveLength(1);
    expect(closeout.visits[0].scheduledStartAt).toBe(startOf(NEW_DATE, '13:00').toISOString());
    expect(closeout.visits[0].scheduledEndAt).toBe(startOf(NEW_DATE, '15:00').toISOString());
    expect((booking.visitDuties as any).note).toBe('kept');
    expect(Number(booking.durationHours)).toBe(2);
    // Side effects on the time: closeout timers, reminders and instruction release, kitchen payout date.
    expect(h.calls.closeout).toEqual([10]);
    expect(h.calls.reminders).toEqual([['booking', 10], ['booking_review', 10]]);
    expect(h.calls.payout).toEqual([10]);
    expect(h.calls.documents).toEqual(['10:change_applied']);
    // The held time is released (the booking itself now owns it) and nothing was charged or refunded.
    expect(await holds()).toEqual([]);
    expect(h.calls.create + h.calls.capture + h.calls.refund).toBe(0);
    const row = await getChange(change.id);
    expect(row.history.map((step: any) => step.state)).toEqual(['requested', 'applied']);
    // Receipts remember what the original payment bought.
    const [parent] = await h.db.select().from(paymentTransactions);
    expect((parent.metadata as any).originalBookingSchedule).toMatchObject({ date: ORIGINAL_DATE, windowStart: '08:00' });
  });

  it('tells each side with its own copy, tells Local Cooks, and sends the new calendar event with a higher sequence', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await approve(stripe, change);
    const notices = await events('booking_change_approved');
    const toChef = notices.find((event: any) => event.metadata.audience === 'chef'), toKitchen = notices.find((event: any) => event.metadata.audience === 'manager');
    expect(toChef.message).toMatch(/^Test Kitchen approved your change · now .* · no charge or refund\.$/);
    expect(toKitchen.message).toMatch(/^You moved .*’s booking to .*\.$/);
    expect(toChef.metadata).toMatchObject({ recipientPolicy: 'chef', changeId: change.id });
    expect(toKitchen.metadata.recipientPolicy).toBe('manager');
    const ics = toChef.emails[0].content.attachments[0];
    expect(ics.filename).toBe('kitchen-booking.ics');
    expect(ics.content).toContain('UID:booking-10@localcooks.com');
    expect(ics.content).toContain('SEQUENCE:2');
    expect(ics.content).toContain(`DTSTART:${startOf(NEW_DATE, '13:00').toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    const admin = await events('booking_changed');
    expect(admin).toHaveLength(1); expect(admin[0].metadata.recipientPolicy).toBe('admins');
    expect(admin[0].title).toBe('Booking changed'); // delivery adds the reference through the shared admin notice
    expect(admin[0].message).toMatch(/^The chef changed the booking from .* to .*, and the kitchen approved\. The price did not change\.$/);
  });

  it('price up: captures the held extra once, records it as its own change payment, moves the booking, and releases the kitchen share', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const result: any = await approve(stripe, change);
    expect(result.state).toBe('applied');
    expect(h.calls.capture).toBe(1);
    const payments = await h.db.select().from(paymentTransactions);
    const extra = payments.find((row: any) => (row.metadata as any).kitchenChangeId === change.id);
    expect(extra).toMatchObject({ bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, status: 'succeeded' });
    expect(Number(extra.amount)).toBe(4800); expect(Number(extra.serviceFee)).toBe(200); expect(Number(extra.taxAmount)).toBe(600); expect(Number(extra.baseAmount)).toBe(4600);
    expect((extra.metadata as any).parentPaymentIntentId).toBe('pi_original');
    expect(h.calls.changePayout).toEqual([extra.id]);
    const booking = await getBooking();
    expect(booking.selectedSlots).toHaveLength(3);
    expect([booking.startTime, booking.endTime]).toEqual(['09:00', '12:00']);
    expect(Number(booking.totalPrice)).toBe(12000); expect(Number(booking.serviceFee)).toBe(600); expect(Number(booking.durationHours)).toBe(3);
    const toChef = (await events('booking_change_approved')).find((event: any) => event.metadata.audience === 'chef');
    expect(toChef.message).toContain('$48.00 was charged');
    expect(h.calls.documents).toContain('10:change_applied');
    // A further change prices from the NEW terms, not the originals.
    const next: any = await preview(dest(dayFromNow(14), 9, 1));
    expect(next.money).toMatchObject({ oldTotalCents: 14400, newTotalCents: 4800 });
  });

  it('price down: refunds the difference less the non-returned fee, splits it between kitchen and Local Cooks, and applies', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 1));
    expect(change.state).toBe('requested');
    expect(h.calls.create).toBe(0); // nothing is held for a refund
    const result: any = await approve(stripe, change);
    expect(result.state).toBe('applied');
    expect(h.calls.refund).toBe(1);
    const call = h.calls.refundOptions[0];
    expect(call).toMatchObject({ intentId: 'pi_original', amount: 4650, reverseTransferAmount: 4450 });
    expect(call.idempotencyKey).toContain(change.id);
    // The receipt reconciles later cancellation quotes: customer = kitchen + Local Cooks fee returned + processing cost.
    expect(call.metadata).toMatchObject({ type: 'kitchen_booking_change', kitchen_change_id: change.id, customer_receives: '4650', manager_debited: '4450',
      platform_service_fee_returned: '200', platform_processing_cost_cents: '0' });
    expect(Number(call.metadata.manager_debited) + Number(call.metadata.platform_service_fee_returned) + Number(call.metadata.platform_processing_cost_cents)).toBe(4650);
    expect((await h.db.select().from(paymentTransactions))[0].refundAmount).toBe('4650');
    expect((await getChange(change.id)).refundId).toBe('re_1');
    expect((await getBooking()).selectedSlots).toEqual([hour(9)]);
    const toChef = (await events('booking_change_approved')).find((event: any) => event.metadata.audience === 'chef');
    expect(toChef.message).toContain('$46.50 refund is on its way (banks usually show it within 5–10 business days)');
  });

  it('the price is frozen when the request is sent: a later rate change never changes what is captured', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    await h.db.update(kitchens).set({ hourlyRate: '9000', taxRatePercent: '30' }).where(eq(kitchens.id, 4));
    await approve(stripe, change);
    expect([...h.intents.values()][0]).toMatchObject({ amount: 4800, amount_received: 4800 });
    const extra = (await h.db.select().from(paymentTransactions)).find((row: any) => (row.metadata as any).kitchenChangeId);
    expect(Number(extra.amount)).toBe(4800);
    expect(Number((await getBooking()).totalPrice)).toBe(12000);
  });

  it('a price-down receipt is its own "Booking change refund" line', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 1));
    await approve(stripe, change);
    const payments = await h.db.select().from(paymentTransactions);
    const money: any = deriveBookingMoney({ booking: await getBooking(), payments: payments as any, claims: [], extensions: [], kitchenName: 'Test Kitchen', locationName: 'Test location',
      locationAddress: '1 Test St', timezone: TZ, chefName: 'Ana', chefEmail: null, addonNames: { storage: {}, equipment: {} } } as any);
    const parent = money.payments.find((payment: any) => payment.purpose === 'booking');
    expect(parent.refunds).toEqual([expect.objectContaining({ refundId: 're_1', amountCents: 4650, managerDebitedCents: 4450, reason: 'Booking change refund' })]);
    // The original receipt still describes the original date and hours.
    expect(parent.bookingSchedule.bookingDate).toBe(ORIGINAL_DATE);
    expect(money.booking.bookingDate).toBe(NEW_DATE);
    expect(parent.bookingSchedule.originalSlots).toEqual([hour(9), hour(10)]);
  });

  it('a daily-rate booking is repriced at the current daily rate', async () => {
    const fullDay = Array.from({ length: 8 }, (_, i) => hour(8 + i));
    await h.db.update(kitchenBookings).set({ pricingMode: 'daily', selectedSlots: fullDay, startTime: '08:00', endTime: '16:00' }).where(eq(kitchenBookings.id, 10));
    const result: any = await preview({ date: NEW_DATE, windowStart: '08:00', slots: fullDay });
    // $300.00 + 15% tax + 5% fee = $360.00 against the $96.00 paid
    expect(result.money).toMatchObject({ oldTotalCents: 9600, newTotalCents: 36000, payCents: 26400 });
    expect(h.calls.availability.at(-1)[4]).toMatchObject({ fullDay: true, excludeBookingId: 10 });
  });

  it('a double approval or webhook replay is idempotent: one capture, one move, one set of notices', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const [first, second]: any[] = await Promise.all([approve(stripe, change), approve(stripe, change)]);
    expect([first.state, second.state]).toEqual(['applied', 'applied']);
    await approve(stripe, change);
    expect(h.calls.capture).toBe(1);
    expect((await h.db.select().from(paymentTransactions)).filter((row: any) => (row.metadata as any).kitchenChangeId).length).toBe(1);
    expect(await events('booking_change_approved')).toHaveLength(2); // chef + kitchen, once
    expect(await events('booking_changed')).toHaveLength(1);
    const intent = [...h.intents.values()][0];
    expect(await engine.reconcileKitchenChangePayment(intent as any)).toMatchObject({ applied: true });
    expect(h.calls.capture).toBe(1);
  });

  it('only the kitchen manager of this booking can answer; the chef cannot approve and the kitchen cannot withdraw', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    const call = (actor: any, action: any) => engine.decideKitchenChange(stripe, 10, change.id, actor, { action, revision: change.revision });
    await expect(call(chef, 'approve')).rejects.toThrow('Only the kitchen manager');
    await expect(call(chef, 'decline')).rejects.toThrow('Only the kitchen manager');
    await expect(call(manager, 'withdraw')).rejects.toThrow('Only the chef who asked');
    await expect(call(otherManager, 'approve')).rejects.toThrow('Booking not found');
    await expect(call(otherChef, 'withdraw')).rejects.toThrow('Booking not found');
    expect((await getChange(change.id)).state).toBe('requested');
  });

  it('refuses a stale revision', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    expect(await messageOf(engine.decideKitchenChange(stripe, 10, change.id, manager, { action: 'approve', revision: change.revision + 5 }))).toBe('This request changed. Refresh and try again.');
  });

  it('after the deadline the answer is "This request has closed" and the request expires with its holds released', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const late = new Date(new Date(change.decisionBy).getTime() + 60_000);
    expect(await messageOf(approve(stripe, change, late))).toBe('This request has closed.');
    const row = await getChange(change.id);
    expect(row.state).toBe('expired');
    expect(await holds()).toEqual([]);
    expect(h.calls.capture).toBe(0); expect(h.calls.cancel).toBe(1);
    expect([...h.intents.values()][0].status).toBe('canceled');
    await bookingUnchanged();
  });

  it('if the held time vanished, approval fails cleanly and the booking stays as it was (the kitchen can still decline)', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    await h.db.delete(kitchenCheckoutHolds);
    expect(await messageOf(approve(stripe, change))).toMatch(/isn’t held any more/);
    expect(h.calls.capture).toBe(0);
    await bookingUnchanged();
    const declined: any = await engine.decideKitchenChange(stripe, 10, change.id, manager, { action: 'decline', revision: (await getChange(change.id)).revision });
    expect(declined.state).toBe('declined');
  });

  it('if the destination was taken anyway, approval fails before any money moves', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.unavailable = true;
    expect(await messageOf(approve(stripe, change))).toBe('That time is no longer available. Pick another.');
    expect(h.calls.capture).toBe(0);
    await bookingUnchanged();
    expect((await getChange(change.id)).state).toBe('authorized');
  });

  it('the approval re-checks the held time with the hold excluded and the advance-booking window ignored', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await approve(stripe, change);
    const options = h.calls.availability.at(-1)[4];
    expect(options).toMatchObject({ excludeBookingId: 10, excludeHoldId: `kitchen-change:${change.id}`, keepAdvanceWindow: false });
  });

  it('a booking that has started cannot be moved', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await h.db.update(kitchenBookings).set({ checkinStatus: 'checked_in', checkedInAt: new Date() }).where(eq(kitchenBookings.id, 10));
    expect(await messageOf(approve(stripe, change))).toBe('This booking has already started, so it can’t be moved.');
    await h.db.update(kitchenBookings).set({ checkinStatus: 'not_checked_in', checkedInAt: null, status: 'cancelled' }).where(eq(kitchenBookings.id, 10));
    expect(await messageOf(approve(stripe, change))).toBe('This booking is no longer confirmed, so it can’t be moved.');
  });

  it('a capture that fails leaves the booking unchanged, retains the time, opens a support case and tells both sides', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.failCapture = true;
    const result: any = await approve(stripe, change);
    expect(result.state).toBe('recovery_required');
    expect(h.calls.capture).toBe(0);
    await bookingUnchanged();
    expect(await holds()).toHaveLength(1);
    const support = await events('payment_recovery_needed');
    expect(support).toHaveLength(1); expect(support[0].metadata).toMatchObject({ recipientPolicy: 'admins', supportCase: true, changeId: change.id });
    expect((await events('booking_change_recovery')).map((event: any) => event.metadata.audience).sort()).toEqual(['chef', 'manager']);
    expect((await h.db.select().from(paymentTransactions)).length).toBe(1);
  });

  it('a refund that fails leaves the booking unchanged and opens a support case', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 1));
    h.failRefund = true;
    const result: any = await approve(stripe, change);
    expect(result.state).toBe('recovery_required');
    await bookingUnchanged();
    expect(await events('payment_recovery_needed')).toHaveLength(1);
  });

  it('money is refused while Local Cooks has the booking’s payments paused', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.frozen = true;
    expect(await messageOf(approve(stripe, change))).toMatch(/paused while Local Cooks reviews/);
    expect(h.calls.capture).toBe(0);
    await bookingUnchanged();
    expect((await getChange(change.id)).state).toBe('authorized');
  });

  it('a change with no money still works while payments are paused; one with money is refused up front', async () => {
    h.frozen = true;
    const quote = await preview(dest(NEW_DATE, 9, 3));
    expect(await messageOf(engine.requestKitchenChange(fakeStripe(), 10, chef, { destination: dest(NEW_DATE, 9, 3), quoteHash: quote.quoteHash, requestKey: requestKey() })))
      .toMatch(/paused while Local Cooks reviews/);
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    expect(((await approve(stripe, change)) as any).state).toBe('applied');
  });

  it('a side effect that fails after the money moved keeps the money recorded, leaves the booking unchanged and asks Local Cooks to settle it', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.calls.payout.length = 0;
    const reminders = await import('./advance-reminders');
    const original = (reminders as any).scheduleAdvanceReminders;
    void original;
    await h.db.execute(sql`ALTER TABLE kitchen_bookings ADD CONSTRAINT reject_move CHECK (start_time <> '09:00' OR end_time <> '12:00') NOT VALID`);
    try {
      const result: any = await approve(stripe, change);
      expect(result.state).toBe('recovery_required');
    } finally { await h.db.execute(sql`ALTER TABLE kitchen_bookings DROP CONSTRAINT reject_move`); }
    expect(h.calls.capture).toBe(1);
    await bookingUnchanged();
    const payments = await h.db.select().from(paymentTransactions);
    expect(payments.filter((row: any) => (row.metadata as any).kitchenChangeId)).toHaveLength(1); // the real capture stays on the ledger
    expect(await events('payment_recovery_needed')).toHaveLength(1);
    expect(await events('booking_change_approved')).toEqual([]);
    expect(await holds()).toHaveLength(1);
  });
});

// =====================================================================================================================
describe('declined, withdrawn and expired leave the booking exactly as it was', () => {
  it('decline: releases the card hold and the time, tells the chef the kitchen’s message, tells the kitchen', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const result: any = await engine.decideKitchenChange(stripe, 10, change.id, manager, { action: 'decline', revision: change.revision, message: 'We are closed that day.' });
    expect(result.state).toBe('declined');
    await bookingUnchanged();
    expect(await holds()).toEqual([]);
    expect(h.calls.capture).toBe(0); expect([...h.intents.values()][0].status).toBe('canceled');
    const notices = await events('booking_change_declined');
    const toChef = notices.find((event: any) => event.metadata.audience === 'chef');
    expect(toChef.message).toMatch(/^Test Kitchen couldn’t move your booking · it stays .*\. Your card hold of \$48\.00 was released\. Test Kitchen says: We are closed that day\.$/);
    expect(notices.find((event: any) => event.metadata.audience === 'manager').message).toContain('You declined');
    expect((await getChange(change.id)).history.map((step: any) => step.state)).toEqual(['payment_pending', 'authorized', 'release_pending', 'declined']);
  });

  it('decline without any money: closes at once', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    const result: any = await engine.decideKitchenChange(stripe, 10, change.id, manager, { action: 'decline', revision: change.revision });
    expect(result.state).toBe('declined');
    expect(await holds()).toEqual([]);
    const toChef = (await events('booking_change_declined')).find((event: any) => event.metadata.audience === 'chef');
    expect(toChef.message).not.toContain('card hold');
  });

  it('withdraw by the chef: releases the hold and the time and tells the kitchen', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    expect(change.canWithdraw).toBe(true);
    const read: any = await engine.readKitchenChanges(10, chef);
    expect(read.open).toMatchObject({ canWithdraw: true, canDecide: false });
    expect(((await engine.readKitchenChanges(10, manager)) as any).open).toMatchObject({ canDecide: true, canWithdraw: false });
    const result: any = await engine.decideKitchenChange(stripe, 10, change.id, chef, { action: 'withdraw', revision: change.revision });
    expect(result.state).toBe('withdrawn');
    expect([...h.intents.values()][0].status).toBe('canceled');
    expect(await holds()).toEqual([]);
    await bookingUnchanged();
    expect((await events('booking_change_withdrawn')).map((event: any) => event.metadata.audience).sort()).toEqual(['chef', 'manager']);
    // A replay of the same withdrawal is harmless.
    expect(((await engine.decideKitchenChange(stripe, 10, change.id, chef, { action: 'withdraw', revision: change.revision })) as any).state).toBe('withdrawn');
    expect(h.calls.cancel).toBe(1);
  });

  it('withdrawing before the request was sent (card attempt) tells the kitchen nothing: it never heard of it', async () => {
    h.declineCard = true;
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const result: any = await engine.decideKitchenChange(stripe, 10, change.id, chef, { action: 'withdraw', revision: (await getChange(change.id)).revision });
    expect(result.state).toBe('withdrawn');
    expect(await holds()).toEqual([]);
    expect((await events('booking_change_withdrawn')).filter((event: any) => event.metadata.audience === 'manager')).toEqual([]);
  });

  it('expiry: the kitchen did not answer, so the booking stays, the card hold and time are released and both sides are told', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const early = await engine.expireKitchenChangeForBooking(stripe, 10, new Date(new Date(change.decisionBy).getTime() - 60_000));
    expect(early).toEqual({ expired: false });
    expect((await getChange(change.id)).state).toBe('authorized');
    const due = new Date(new Date(change.decisionBy).getTime() + 5_000);
    expect(await engine.expireKitchenChangeForBooking(stripe, 10, due)).toEqual({ expired: true });
    expect((await getChange(change.id)).state).toBe('expired');
    await bookingUnchanged();
    expect(await holds()).toEqual([]);
    expect([...h.intents.values()][0].status).toBe('canceled');
    const notices = await events('booking_change_expired');
    expect(notices.find((event: any) => event.metadata.audience === 'chef').message).toMatch(/^Test Kitchen didn’t answer your change request in time, so your booking stays .*\. Your card wasn’t charged\.$/);
    expect(notices.find((event: any) => event.metadata.audience === 'manager')).toBeTruthy();
    // A second timer firing (or the worker) is a no-op.
    expect(await engine.expireKitchenChangeForBooking(stripe, 10, due)).toEqual({ expired: false });
    expect(await events('booking_change_expired')).toHaveLength(2);
  });

  it('the worker backstop expires an overdue change the timer missed, and is bounded', async () => {
    const stripe = fakeStripe();
    process.env.STRIPE_SECRET_KEY = '';
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await h.db.update(kitchenBookingChanges).set({ decisionBy: new Date(Date.now() - 60_000) }).where(eq(kitchenBookingChanges.id, change.id));
    expect(await expireKitchenChanges(3)).toMatchObject({ checked: 1 });
    expect((await getChange(change.id)).state).toBe('expired');
    expect(await expireKitchenChanges(3)).toEqual({ checked: 0, pending: 0 });
    await expect(expireKitchenChanges(4)).rejects.toThrow('one to three');
  });

  it('a booking that reaches its start while a change is open expires the change', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    const atStart = new Date(startOf(ORIGINAL_DATE).getTime() + 60_000);
    expect(await engine.expireKitchenChangeForBooking(stripe, 10, atStart)).toEqual({ expired: true });
    expect((await getChange(change.id)).state).toBe('expired');
    expect(await holds()).toEqual([]);
  });

  it('an unsent request (the card attempt ran out) expires and tells only the chef', async () => {
    h.declineCard = true;
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const row = await getChange(change.id);
    expect(await engine.expireKitchenChangeForBooking(stripe, 10, new Date(row.paymentBy.getTime() + 5_000))).toEqual({ expired: true });
    expect((await getChange(change.id)).state).toBe('expired');
    expect((await events('booking_change_expired')).map((event: any) => event.metadata.audience)).toEqual(['chef']);
    expect(await holds()).toEqual([]);
  });

  it('a new request closes an overdue one first', async () => {
    const stripe = fakeStripe();
    const first = await request(stripe, dest(NEW_DATE, 13, 2));
    await h.db.update(kitchenBookingChanges).set({ decisionBy: new Date(Date.now() - 1000) }).where(eq(kitchenBookingChanges.id, first.change.id));
    const quote = await engine.previewKitchenChange(10, chef, { destination: dest(NEW_DATE, 14, 2) }).catch((error: Error) => error);
    expect((quote as Error).message).toBe(RESCHEDULE_MESSAGES.open); // preview alone does not close it...
    const key = requestKey();
    const retry = await engine.requestKitchenChange(stripe, 10, chef, { destination: dest(NEW_DATE, 14, 2), quoteHash: '0'.repeat(64), requestKey: key }).catch((error: Error) => error);
    expect((retry as Error).message).toBe('The price changed since you looked. Check the new total.'); // ...but the request path did, then re-quoted
    expect((await getChange(first.change.id)).state).toBe('expired');
  });
});

// =====================================================================================================================
describe('cancellation while a change is open', () => {
  const cancelBooking = (stripe: any) => h.db.transaction(async (tx: any) => {
    await tx.update(kitchenBookings).set({ status: 'cancelled' }).where(eq(kitchenBookings.id, 10));
    return withdrawOpenKitchenChangesInTx(tx, 10);
  });

  it('closes the open change as withdrawn in the same transaction, frees the time, and tells both sides', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await cancelBooking(stripe);
    expect((await getChange(change.id)).state).toBe('withdrawn');
    expect(await holds()).toEqual([]);
    const notices = await events('booking_change_withdrawn');
    expect(notices.map((event: any) => event.metadata.audience).sort()).toEqual(['chef', 'manager']);
    expect(notices[0].metadata.changeEvent).toBe('closed');
  });

  it('with a card hold: the time is freed at once and the hold is released by the worker', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    await cancelBooking(stripe);
    expect((await getChange(change.id)).state).toBe('release_pending');
    expect(await holds()).toEqual([]);
    expect([...h.intents.values()][0].status).toBe('requires_capture'); // the transaction never calls the provider
    await engine.reconcileChange(stripe, change.id);
    expect((await getChange(change.id)).state).toBe('withdrawn');
    expect([...h.intents.values()][0].status).toBe('canceled');
    expect(h.calls.capture).toBe(0);
  });

  it('works through the real cancellation hook shared by every cancellation path (chef, kitchen, support, scheduled)', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    const { cancelLinkedBookingDates } = await import('./booking-linked-cancellation');
    await h.db.transaction((tx: any) => cancelLinkedBookingDates(tx, 10));
    expect((await getChange(change.id)).state).toBe('withdrawn');
    expect(await holds()).toEqual([]);
    expect(h.calls.revoked).toEqual([10]);
  });

  it('a cancellation and an approval racing each other end consistently: never both a moved booking and a withdrawn request', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    const [approval, cancellation] = await Promise.allSettled([approve(stripe, change), cancelBooking(stripe)]);
    expect(cancellation.status).toBe('fulfilled');
    const row = await getChange(change.id), booking = await getBooking();
    expect(await holds()).toEqual([]);
    if (row.state === 'applied') expect(approval.status).toBe('fulfilled');
    else { expect(row.state).toBe('withdrawn'); expect(booking.bookingDate.toISOString().slice(0, 10)).toBe(ORIGINAL_DATE); }
  });

  it('approval racing a cancellation is told the request has closed', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await cancelBooking(stripe);
    expect(await messageOf(approve(stripe, change))).toBe('This request has closed.');
    expect((await getBooking()).status).toBe('cancelled');
  });

  it('nothing is open: the hook is a no-op', async () => {
    expect(await cancelBooking(fakeStripe())).toBe(false);
  });
});

// =====================================================================================================================
describe('every reason carries a stable, translatable code', () => {
  it('eligibility reasons', async () => {
    await h.db.update(kitchenBookings).set({ status: 'pending' }).where(eq(kitchenBookings.id, 10));
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('eligibilityNotConfirmed');
    await h.db.update(kitchenBookings).set({ status: 'confirmed', checkinStatus: 'checked_in', checkedInAt: new Date() }).where(eq(kitchenBookings.id, 10));
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('eligibilityStarted');
    await h.db.update(kitchenBookings).set({ checkinStatus: 'not_checked_in', checkedInAt: null, selectedSlots: [hour(9), hour(14)] }).where(eq(kitchenBookings.id, 10));
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('contactKitchen');
    await h.db.update(kitchenBookings).set({ selectedSlots: [hour(9), hour(10)] }).where(eq(kitchenBookings.id, 10));
    const start = startOf(ORIGINAL_DATE).getTime();
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2), new Date(start - 23 * 3_600_000)))).toBe('eligibilityTooClose');
  });

  it('a storage or equipment attachment is named by code', async () => {
    await h.db.insert(storageBookings).values({ kitchenBookingId: 10, storageListingId: 1, chefId: 3, startDate: startOf(NEW_DATE), endDate: startOf(dayFromNow(20)), status: 'confirmed', totalPrice: '1000', pricingModel: 'daily', rentalState: 'ended', endReason: 'legacy' } as any);
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('storageContactSupport');
    await h.db.delete(storageBookings);
    await h.db.insert(equipmentListings).values({ id: 40, kitchenId: 4, equipmentType: 'Stand mixer', category: 'food-prep', condition: 'excellent', status: 'active' });
    await h.db.insert(equipmentBookings).values({ id: 50, equipmentListingId: 40, kitchenBookingId: 10, chefId: 3, startDate: startOf(ORIGINAL_DATE), endDate: startOf(ORIGINAL_DATE, '11:00'), status: 'confirmed', totalPrice: '1000', serviceFee: '50', pricingModel: 'hourly' });
    await h.db.insert(equipmentBookings).values({ equipmentListingId: 40, kitchenBookingId: 999, startDate: startOf(NEW_DATE), endDate: startOf(NEW_DATE, '12:00'), status: 'confirmed', totalPrice: '1000', pricingModel: 'hourly' });
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('equipmentUnavailable');
  });

  it('destination reasons', async () => {
    expect(await codeOf(preview({ date: NEW_DATE, windowStart: '08:00', slots: [] }))).toBe('chooseDateHours');
    expect(await codeOf(preview({ date: NEW_DATE, windowStart: '08:00', slots: [hour(9), hour(11)] }))).toBe('consecutiveHours');
    expect(await codeOf(preview({ date: ORIGINAL_DATE, windowStart: '08:00', slots: [hour(9), hour(10)] }))).toBe('chooseDifferentTime');
    h.unavailable = true;
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('timeUnavailable');
    h.unavailable = false;
    await h.db.update(kitchens).set({ defaultDailyBookingLimit: 4, minimumBookingHours: 2 }).where(eq(kitchens.id, 4));
    expect(await codeOf(preview(dest(NEW_DATE, 9, 6)))).toBe('lengthRange');
    await h.db.update(kitchens).set({ minimumBookingHours: 1 }).where(eq(kitchens.id, 4));
    expect(await codeOf(preview(dest(NEW_DATE, 9, 6)))).toBe('lengthMax');
    await h.db.update(kitchens).set({ defaultDailyBookingLimit: 12 }).where(eq(kitchens.id, 4));
    await h.db.update(kitchens).set({ isActive: false }).where(eq(kitchens.id, 4));
    expect(await codeOf(preview(dest(NEW_DATE, 9, 2)))).toBe('kitchenUnavailable');
  });

  it('an open change and a role or lookup refusal', async () => {
    await request(fakeStripe(), dest(NEW_DATE, 13, 2));
    expect(await codeOf(preview(dest(NEW_DATE, 14, 2)))).toBe('changeAlreadyOpen');
    expect(((await engine.readKitchenChanges(10, chef)) as any).canRequest.code).toBe('changeAlreadyOpen');
    expect(await codeOf(engine.previewKitchenChange(10, manager, { destination: dest(NEW_DATE, 9, 2) }))).toBe('onlyChefCanChange');
    expect(await codeOf(engine.previewKitchenChange(10, otherChef, { destination: dest(NEW_DATE, 9, 2) }))).toBe('bookingNotFound');
    expect(await codeOf(engine.syncKitchenChange(fakeStripe(), 10, 'missing', chef))).toBe('changeNotFound');
  });

  it('request reasons: a reused key and a price that moved', async () => {
    const key = requestKey();
    const first = await request(fakeStripe(), dest(NEW_DATE, 13, 2), new Date(), key);
    expect(await codeOf(engine.requestKitchenChange(fakeStripe(), 10, chef, { destination: dest(NEW_DATE, 9, 4), quoteHash: first.quote.quoteHash, requestKey: key }))).toBe('requestKeyMismatch');
    await engine.decideKitchenChange(fakeStripe(), 10, first.change.id, chef, { action: 'withdraw', revision: first.change.revision });
    const quote = await preview(dest(NEW_DATE, 9, 3));
    await h.db.update(kitchens).set({ hourlyRate: '4500' }).where(eq(kitchens.id, 4));
    expect(await codeOf(engine.requestKitchenChange(fakeStripe(), 10, chef, { destination: dest(NEW_DATE, 9, 3), quoteHash: quote.quoteHash, requestKey: requestKey() }))).toBe('priceChanged');
  });
});

// =====================================================================================================================
describe('notices in the reader’s language', () => {
  it('a French-speaking chef and a Ukrainian-speaking kitchen each read their own language', async () => {
    await h.db.update(users).set({ preferredLocale: 'fr-CA' }).where(eq(users.id, 3));
    await h.db.update(users).set({ preferredLocale: 'uk' }).where(eq(users.id, 2));
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 13, 2));
    await approve(stripe, change);
    const notices = await events('booking_change_approved');
    const toChef = notices.find((event: any) => event.metadata.audience === 'chef'), toKitchen = notices.find((event: any) => event.metadata.audience === 'manager');
    expect(toChef.title).toBe('Modification approuvée · KB-TEST10');
    expect(toChef.message).toContain('a approuvé votre modification');
    expect(toKitchen.title).toBe('Бронювання перенесено · KB-TEST10');
    expect(toKitchen.message).toContain('Ви перенесли бронювання');
    expect(toChef.message).not.toMatch(/\{\w+\}/); expect(toKitchen.message).not.toMatch(/\{\w+\}/);
  });

  it('no notice leaks an unfilled placeholder, in any language, for any event', async () => {
    const { changeAudiences, changeNoticeCopy } = await import('./kitchen-booking-change-notice');
    const facts = { chef: 'Ana', kitchen: 'Test Kitchen', reference: 'KB-1', old: 'Sat, Nov 14, 9:00 AM–11:00 AM', new: 'Sun, Nov 15, 1:00 PM–3:00 PM', deadline: 'Nov 13, 5:00 PM EST',
      freeCancel: 'Nov 14, 1:00 PM EST', amount: '$48.00', hold: '', money: '$48.00 was charged', released: '', message: '' };
    const { ensureServerI18n } = await import('../i18n');
    await ensureServerI18n();
    for (const locale of ['en-CA', 'fr-CA', 'uk']) for (const event of ['requested', 'approved', 'declined', 'expired', 'withdrawn', 'closed', 'card_declined', 'recovery', 'refund_kept'] as const)
      for (const [, prefix] of changeAudiences(event)) {
        const copy = changeNoticeCopy(prefix, locale, facts);
        expect(copy.title, `${locale} ${prefix}Title`).not.toMatch(/\{\w+\}|bc[A-Z]\w+(Title|Body)/);
        expect(copy.message, `${locale} ${prefix}Body`).not.toMatch(/\{\w+\}|bc[A-Z]\w+(Title|Body)/);
        expect(copy.message.length).toBeGreaterThan(10);
        expect(copy.message).not.toMatch(/ {2}|^ | $/);
      }
  });
});

// =====================================================================================================================
describe('receipts and money after a change', () => {
  it('the extra payment is its own "Booking change" line and the earlier receipt keeps describing the original time', async () => {
    const stripe = fakeStripe();
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    await approve(stripe, change);
    const payments = await h.db.select().from(paymentTransactions);
    const parent = payments.find((row: any) => row.paymentIntentId === 'pi_original'), extra = payments.find((row: any) => (row.metadata as any).kitchenChangeId);
    expect((parent.metadata as any).originalBookingSchedule).toMatchObject({ date: ORIGINAL_DATE });
    expect(Number(parent.amount)).toBe(9600); // immutable
    const money = deriveBookingMoney({ booking: await getBooking(), payments: payments as any, refunds: [], claims: [], extensions: [] } as any);
    const lines = JSON.stringify(money);
    expect(lines).toContain('Booking change');
    expect(Number(extra.amount)).toBe(4800);
  });
});

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const moneyRows = async () => ({ booking: await getBooking(), payments: await h.db.select().from(paymentTransactions), claims: [], extensions: [], kitchenName: 'Test Kitchen', locationName: 'Test location',
  locationAddress: '1 Test St', timezone: TZ, chefName: 'Ana', chefEmail: null, addonNames: { storage: {}, equipment: {} } } as any);

describe('fix round 1 regressions', () => {
  it.each(['capture', 'refund'])('F1: cancellation waits while %s is paused outside the transaction', async kind => {
    const stripe = fakeStripe(), entered = deferred(), resume = deferred();
    const { change } = await request(stripe, dest(NEW_DATE, 9, kind === 'capture' ? 3 : 1));
    if (kind === 'capture') {
      const capture = stripe.paymentIntents.capture;
      stripe.paymentIntents.capture = async (...args: any[]) => { entered.resolve(); await resume.promise; return capture(...args); };
    } else h.beforeRefund = async () => { entered.resolve(); await resume.promise; };
    const approval = approve(stripe, change);
    await entered.promise;
    expect(h.txDepth).toBe(0);
    await expect(h.db.transaction(async (tx: any) => {
      await tx.update(kitchenBookings).set({ status: 'cancelled' }).where(eq(kitchenBookings.id, 10));
      await (await import('./booking-linked-cancellation')).cancelLinkedBookingDates(tx, 10);
    })).rejects.toThrow('still being checked');
    expect((await getBooking()).status).toBe('confirmed');
    resume.resolve();
    expect(await approval).toMatchObject({ state: 'applied' });
    await h.db.transaction(async (tx: any) => { await withdrawOpenKitchenChangesInTx(tx, 10); await tx.update(kitchenBookings).set({ status: 'cancelled' }).where(eq(kitchenBookings.id, 10)); });
    expect((await getBooking()).status).toBe('cancelled');
    const sources = await h.db.select().from(paymentTransactions);
    expect(sources).toHaveLength(kind === 'capture' ? 2 : 1);
    if (kind === 'refund') expect(sources[0].refundAmount).toBe('4650');
  });

  it('F2: finds and releases a created hold whose response was lost, including retired attempts', async () => {
    const stripe = fakeStripe(), create = stripe.paymentIntents.create;
    stripe.paymentIntents.create = async (...args: any[]) => { await create(...args); throw Error('response lost'); };
    const destination = dest(NEW_DATE, 9, 3), quote = await preview(destination);
    await expect(engine.requestKitchenChange(stripe, 10, chef, { destination, quoteHash: quote.quoteHash, requestKey: requestKey() })).rejects.toThrow('response lost');
    let change = await getChange();
    expect(change.intentId).toBeNull();
    await engine.decideKitchenChange(stripe, 10, change.id, chef, { action: 'withdraw', revision: change.revision });
    change = await getChange();
    expect(change.state).toBe('withdrawn');
    expect([...h.intents.values()].every(intent => intent.status === 'canceled')).toBe(true);
    expect((change.policy as any).operation.retired[0].attemptKey).toBeTruthy();
    expect(h.calls.cancel).toBe(1);
  });

  it('F3: a successful capture with a lost response applies from provider evidence without another capture', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const capture = stripe.paymentIntents.capture;
    stripe.paymentIntents.capture = async (...args: any[]) => { await capture(...args); throw Error('response lost'); };
    expect(await approve(stripe, change)).toMatchObject({ state: 'applied' });
    expect(h.calls.capture).toBe(1);
  });

  it('F3: a recovery capture is completed by the worker and keeps its reservation', async () => {
    const stripe = h.provider, { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.failCapture = true;
    expect(await approve(stripe, change)).toMatchObject({ state: 'recovery_required' });
    expect(await holds()).toHaveLength(1);
    h.failCapture = false;
    await expireKitchenChanges();
    expect((await getChange()).state).toBe('applied');
    expect(h.calls.capture).toBe(1);
  });

  it('F3: refund recovery observes a pending refund then its success without issuing a second refund', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 1));
    h.failRefund = true;
    expect(await approve(stripe, change)).toMatchObject({ state: 'recovery_required' });
    h.failRefund = false;
    const saved = await getChange(), op = (saved.policy as any).operation;
    h.refunds.push({ id: 're_pending', intentId: 'pi_original', amount: 4650, status: 'pending', metadata: { type: 'kitchen_booking_change', kitchen_change_id: change.id,
      refund_operation_id: op.key, customer_receives: '4650', manager_debited: '4450', platform_service_fee_returned: '200', platform_processing_cost_cents: '0' } });
    await engine.reconcileChange(stripe, change.id);
    expect((await getChange()).state).toBe('recovery_required');
    h.refunds[0].status = 'succeeded';
    expect((await engine.reconcileChange(stripe, change.id)).change.state).toBe('applied');
    expect(h.calls.refund).toBe(0);
  });

  it('F3: support can finish recovery after revalidating a lost reservation', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    h.failCapture = true; await approve(stripe, change); h.failCapture = false;
    await h.db.delete(kitchenCheckoutHolds);
    const current = await getChange();
    h.unavailable = true;
    await expect(engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'finish', revision: current.revision })).rejects.toThrow('no longer available');
    expect(h.calls.capture).toBe(0);
    h.unavailable = false;
    expect((await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'finish', revision: current.revision })).change.state).toBe('applied');
  });

  it('F3: support compensates a captured recovery once and closes the change', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const capture = stripe.paymentIntents.capture;
    stripe.paymentIntents.capture = async (...args: any[]) => { const result = await capture(...args); h.unavailable = true; return result; };
    await approve(stripe, change);
    expect((await getChange()).state).toBe('recovery_required');
    const current = await getChange();
    await expect(engine.resolveKitchenChange(stripe, 10, change.id, chef, { action: 'compensate', revision: current.revision })).rejects.toThrow('Only Local Cooks');
    expect((await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'compensate', revision: current.revision })).change.state).toBe('withdrawn');
    await engine.reconcileChange(stripe, change.id);
    expect(h.calls.refund).toBe(1);
    expect(h.refunds[0].amount).toBe(4800);
    await bookingUnchanged();
    expect(await holds()).toEqual([]);
  });

  it('round 2: support retries a terminal compensation refund with one reversal and closes the change', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const capture = stripe.paymentIntents.capture;
    stripe.paymentIntents.capture = async (...args: any[]) => { const result = await capture(...args); h.unavailable = true; return result; };
    await approve(stripe, change);
    h.refundStatus = 'failed';
    let current = await getChange();
    expect((await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'compensate', revision: current.revision })).change.state).toBe('recovery_required');
    expect(h.refunds).toHaveLength(1);
    const originalKey = (await getChange().then(row => (row.policy as any).operation.key));
    h.refundStatus = 'succeeded';
    current = await getChange();
    expect((await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'compensate', revision: current.revision })).change.state).toBe('withdrawn');
    expect(h.refunds.map(refund => refund.status)).toEqual(['failed', 'succeeded']);
    expect(h.refunds[1].metadata.refund_replaces_id).toBe(h.refunds[0].id);
    expect(new Set(h.calls.refundOptions.map(option => option.reversalOperationKey))).toEqual(new Set([originalKey]));
    expect(h.calls.refund).toBe(2);
    await bookingUnchanged();
  });

  it('round 2: support closes a permanently conflicted move while keeping its verified refund', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 1));
    h.beforeRefund = async () => { h.unavailable = true; };
    expect(await approve(stripe, change)).toMatchObject({ state: 'recovery_required' });
    expect(h.refunds).toHaveLength(1);
    expect(await holds()).toHaveLength(1);
    const current = await getChange();
    const result = await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'close_keep_refund', revision: current.revision });
    expect(result.change.state).toBe('withdrawn');
    expect(h.refunds).toHaveLength(1);
    expect(await holds()).toEqual([]);
    await bookingUnchanged();
    const saved = await getChange();
    expect((saved.policy as any).resolution).toMatchObject({ action: 'close_keep_refund', fundedBy: 'local_cooks', amountCents: 4650, resolvedBy: 1 });
    expect(saved.history.at(-1).message).toContain('refund stands and is funded by Local Cooks');
    const notices = await events('booking_change_refund_kept');
    expect(notices.map((event: any) => event.metadata.audience).sort()).toEqual(['chef', 'manager']);
    expect(notices.find((event: any) => event.metadata.audience === 'chef').message).toMatch(/Test Kitchen.*booking stays.*\$46\.50.*stands/i);
    expect(notices.find((event: any) => event.metadata.audience === 'manager').message).toMatch(/Ana.*booking stays.*payout.*unchanged/i);
    const [admin] = await events('booking_change_refund_kept_admin');
    expect(admin?.metadata).toMatchObject({ recipientPolicy: 'admins', recoveryAction: 'close_keep_refund', fundedBy: 'local_cooks', amountCents: 4650 });
    expect(admin?.message).toMatch(/Ana.*Test Kitchen.*from .* to .*\$46\.50.*funded by Local Cooks.*payout is unchanged/i);
  });

  it('F4: a missing saved processing fee is read before the quote transaction and receipt facts before apply', async () => {
    await h.db.update(paymentTransactions).set({ stripeProcessingFee: '0' });
    const { change } = await request(fakeStripe(), dest(NEW_DATE, 9, 1));
    expect(change.money.feeKeptCents).toBe(150);
    expect(await approve(fakeStripe(), change)).toMatchObject({ state: 'applied' });
    expect(h.txDepth).toBe(0); // Every fake provider entry above asserts there is no DB transaction.
  });

  it('F5: the worker expires an abandoned 3DS attempt without a timer', async () => {
    const stripe = h.provider, create = stripe.paymentIntents.create;
    stripe.paymentIntents.create = async (...args: any[]) => { const intent = await create(...args); intent.status = 'requires_action'; return intent; };
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    const saved = await getChange();
    await expireKitchenChanges(3, new Date(saved.paymentBy!.getTime() + 1));
    expect((await getChange(change.id)).state).toBe('expired');
    expect(h.calls.cancel).toBe(1); expect(await holds()).toEqual([]);
    const notices = await events('booking_change_expired');
    expect(notices).toHaveLength(1); expect(notices[0].metadata.audience).toBe('chef');
    expect(notices[0].message).not.toContain('didn’t answer');
  });

  it('F5: authorization arriving across payment expiry never sends a request', async () => {
    const stripe = fakeStripe(), entered = deferred(), resume = deferred(), create = stripe.paymentIntents.create;
    stripe.paymentIntents.create = async (...args: any[]) => { const intent = await create(...args); entered.resolve(); await resume.promise; return intent; };
    const destination = dest(NEW_DATE, 9, 3), quote = await preview(destination);
    const pending = engine.requestKitchenChange(stripe, 10, chef, { destination, quoteHash: quote.quoteHash, requestKey: requestKey() });
    await entered.promise;
    const saved = await getChange();
    await engine.expireKitchenChangeForBooking(stripe, 10, new Date(saved.paymentBy!.getTime() + 1));
    resume.resolve(); await pending;
    expect((await getChange()).state).toBe('expired');
    expect(await events('booking_change_requested')).toEqual([]);
    expect([...h.intents.values()][0].status).toBe('canceled');
  });

  it('F5: pending rows yield their worker slot to later changes', async () => {
    const { change } = await request(null, dest(NEW_DATE, 9, 3));
    const first = await getChange();
    await h.db.insert(kitchenBookingChanges).values({ ...first, id: uuid(), bookingId: 999, requestKey: uuid(), updatedAt: new Date(Date.now() - 1000) });
    await expireKitchenChanges(1);
    const before = (await h.db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.bookingId, 999)))[0].updatedAt;
    await expireKitchenChanges(1);
    expect((await getChange(change.id)).updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('F6: retries a lost Checkout response with identical parameters and the committed key', async () => {
    const stripe = fakeStripe(); h.declineCard = true;
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3)); h.declineCard = false;
    const create = stripe.checkout.sessions.create, calls: any[] = [];
    stripe.checkout.sessions.create = async (...args: any[]) => { calls.push(structuredClone(args)); const session = await create(...args); if (calls.length === 1) throw Error('response lost'); return session; };
    const url = 'https://app.test/booking/10';
    await expect(engine.checkoutKitchenChange(stripe, 10, change.id, chef, url)).rejects.toThrow('response lost');
    expect((await getChange()).sessionId).toBeNull();
    await h.db.update(kitchens).set({ name: 'Renamed kitchen' });
    expect(await engine.checkoutKitchenChange(stripe, 10, change.id, chef, url, new Date(Date.now() + 2000))).toEqual({ url: 'https://checkout.test/pay' });
    expect(calls[1]).toEqual(calls[0]); expect(h.sessions.size).toBe(1);
  });

  it('F6: withdrawal owns a Checkout creation response that arrives later', async () => {
    const stripe = fakeStripe(); h.declineCard = true;
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3)); h.declineCard = false;
    const create = stripe.checkout.sessions.create, entered = deferred(), resume = deferred(); let count = 0;
    stripe.checkout.sessions.create = async (...args: any[]) => { const session = await create(...args); if (++count === 1) { entered.resolve(); await resume.promise; } return session; };
    const checkout = engine.checkoutKitchenChange(stripe, 10, change.id, chef, 'https://app.test/booking/10');
    await entered.promise;
    const current = await getChange();
    await engine.decideKitchenChange(stripe, 10, current.id, chef, { action: 'withdraw', revision: current.revision });
    resume.resolve(); await checkout;
    expect((await getChange()).state).toBe('withdrawn'); expect(h.sessions.size).toBe(1);
    expect([...h.sessions.values()][0].status).toBe('expired');
  });

  it('F7: historical change refunds do not swallow a later refund webhook, even when its local commit was lost', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 1)); await approve(stripe, change);
    const old = h.refunds[0];
    h.refunds.push({ id: 're_later', intentId: 'pi_original', amount: 100, status: 'succeeded', metadata: { customer_receives: '100', manager_debited: '100', platform_service_fee_returned: '0' } });
    expect(await engine.reconcileKitchenChangeRefundCharge({ payment_intent: 'pi_original', refunds: { data: [old, h.refunds[1]] } } as any)).toBe(false);
    const source = (await h.db.select().from(paymentTransactions))[0];
    expect(source.refundAmount).toBe('4750'); expect((source.metadata as any).refunds).toHaveLength(2);
    expect((await getChange(change.id)).state).toBe('applied'); expect(h.calls.refund).toBe(1);
  });

  it('F8: rejects equal and lower totals that move money between platform and kitchen shares', async () => {
    const [source] = await h.db.select().from(paymentTransactions);
    await h.db.update(paymentTransactions).set({ metadata: { ...source.metadata, approvedTax: 800, platformCommission: 800 }, taxAmount: '800', serviceFee: '800' });
    await expect(preview(dest(NEW_DATE, 9, 2))).rejects.toThrow('needs Local Cooks to price');
    await h.db.update(kitchens).set({ hourlyRate: '3500' });
    // Current tax exceeds the frozen 800 cents while the net total falls.
    await expect(preview(dest(NEW_DATE, 9, 2))).rejects.toThrow('needs Local Cooks to price');
  });

  it('F9: a later reduction refunds multiple sources, each with its own actual fee and operation', async () => {
    const stripe = fakeStripe(), first = await request(stripe, dest(NEW_DATE, 9, 4)); await approve(stripe, first.change);
    await h.db.update(paymentTransactions).set({ stripeProcessingFee: '480' }).where(sql`${paymentTransactions.paymentIntentId} <> 'pi_original'`);
    const second = await request(stripe, dest(dayFromNow(14), 9, 1));
    // Newest source: 9600 gross, fee 480. Original: 4800 gross, pro-rata fee 150.
    expect(second.change.money).toMatchObject({ oldTotalCents: 19200, newTotalCents: 4800, feeKeptCents: 630, refundCents: 13770 });
    expect(await approve(stripe, second.change)).toMatchObject({ state: 'applied' });
    await engine.reconcileChange(stripe, second.change.id);
    expect(h.calls.refund).toBe(2);
    expect(new Set(h.calls.refundOptions.map(o => o.idempotencyKey)).size).toBe(2);
    expect(h.calls.refundOptions.map(o => [o.intentId, o.amount])).toEqual([[first.change.id && [...h.intents.values()][0].id, 9120], ['pi_original', 4650]]);
    expect((await h.db.select().from(paymentTransactions)).every((p: any) => p.metadata.refunds.some((r: any) => r.kitchenChangeId === second.change.id))).toBe(true);
  });

  it('F10: the approved hourly rate and extra-time ratios stay frozen after kitchen settings change', async () => {
    const stripe = fakeStripe();
    await h.db.update(kitchens).set({ taxRatePercent: '20' });
    const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
    await h.db.update(kitchens).set({ hourlyRate: '9000', taxRatePercent: '30' });
    await approve(stripe, change);
    const booking = await getBooking();
    expect(booking.hourlyRate).toBe('4000');
    const { priceTerms } = await import('./session-extensions');
    expect(await priceTerms(h.db, { booking, managerId: 2 } as any)).toEqual({ hourlyRateCents: 4000, ratios: { subtotalCents: 12000, taxCents: 2400, commissionCents: 600 } });
  });

  it('F11: real manager/admin payout readers include applied change charges once, through refunds and transfers', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3)); await approve(stripe, change);
    const payout = await vi.importActual<typeof import('./kitchen-payout-service')>('./kitchen-payout-service');
    await h.db.update(paymentTransactions).set({ stripeProcessingFee: '150' }).where(sql`${paymentTransactions.paymentIntentId} <> 'pi_original'`);
    expect(await payout.readKitchenPayout(10)).toMatchObject({ amountCents: 13350 }); // 8900 + 4450
    expect((await payout.attachKitchenPayouts([{ id: 10 }]))[0].payout.amountCents).toBe(13350);
    const extra = (await h.db.select().from(paymentTransactions)).find((p: any) => p.metadata.kitchenChangeId);
    await h.db.update(paymentTransactions).set({ metadata: { ...extra.metadata, refunds: [{ managerDebited: 100 }] } }).where(eq(paymentTransactions.id, extra.id));
    expect((await payout.readKitchenPayout(10)).amountCents).toBe(13250);
    await h.db.update(paymentTransactions).set({ transferId: 'tr_extra', metadata: { ...extra.metadata, refunds: [{ managerDebited: 100 }], transfer: { transferredCents: 4450 } } }).where(eq(paymentTransactions.id, extra.id));
    expect((await payout.readKitchenPayout(10)).amountCents).toBe(13250);
    await h.db.update(paymentTransactions).set({ payoutTiming: 'after_closeout', transferId: 'tr_parent', metadata: { transfer: { transferredCents: 8900 } } }).where(eq(paymentTransactions.paymentIntentId, 'pi_original'));
    expect((await payout.readKitchenPayout(10)).amountCents).toBe(13250);
  });

  it('F12: statements use the current itinerary while original and change receipts retain their own schedules', async () => {
    const stripe = fakeStripe(), first = await request(stripe, dest(NEW_DATE, 13, 3)); await approve(stripe, first.change);
    const later = dayFromNow(14), second = await request(stripe, dest(later, 14, 3)); await approve(stripe, second.change);
    const docs = await import('./booking-documents'), money = docs.deriveBookingMoney(await moneyRows());
    const { LOCAL_COOKS_SUPPLIER } = await import('@shared/booking-documents');
    const ctx: any = { number: 'LC-R-000001', issuedAt: new Date().toISOString(), supplier: { ...LOCAL_COOKS_SUPPLIER, taxNumber: null }, issued: [] };
    const plan = docs.planBookingDocuments(money, true);
    const original = plan.find(p => p.sourceKey === docs.sourceKeys.payment('pi_original'))!;
    const change = plan.find(p => p.kind === 'payment' && p !== original)!;
    expect(original.build(ctx).meta).toContainEqual(expect.objectContaining({ value: expect.stringContaining(String(Number(ORIGINAL_DATE.slice(-2)))) }));
    expect(money.payments.find(p => p.purpose === 'booking')!.bookingSchedule!.bookingDate).toBe(ORIGINAL_DATE);
    expect(money.payments.find(p => p.purpose === 'change')!.bookingSchedule!.bookingDate).toBe(NEW_DATE);
    expect(change.build(ctx).meta).not.toEqual(original.build(ctx).meta);
    expect(money.booking.bookingDate).toBe(later);
    expect(money.booking.originalSlots[0].startTime).toBe('14:00');
    expect(plan.find(p => p.kind === 'statement')!.build(ctx).meta).not.toEqual(original.build(ctx).meta);
  });

  it('F13: reconcile, failed document issuance, reconcile and backfill retain booking change refund classification', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 1)); await approve(stripe, change);
    const { reconcilePaymentRefundReceipts } = await import('./payment-refund-reconciliation');
    const { ensureBookingDocuments } = await import('./booking-documents');
    const docs: any[] = []; let sequence = 0, fail = true;
    const store: any = { list: async () => docs, locked: async (_id: number, fn: any) => fn(store), nextSequence: async () => ++sequence,
      insert: async (doc: any) => { if (fail && doc.kind === 'refund') throw Error('storage unavailable'); const row = { ...doc, id: docs.length + 1 }; docs.push(row); return row; } };
    const deps: any = { store, loadRows: moneyRows, settlement: async () => ({ bookingStatus: 'confirmed', visitsClosed: false, openClaims: 0, openExtraTimeCharges: 0,
      pendingPayments: 0, pendingRefunds: 0, untransferredPayouts: 0, moneyFrozen: false }), cardLookup: async () => null, taxNumber: async () => null, now: () => new Date() };
    await reconcilePaymentRefundReceipts('pi_original');
    await expect(ensureBookingDocuments(10, deps)).rejects.toThrow('storage unavailable');
    const originalSnapshot = structuredClone(docs[0].snapshot);
    await reconcilePaymentRefundReceipts('pi_original'); fail = false;
    await ensureBookingDocuments(10, deps);
    expect(JSON.stringify(docs.find(d => d.kind === 'refund').snapshot)).toContain('Booking change refund');
    expect(docs[0].snapshot).toEqual(originalSnapshot);
  });

  async function capturedEquipment(removed = true) {
    await h.db.insert(equipmentListings).values({ id: 40, kitchenId: 4, equipmentType: 'Stand mixer', category: 'food-prep', condition: 'excellent', status: 'active' });
    await h.db.insert(equipmentBookings).values({ id: 50, equipmentListingId: 40, kitchenBookingId: 10, chefId: 3, paymentIntentId: 'pi_original',
      startDate: startOf(ORIGINAL_DATE), endDate: startOf(ORIGINAL_DATE, '11:00'), status: removed ? 'cancelled' : 'confirmed',
      paymentStatus: removed ? 'refunded' : 'paid', totalPrice: '1000', serviceFee: '50', pricingModel: 'hourly' });
    const [source] = await h.db.select().from(paymentTransactions);
    await h.db.update(paymentTransactions).set({ amount: '10800', baseAmount: '10350', taxAmount: '1350', serviceFee: '450',
      status: removed ? 'partially_refunded' : 'succeeded', refundAmount: removed ? '1167' : '0', metadata: { ...source.metadata,
        approvedSubtotal: 9000, approvedTax: 1350, platformCommission: 450,
        capturedComponentAllocations: [{ kind: 'kitchen', bookingId: 10, subtotalCents: 8000, taxCents: 1200 },
          { kind: 'equipment', bookingId: 50, subtotalCents: 1000, taxCents: 150 }],
        ...(removed ? { addonRemovals: [{ componentId: 'equipment:50:0', refundCents: 1167, kitchenRefundCents: 1117 }],
          refunds: [{ refundId: 're_addon', amount: 1167, managerDebited: 1117, platformServiceFeeReturned: 50 }] } : {}) } });
    if (removed) await h.db.update(kitchenBookings).set({ paymentStatus: 'partially_refunded' });
  }

  it('a change after add-on removal quotes and applies only the remaining kitchen time', async () => {
    await capturedEquipment();
    const stripe = fakeStripe(), first = await request(stripe, dest(NEW_DATE, 9, 3));
    expect(first.change.money).toMatchObject({ oldTotalCents: 9600, newTotalCents: 14400, payCents: 4800, refundCents: 0 });
    expect((await getChange()).quote).toMatchObject({ equipmentTerms: { kitchenCents: 0, taxCents: 0, feeCents: 0 } });
    await approve(stripe, first.change);
    const booking = await getBooking();
    expect([booking.totalPrice, booking.serviceFee]).toEqual(['12000', '600']);
    expect((booking.visitDuties as any).reschedulePricing).toEqual({ subtotalCents: 12000, taxCents: 1800, commissionCents: 600 });
    const [item] = await h.db.select().from(equipmentBookings);
    expect(item.status).toBe('cancelled');
    expect(item.startDate.toISOString()).toBe(startOf(ORIGINAL_DATE).toISOString());
  });

  it('shorter kitchen time after add-on removal refunds only the time difference minus its card fee', async () => {
    await capturedEquipment();
    const stripe = fakeStripe(), first = await request(stripe, dest(NEW_DATE, 9, 1));
    expect(first.change.money).toMatchObject({ oldTotalCents: 9600, newTotalCents: 4800, payCents: 0, refundCents: 4667, feeKeptCents: 133 });
    await approve(stripe, first.change);
    expect(h.calls.refundOptions).toHaveLength(1);
    expect(h.calls.refundOptions[0].amount).toBe(4667);
    expect((await getBooking()).totalPrice).toBe('4000');
  });

  it('removing equipment after an applied change rebases the next quote on its remaining items', async () => {
    await capturedEquipment(false);
    const stripe = fakeStripe(), first = await request(stripe, dest(NEW_DATE, 9, 3));
    await approve(stripe, first.change);
    await h.db.update(equipmentBookings).set({ status: 'cancelled', paymentStatus: 'refunded' });
    expect((await preview(dest(dayFromNow(14), 9, 2))).money).toMatchObject({ oldTotalCents: 14400, newTotalCents: 9600, refundCents: 4500 });
  });

  it('equipment moves at its per-session price; an unavailable item is named, and storage stays refused', async () => {
    await h.db.insert(equipmentListings).values({ id: 40, kitchenId: 4, equipmentType: 'Stand mixer', category: 'food-prep', condition: 'excellent', status: 'active' });
    await h.db.insert(equipmentBookings).values({ id: 50, equipmentListingId: 40, kitchenBookingId: 10, chefId: 3, startDate: startOf(ORIGINAL_DATE), endDate: startOf(ORIGINAL_DATE, '11:00'),
      status: 'confirmed', totalPrice: '1000', serviceFee: '50', pricingModel: 'hourly' });
    const [source] = await h.db.select().from(paymentTransactions);
    await h.db.update(paymentTransactions).set({ amount: '10800', baseAmount: '10350', taxAmount: '1350', serviceFee: '450', metadata: { ...source.metadata,
      approvedSubtotal: 9000, approvedTax: 1350, platformCommission: 450, equipment_items: [{ id: 50 }],
      capturedComponentAllocations: [{ kind: 'kitchen', bookingId: 10, subtotalCents: 8000, taxCents: 1200 },
        { kind: 'equipment', bookingId: 50, subtotalCents: 1000, taxCents: 150 }] } });
    const stripe = fakeStripe(), first = await request(stripe, dest(NEW_DATE, 9, 3));
    expect(first.change.money).toMatchObject({ oldTotalCents: 10800, newTotalCents: 15600, payCents: 4800 });
    await h.db.insert(equipmentBookings).values({ equipmentListingId: 40, kitchenBookingId: 999, startDate: startOf(NEW_DATE), endDate: startOf(NEW_DATE, '12:00'), status: 'confirmed', totalPrice: '1000', pricingModel: 'hourly' });
    await expect(approve(stripe, first.change)).rejects.toThrow('Stand mixer is not available');
    expect(h.calls.capture).toBe(0);
    await h.db.delete(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, 999));
    await approve(stripe, first.change);
    const booking = await getBooking();
    expect([booking.totalPrice, booking.serviceFee]).toEqual(['13000', '650']);
    expect((booking.visitDuties as any).reschedulePricing).toEqual({ subtotalCents: 12000, taxCents: 1800, commissionCents: 600 });
    const [item] = await h.db.select().from(equipmentBookings);
    expect(item.startDate.toISOString()).toBe(startOf(NEW_DATE).toISOString());
    expect(item.endDate.toISOString()).toBe(startOf(NEW_DATE, '12:00').toISOString()); expect(item.totalPrice).toBe('1000');
    await h.db.insert(storageBookings).values({ kitchenBookingId: 10, storageListingId: 1, chefId: 3, startDate: startOf(NEW_DATE), endDate: startOf(dayFromNow(20)), status: 'confirmed', totalPrice: '1000', pricingModel: 'daily', rentalState: 'ended', endReason: 'legacy' } as any);
    await expect(preview(dest(dayFromNow(14), 9, 3))).rejects.toThrow('To change a booking with storage, contact Local Cooks.');
  });
});

// Exercise provider helper implementations, not just the engine's fake helpers.
describe('fix round 1 provider boundaries', () => {
  const page = (data: any[]) => ({ data, has_more: false, async *[Symbol.asyncIterator]() { yield* data; } });

  it('F4/F3: real refund helper performs no provider call inside a transaction and returns a pending receipt unchanged', async () => {
    const provider = fakeStripe(); let creates = 0;
    provider.paymentIntents.retrieve = async () => { expect(h.txDepth).toBe(0); return { latest_charge: 'ch_original', transfer_group: null }; };
    provider.charges = { retrieve: async () => { expect(h.txDepth).toBe(0); return { id: 'ch_original', amount_captured: 9600, amount: 9600, transfer: null, balance_transaction: { fee: 300 } }; } };
    provider.transfers = { list: () => { expect(h.txDepth).toBe(0); return page([]); } };
    provider.refunds = { list: () => { expect(h.txDepth).toBe(0); return page(h.refunds); }, create: async (params: any) => { expect(h.txDepth).toBe(0); creates++; const receipt = { id: 're_real', amount: params.amount, charge: 'ch_original', status: 'pending', metadata: params.metadata }; h.refunds.push(receipt); return receipt; } };
    h.provider = provider;
    const real = await vi.importActual<typeof import('./stripe-service')>('./stripe-service');
    const options = { providerOnly: true, idempotencyKey: 'durable-refund', reverseTransferAmount: 4450, metadata: { customer_receives: '4650', manager_debited: '4450', platform_service_fee_returned: '200' } };
    expect(await real.reverseTransferAndRefund('pi_original', 4650, 'requested_by_customer', options)).toMatchObject({ refundId: 're_real', refundStatus: 'pending' });
    expect(await real.reverseTransferAndRefund('pi_original', 4650, 'requested_by_customer', options)).toMatchObject({ refundId: 're_real', refundStatus: 'pending' });
    h.refunds[0].status = 'succeeded';
    expect(await real.reverseTransferAndRefund('pi_original', 4650, 'requested_by_customer', options)).toMatchObject({ refundStatus: 'succeeded' });
    expect(creates).toBe(1);
  });

  it('F4: real change transfer reserves before provider I/O and writes its evidence after provider I/O', async () => {
    const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3)); await approve(stripe, change);
    const source = (await h.db.select().from(paymentTransactions)).find((p: any) => p.metadata.kitchenChangeId);
    await h.db.update(users).set({ stripeConnectAccountId: 'acct_fake' }).where(eq(users.id, 2));
    const transfers: any[] = [];
    h.provider = { charges: { retrieve: async () => { expect(h.txDepth).toBe(0); return { amount_refunded: 0 }; } },
      transfers: { list: () => { expect(h.txDepth).toBe(0); return page(transfers); },
        create: async (params: any) => { expect(h.txDepth).toBe(0); const [reserved] = await h.db.select().from(paymentTransactions).where(eq(paymentTransactions.id, source.id));
          expect(reserved.metadata.changeTransferOperation.state).toBe('pending');
          const result = { id: 'tr_real', amount: params.amount, amount_reversed: 0, metadata: params.metadata }; transfers.push(result); return result; },
        retrieve: async () => { expect(h.txDepth).toBe(0); return transfers[0]; } } };
    const real = await vi.importActual<typeof import('./stripe-transfer-service')>('./stripe-transfer-service');
    const params = { paymentIntentId: source.paymentIntentId!, paymentTransactionId: source.id, chargeAmountCents: 4800, actualStripeFeeCents: 150,
      chargeId: 'ch_extra', transferGroup: 'test', existingMetadata: source.metadata as any };
    expect(await real.transferToManagerForBooking(params)).toMatchObject({ transferred: true, transferId: 'tr_real', transferredCents: 4450 });
    expect(await real.transferToManagerForBooking(params)).toMatchObject({ transferred: true, transferId: 'tr_real' });
    expect(transfers).toHaveLength(1);
    const [saved] = await h.db.select().from(paymentTransactions).where(eq(paymentTransactions.id, source.id));
    expect(saved.metadata.changeTransferOperation.state).toBe('done');
    expect(saved.transferId).toBe('tr_real');
    expect(saved.stripeProcessingFee).toBe('150');
    expect(saved.managerRevenue).toBe('4450');
  });
});

it('F3: support explicitly retries a terminal failed refund with a new refund key and the original reversal key', async () => {
  const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 1));
  const row = await getChange();
  // Persist approval without calling a provider, then seed a terminal provider result for that operation.
  await approve(null, change);
  const approved = await getChange(), op = (approved.policy as any).operation;
  h.refunds.push({ id: 're_failed', intentId: 'pi_original', amount: 4650, status: 'failed', metadata: { type: 'kitchen_booking_change', kitchen_change_id: change.id,
    refund_operation_id: op.key, customer_receives: '4650', manager_debited: '4450', platform_service_fee_returned: '200' } });
  await engine.reconcileChange(stripe, change.id);
  const failed = await getChange();
  expect(failed.state).toBe('recovery_required');
  expect((await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'finish', revision: failed.revision })).change.state).toBe('applied');
  expect(h.calls.refundOptions[0].idempotencyKey).not.toBe(op.key);
  expect(h.calls.refundOptions[0].reversalOperationKey).toBe(op.key);
  expect(h.calls.refund).toBe(1);
  expect((await h.db.select().from(paymentTransactions))[0].refundAmount).toBe('4650');
  void row;
});

it('F7: a stale change webhook cannot overwrite a newer refund committed while provider facts were being read', async () => {
  const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 1)); await approve(stripe, change);
  const entered = deferred(), resume = deferred();
  h.afterFacts = async () => { h.afterFacts = null; entered.resolve(); await resume.promise; };
  const stale = engine.reconcileKitchenChangeRefundCharge({ payment_intent: 'pi_original', refunds: { data: [h.refunds[0]] } } as any);
  const staleResult = stale.catch(error => error);
  await entered.promise;
  h.refunds.push({ id: 're_concurrent', intentId: 'pi_original', amount: 100, status: 'succeeded', metadata: { customer_receives: '100', manager_debited: '100', platform_service_fee_returned: '0' } });
  await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts('pi_original');
  resume.resolve();
  expect((await staleResult).message).toContain('reload provider evidence');
  expect((await h.db.select().from(paymentTransactions))[0].refundAmount).toBe('4750');
  expect(await engine.reconcileKitchenChangeRefundCharge({ payment_intent: 'pi_original', refunds: { data: h.refunds } } as any)).toBe(false);
});

it('F11: real upcoming revenue counts a change charge still owed after the original payout', async () => {
  const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3)); await approve(stripe, change);
  await h.db.update(paymentTransactions).set({ payoutTiming: 'after_closeout', transferId: 'tr_parent', metadata: { transfer: { transferredCents: 8900 } } }).where(eq(paymentTransactions.paymentIntentId, 'pi_original'));
  await h.db.update(paymentTransactions).set({ payoutTiming: 'after_closeout', stripeProcessingFee: '150' }).where(sql`${paymentTransactions.paymentIntentId} <> 'pi_original'`);
  const payout = await vi.importActual<typeof import('./kitchen-payout-service')>('./kitchen-payout-service');
  expect(await payout.upcomingKitchenPayouts(2)).toMatchObject({ totalCents: 4450, payouts: [{ bookingId: 10, amountCents: 4450, status: 'scheduled' }] });
  await h.db.update(paymentTransactions).set({ transferId: 'tr_change' }).where(sql`${paymentTransactions.paymentIntentId} <> 'pi_original'`);
  expect((await payout.upcomingKitchenPayouts(2)).totalCents).toBe(0);
});

it('F1/F4: real money guard blocks competing change and payout money, but permits the saved operation', async () => {
  const stripe = fakeStripe(), { change } = await request(stripe, dest(NEW_DATE, 9, 3));
  await approve(null, change);
  const saved = await getChange();
  const guard = await vi.importActual<typeof import('./booking-money-guard')>('./booking-money-guard');
  await expect(guard.assertBookingMoneyWritable({ bookingId: 10 }, h.db)).rejects.toBeInstanceOf(guard.BookingMoneyFrozen);
  await expect(guard.assertBookingMoneyWritable({ bookingId: 10, operationKey: (saved.policy as any).operation.key }, h.db)).resolves.toBeUndefined();
  await engine.reconcileChange(stripe, change.id);
  const source = (await h.db.select().from(paymentTransactions)).find((p: any) => p.metadata.kitchenChangeId);
  await h.db.update(paymentTransactions).set({ metadata: { ...source.metadata, changeTransferOperation: { key: 'transfer:fake', state: 'pending' } } }).where(eq(paymentTransactions.id, source.id));
  await expect(guard.assertBookingMoneyWritable({ bookingId: 10 }, h.db)).rejects.toBeInstanceOf(guard.BookingMoneyFrozen);
  await expect(guard.assertBookingMoneyWritable({ bookingId: 10, operationKey: 'transfer:fake' }, h.db)).resolves.toBeUndefined();
});

it('F6: expiry settles a Checkout operation that died before any provider page existed, without creating a page', async () => {
  const stripe = fakeStripe(); h.declineCard = true;
  const { change } = await request(stripe, dest(NEW_DATE, 9, 3));
  stripe.checkout.sessions.create = async () => { throw Error('process stopped before provider call'); };
  await expect(engine.checkoutKitchenChange(stripe, 10, change.id, chef, 'https://app.test/booking/10')).rejects.toThrow('process stopped');
  const saved = await getChange();
  await engine.expireKitchenChangeForBooking(stripe, 10, new Date(saved.paymentBy!.getTime() + 1));
  expect((await getChange()).state).toBe('release_pending');
  await engine.reconcileChange(stripe, change.id, new Date(Date.parse((saved.policy as any).operation.decidedAt) + 61 * 60_000));
  expect((await getChange()).state).toBe('expired');
  expect(h.sessions.size).toBe(0); expect(await holds()).toEqual([]);
});

it('F3: support can compensate an unexpected capture discovered while releasing an authorization with a lost identity', async () => {
  const stripe = fakeStripe(), create = stripe.paymentIntents.create, destination = dest(NEW_DATE, 9, 3), quote = await preview(destination);
  stripe.paymentIntents.create = async (...args: any[]) => { const intent = await create(...args); intent.status = 'succeeded'; intent.amount_received = intent.amount; throw Error('response lost'); };
  await expect(engine.requestKitchenChange(stripe, 10, chef, { destination, quoteHash: quote.quoteHash, requestKey: requestKey() })).rejects.toThrow('response lost');
  let change = await getChange();
  await engine.decideKitchenChange(stripe, 10, change.id, chef, { action: 'withdraw', revision: change.revision });
  change = await getChange();
  expect(change.state).toBe('recovery_required'); expect(change.intentId).toBe([...h.intents.keys()][0]);
  expect((await engine.resolveKitchenChange(stripe, 10, change.id, { id: 1, role: 'admin' }, { action: 'compensate', revision: change.revision })).change.state).toBe('withdrawn');
  expect(h.refunds[0].amount).toBe(4800); await bookingUnchanged();
});
