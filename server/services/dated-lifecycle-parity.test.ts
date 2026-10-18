/** Real dated checkout, money and lifecycle chain; only provider/email/Firebase I/O is in memory. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { bookingDocuments } from '@shared/booking-documents-schema';
import { DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { savedCloseout } from '@shared/clock-closeout';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, provider: null as any, connection: null as any,
  sessions: [] as any[], intents: new Map<string, any>(), refunds: [] as any[], transfers: [] as any[],
  notificationCounts: new Map<number, number>(),
  sendEmail: vi.fn(async () => true), capture: vi.fn(), cancel: vi.fn(), transfer: vi.fn() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => {
  const reader = h.connection?.getStore() ?? h.db;
  // PGlite has one connection: re-entrant global reads must use the active SQL transaction.
  if (key === 'transaction') return (work: (tx: any) => Promise<unknown>) => reader.transaction((tx: any) => h.connection.run(tx, () => work(tx)));
  return typeof reader[key] === 'function' ? reader[key].bind(reader) : reader[key];
} }), pool: {} }));
vi.mock('stripe', () => ({ default: class {
  static createFetchHttpClient() { return {}; }
  constructor() { return h.provider; }
} }));
vi.mock('../email', async original => ({ ...await original<object>(), sendEmail: h.sendEmail }));
vi.mock('../firebase-setup', () => ({ initializeFirebaseAdmin: () => null }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => { throw Error('Firebase must stay offline'); } }));

const NOW = new Date('2099-10-01T12:00:00Z');
const DATES = ['2099-11-02', '2099-11-04', '2099-11-06'];
let checkout: typeof import('./dated-booking-checkout').checkoutDatedBooking;
let fulfill: typeof import('./booking-checkout-fulfillment').fulfillQuotedKitchenBooking;
let decide: typeof import('./booking-payment-decision').decideAuthorizedBooking;
let answer: typeof import('./booking-payment-decision').answerPartialAcceptance;
let expire: typeof import('./auth-expiry-service').lazyExpireKitchenBookingAuth;
let cancelDays: typeof import('./dated-booking-cancellation').cancelDatedDays;
let release: typeof import('./kitchen-day-payouts').releaseBookingDayPayouts;
let documents: typeof import('./booking-documents').ensureBookingDocuments;
let bounds: typeof import('./manager-customers').bookingBounds;
let deliver: typeof import('./booking-lifecycle-delivery').deliverBookingLifecycleEvents;

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_in_memory_only');
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  vi.stubEnv('LOCAL_COOKS_GST_HST_NUMBER', '');
  vi.stubEnv('VISIT_CODE_HMAC_SECRET', 'parity-test-only-signing-material-00000000');
  vi.stubEnv('VISIT_CODE_HMAC_KEY_VERSION', '1');
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network is forbidden in lifecycle parity tests'); }));
  const legacy = readFileSync('migrations/0043_kitchen_booking_visits.sql', 'utf8');
  const cp1 = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const test = await createTestDatabase([
    s.users, s.locations, s.kitchens, s.kitchenAvailability, s.kitchenDateOverrides, s.locationRequirements,
    s.chefKitchenApplications, s.chefDocumentRenewals, s.chefLocationAccess, s.applications,
    s.equipmentListings, s.storageListings, s.kitchenBookings, s.kitchenBookingVisits, s.equipmentBookings, s.storageBookings, s.storageOverstayRecords,
    s.paymentTransactions, s.paymentHistory, s.kitchenCheckoutHolds, s.kitchenCheckoutIncidents, s.kitchenInvitations,
    s.kitchenCancellationPolicies, s.platformSettings, s.bookingLifecycleEvents, s.emailLogs,
    s.checkinCheckoutChecklists, s.kitchenCheckinCheckoutOverrides, s.kitchenVisitArrivalChallenges,
    s.kitchenBookingChanges, s.kitchenBookingExtensions, s.kitchenBookingAttendanceEvents,
    s.bookingFlags, s.supportActions, s.commitmentProblems, s.damageClaims, s.kitchenViewings, bookingDocuments,
  ], [
    legacy.slice(legacy.indexOf('CREATE OR REPLACE FUNCTION'), legacy.indexOf('DROP TRIGGER')),
    'CREATE UNIQUE INDEX parity_setting ON platform_settings(key)',
    // Run the actual migration, including the dated-only trigger condition and constrained day ledgers.
    cp1,
    readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
    'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()',
    'CREATE UNIQUE INDEX parity_intent ON payment_transactions(payment_intent_id)',
    'CREATE UNIQUE INDEX parity_incident ON kitchen_checkout_incidents(session_id)',
    'CREATE UNIQUE INDEX parity_block ON kitchen_booking_visits(booking_id, block_index)',
    'CREATE UNIQUE INDEX parity_challenge ON kitchen_visit_arrival_challenges(target_key)',
    'CREATE UNIQUE INDEX parity_document ON booking_documents(source_key)',
    'CREATE SEQUENCE booking_document_number_seq',
    // Notification storage uses raw SQL rather than exported Drizzle tables; keep the real service.
    ...['manager', 'chef'].flatMap(role => {
      const prefix = role === 'chef' ? 'chef_' : '';
      return [`CREATE TYPE ${prefix}notification_type AS ENUM ('booking_confirmed','booking_cancelled','system_announcement')`,
        `CREATE TYPE ${prefix}notification_priority AS ENUM ('low','normal','high','urgent')`,
        `CREATE TABLE ${role}_notifications (id serial PRIMARY KEY, ${role}_id integer NOT NULL, location_id integer,
          type ${prefix}notification_type, priority ${prefix}notification_priority, title text, message text, metadata jsonb,
          action_url text, action_label text, expires_at timestamp, created_at timestamp DEFAULT now())`];
    }),
  ]);
  h.db = test.db; h.client = test.client;
  h.connection = new AsyncLocalStorage();
  h.provider = {
    checkout: { sessions: {
      create: async (params: any, options: any) => {
        const old = h.sessions.find(session => session.key === options.idempotencyKey);
        if (old) return old;
        const amount = params.line_items.reduce((sum: number, item: any) => sum + item.price_data.unit_amount, 0);
        const id = `pi_parity_${h.sessions.length}`;
        h.intents.set(id, { id, status: 'requires_capture', amount, amount_capturable: amount, amount_received: 0,
          capture_method: 'manual', currency: 'cad', metadata: params.payment_intent_data.metadata, latest_charge: null });
        const session = { id: `cs_parity_${h.sessions.length}`, key: options.idempotencyKey, url: 'https://checkout.test.invalid',
          status: 'complete', mode: 'payment', currency: 'cad', amount_total: amount, metadata: params.metadata, payment_intent: id };
        h.sessions.push(session); return session;
      },
      retrieve: async (id: string) => { const session = h.sessions.find(row => row.id === id); return { ...session, payment_intent: h.intents.get(session.payment_intent) }; },
      list: async () => ({ data: h.sessions, has_more: false }),
    } },
    paymentIntents: { retrieve: async (id: string) => structuredClone(h.intents.get(id)), capture: h.capture, cancel: h.cancel },
    charges: { retrieve: async (id: string) => structuredClone([...h.intents.values()].find(intent => intent.latest_charge?.id === id)?.latest_charge) },
    balanceTransactions: { retrieve: async (id: string) => structuredClone([...h.intents.values()].find(intent => intent.latest_charge?.balance_transaction?.id === id)?.latest_charge.balance_transaction) },
    refunds: {
      list: (params: any) => {
        const data = h.refunds.filter(row => (!params.payment_intent || row.payment_intent === params.payment_intent) && (!params.charge || row.charge === params.charge));
        return Object.assign(Promise.resolve({ data: structuredClone(data), has_more: false }), {
          async *[Symbol.asyncIterator]() { yield* structuredClone(data); },
        });
      },
      create: async (params: any, options: any) => {
        const old = h.refunds.find(row => row.key === options?.idempotencyKey);
        if (old) return old;
        const intent = h.intents.get(params.payment_intent) ?? [...h.intents.values()].find(row => row.latest_charge?.id === params.charge);
        const refund = { ...params, id: `re_parity_${h.refunds.length}`, key: options?.idempotencyKey, status: 'succeeded',
          currency: 'cad', payment_intent: intent.id, charge: intent.latest_charge.id };
        h.refunds.push(refund); intent.latest_charge.amount_refunded += params.amount;
        return refund;
      },
    },
    transfers: { list: async () => ({ data: h.transfers, has_more: false }), create: h.transfer },
  };
  ({ checkoutDatedBooking: checkout } = await import('./dated-booking-checkout'));
  ({ fulfillQuotedKitchenBooking: fulfill } = await import('./booking-checkout-fulfillment'));
  ({ decideAuthorizedBooking: decide, answerPartialAcceptance: answer } = await import('./booking-payment-decision'));
  ({ lazyExpireKitchenBookingAuth: expire } = await import('./auth-expiry-service'));
  ({ cancelDatedDays: cancelDays } = await import('./dated-booking-cancellation'));
  ({ releaseBookingDayPayouts: release } = await import('./kitchen-day-payouts'));
  ({ ensureBookingDocuments: documents } = await import('./booking-documents'));
  ({ bookingBounds: bounds } = await import('./manager-customers'));
  ({ deliverBookingLifecycleEvents: deliver } = await import('./booking-lifecycle-delivery'));
}, 60_000);

afterAll(async () => { await h.client?.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  const tables = await h.client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  await h.client.exec(`TRUNCATE ${tables.rows.map((row: any) => `"${row.tablename}"`).join(',')} RESTART IDENTITY CASCADE`);
  h.sessions = []; h.intents.clear(); h.refunds = []; h.transfers = []; h.notificationCounts.clear(); vi.clearAllMocks();
  h.capture.mockImplementation(async (id: string, params: any) => {
    const intent = h.intents.get(id), amount = params.amount_to_capture ?? intent.amount;
    Object.assign(intent, { status: 'succeeded', amount_received: amount, amount_capturable: 0,
      latest_charge: { id: `ch_${id}`, payment_intent: id, paid: true, captured: true, currency: 'cad', amount, amount_captured: amount,
        amount_refunded: 0, payment_method_details: { card: { brand: 'visa', last4: '4242' } },
        balance_transaction: { id: `bt_${id}`, source: `ch_${id}`, currency: 'cad', amount, fee: 1941, net: amount - 1941,
          fee_details: [{ type: 'stripe_fee', amount: 1941, currency: 'cad' }] } } });
    return structuredClone(intent);
  });
  h.cancel.mockImplementation(async (id: string) => { const intent = h.intents.get(id); intent.status = 'canceled'; intent.amount_capturable = 0; return structuredClone(intent); });
  h.transfer.mockImplementation(async (params: any) => { const transfer = { ...params, id: `tr_parity_${h.transfers.length}`, reversed: false, amount_reversed: 0 }; h.transfers.push(transfer); return transfer; });
  await h.db.insert(s.users).values([
    { id: 2, username: 'kitchen@test.invalid', password: 'test', role: 'manager', stripeConnectAccountId: 'acct_parity', managerProfileData: { fullName: 'Test Kitchen' } },
    { id: 3, username: 'chef@test.invalid', password: 'test', role: 'chef', managerProfileData: { fullName: 'Test Chef' } },
  ]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Test location', address: 'Test address', timezone: 'UTC',
    kitchenLicenseUrl: 'https://test.invalid/license', kitchenLicenseStatus: 'approved', kitchenLicenseExpiry: '2100-01-01' });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Test kitchen', hourlyRate: '2500', dailyRate: '18000', taxRatePercent: '15', listingStatus: 'active' });
  await h.db.insert(s.kitchenAvailability).values(Array.from({ length: 7 }, (_, dayOfWeek) => ({ kitchenId: 4, dayOfWeek, startTime: '09:00', endTime: '17:00' })));
  await h.db.insert(s.chefKitchenApplications).values({ chefId: 3, locationId: 9, fullName: 'Test Chef', email: 'chef@test.invalid', phone: '5555555555',
    kitchenPreference: 'commercial', foodSafetyLicense: 'yes', foodEstablishmentCert: 'yes', status: 'approved', current_tier: 3,
    foodSafetyLicenseUrl: 'https://test.invalid/safety', foodSafetyLicenseStatus: 'approved', foodSafetyLicenseExpiry: '2100-01-01',
    foodEstablishmentCertUrl: 'https://test.invalid/cert', foodEstablishmentCertStatus: 'approved', foodEstablishmentCertExpiry: '2100-01-01' });
  await h.db.insert(s.chefLocationAccess).values({ chefId: 3, locationId: 9, grantedBy: 2 });
  await h.db.insert(s.kitchenCancellationPolicies).values({ kitchenId: 4, version: 1, status: 'published', noticeHours: 24, lateChargePercent: 50,
    tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], publishedBy: 2 });
  await h.db.insert(s.platformSettings).values([{ key: 'platform_commission_rate', value: '0.07' }, { key: 'booking_multiday_enabled', value: 'true' }]);
  await h.db.insert(s.equipmentListings).values({ id: 10, kitchenId: 4, category: 'cooking', equipmentType: 'Mixer', condition: 'good', sessionRate: '2500', availabilityType: 'rental' });
});

const getBooking = async (id: number) => (await h.db.select().from(s.kitchenBookings).where(eq(s.kitchenBookings.id, id)))[0];
const visits = (id: number) => h.db.select().from(s.kitchenBookingVisits).where(eq(s.kitchenBookingVisits.bookingId, id)).orderBy(s.kitchenBookingVisits.blockIndex);
async function event(id: number, kind: string) {
  const rows = await h.db.select().from(s.bookingLifecycleEvents).where(and(eq(s.bookingLifecycleEvents.bookingId, id), eq(s.bookingLifecycleEvents.kind, kind)));
  expect(rows.length, `${kind} lifecycle event`).toBeGreaterThan(0);
  const row = rows.at(-1);
  expect(row.emails.length, `${kind} email outbox`).toBeGreaterThan(0);
  const queued = await h.client.query('SELECT metadata FROM chef_notifications UNION ALL SELECT metadata FROM manager_notifications');
  const count = queued.rows.filter((notice: any) => notice.metadata.bookingId === id).length;
  expect(count, `${kind} adds a notification`).toBeGreaterThan(h.notificationCounts.get(id) ?? 0);
  h.notificationCounts.set(id, count);
  const sent = h.sendEmail.mock.calls.length;
  await expect(deliver(10, 20_000, id, row.id)).resolves.toMatchObject({ completed: 1 });
  expect(h.sendEmail.mock.calls.length, `${kind} email rendered and sent to fake transport`).toBeGreaterThan(sent);
  return row;
}
async function requested(equipment = false) {
  await checkout(3, { kitchenId: 4, days: DATES.map(date => ({ date, pricingMode: 'daily', equipmentIds: equipment ? [10] : [] })),
    cancellationPolicyAccepted: true, cancellationPolicyVersion: 1, cancellationDisclosureVersion: DATED_DISCLOSURE_VERSION }, 'https://test.invalid');
  const session = h.sessions.at(-1);
  const id = (await fulfill(session, h.intents.get(session.payment_intent), h.provider))!;
  expect(id).toBeTypeOf('number');
  expect(await getBooking(id)).toMatchObject({ status: 'pending', paymentStatus: 'authorized', scheduleRevision: 1 });
  expect(savedCloseout((await getBooking(id)).visitDuties)).toBeUndefined();
  expect((await visits(id)).map((row: any) => row.visitDate)).toEqual(DATES);
  await event(id, 'requested');
  const reminders = await h.db.select().from(s.emailLogs);
  expect(reminders.some((row: any) => row.trackingId?.startsWith(`advance:manager_decision:${id}:`) && row.status === 'scheduled')).toBe(true);
  return id;
}
async function confirmed() {
  const id = await requested();
  await expect(decide(id, 'confirmed', [], [], 2)).resolves.toBeDefined();
  expect(h.capture).toHaveBeenCalledOnce();
  expect(await getBooking(id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  expect(savedCloseout((await getBooking(id)).visitDuties)?.visits).toHaveLength(3);
  const notice = await event(id, 'confirmed');
  expect(notice.emails.some((email: any) => email.confirmation || email.content?.html)).toBe(true);
  const allocations = await h.db.select().from(s.kitchenBookingDayAllocations);
  const payouts = await h.db.select().from(s.kitchenBookingDayPayouts);
  expect(allocations).toHaveLength(3); expect(payouts).toHaveLength(3);
  expect(allocations.map((row: any) => [row.subtotalCents, row.taxCents, row.serviceFeeCents, row.stripeFeeCents])).toEqual(
    Array.from({ length: 3 }, () => [18000, 2700, 1260, 647]));
  expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(65880);
  expect(allocations.reduce((sum: number, row: any) => sum + row.stripeFeeCents, 0)).toBe(1941);
  const [source] = await h.db.select().from(s.paymentTransactions).where(eq(s.paymentTransactions.bookingId, id));
  expect(source).toMatchObject({ status: 'succeeded', amount: '65880', baseAmount: '62100', taxAmount: '8100',
    serviceFee: '3780', stripeProcessingFee: '1941', managerRevenue: '60159', payoutPartition: 'per_day', payoutTiming: 'after_closeout' });
  expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents - row.stripeFeeCents, 0)).toBe(Number(source.managerRevenue));
  expect((await documents(id)).documents.some(doc => doc.kind === 'payment')).toBe(true);
  return id;
}

describe('dated lifecycle parity with real services', () => {
  it('checks out, fulfills and confirms three full non-consecutive days, saving clocks, reminders, emails and conserved money', async () => {
    const id = await confirmed();
    const reminders = await h.db.select().from(s.emailLogs);
    expect(reminders.some((row: any) => row.trackingId?.startsWith(`advance:booking:${id}:`) && row.status === 'scheduled')).toBe(true);
  });
  it('declines a fresh pending request and releases its hold', async () => {
    const id = await requested();
    await decide(id, 'cancelled', [], [], 2);
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(await getBooking(id)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    await event(id, 'cancelled');
  });
  it('expires a fresh request through auth-expiry without a saved closeout', async () => {
    const id = await requested();
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3600_000));
    await expect(expire(await getBooking(id))).resolves.toBe(true);
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(await getBooking(id)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    expect((await event(id, 'cancelled')).metadata).toMatchObject({ requestExpired: true });
  });
  it('lets the chef withdraw a fresh pending request', async () => {
    const id = await requested();
    await decide(id, 'cancelled', [], [], 3);
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(await getBooking(id)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    await event(id, 'cancelled');
  });
  it('proposes partial acceptance and captures the reduced total only after the chef accepts', async () => {
    const id = await requested(true);
    const [item] = await h.db.select().from(s.equipmentBookings);
    await decide(id, 'confirmed', [], [{ equipmentBookingId: item.id, action: 'cancelled' }], 2);
    expect(h.capture).not.toHaveBeenCalled();
    await event(id, 'partial_acceptance_proposed');
    const proposal = (await getBooking(id)).partialAcceptance;
    await answer(id, proposal.id, 'accept', 3);
    expect(h.capture).toHaveBeenCalledOnce();
    expect(await getBooking(id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', partialAcceptance: { state: 'accepted' } });
    await event(id, 'confirmed');
    const allocations = await h.db.select().from(s.kitchenBookingDayAllocations);
    expect(allocations.some((row: any) => row.componentKey === `equipment:${item.id}`)).toBe(false);
    expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(proposal.newTotalCents);
  });
  it('lets the chef drop one day before the deadline, then cancel the remaining booking', async () => {
    const id = await confirmed(), [first] = await visits(id);
    await cancelDays(id, { role: 'chef', id: 3 }, { target: { visitIds: [first.id] }, operationKey: 'chef-drop-first' });
    expect(h.refunds).toHaveLength(1);
    await event(id, 'day_cancelled');
    expect((await visits(id)).filter((row: any) => row.scheduleState === 'cancelled')).toHaveLength(1);
    await cancelDays(id, { role: 'chef', id: 3 }, { target: {}, operationKey: 'chef-cancel-rest' });
    expect(h.refunds).toHaveLength(2);
    await event(id, 'cancelled');
    expect(await getBooking(id)).toMatchObject({ status: 'cancelled' });
    expect((await visits(id)).every((row: any) => row.scheduleState === 'cancelled')).toBe(true);
  });
  it('lets the kitchen cancel one day with a queued lifecycle notice', async () => {
    const id = await confirmed(), [first] = await visits(id);
    await cancelDays(id, { role: 'manager', id: 2 }, { target: { visitIds: [first.id] }, operationKey: 'kitchen-drop-first' });
    expect(h.refunds).toHaveLength(1);
    await event(id, 'day_cancelled');
    expect(await getBooking(id)).toMatchObject({ status: 'confirmed' });
    expect((await visits(id)).filter((row: any) => row.scheduleState === 'cancelled')).toHaveLength(1);
  });
  it('releases only one day after its inspection using an in-memory transfer', async () => {
    const id = await confirmed(), [first] = await visits(id);
    await h.db.update(s.kitchenBookingVisits).set({ checkinStatus: 'checked_out', checkoutApprovedBy: 2,
      checkoutApprovedAt: new Date('2099-11-02T17:30:00Z') }).where(eq(s.kitchenBookingVisits.id, first.id));
    const afterInspection = new Date('2099-11-03T18:00:00Z');
    vi.setSystemTime(afterInspection);
    const [payout] = await h.db.select().from(s.kitchenBookingDayPayouts).where(eq(s.kitchenBookingDayPayouts.visitId, first.id));
    await expect(release(id, afterInspection, undefined, payout.id)).resolves.toMatchObject({ success: true, transferred: true, failures: 0 });
    expect(h.transfer).toHaveBeenCalledOnce();
    await event(id, 'payout_released');
    const rows = await h.db.select().from(s.kitchenBookingDayPayouts);
    expect(rows.filter((row: any) => row.transferId)).toHaveLength(1);
    expect(rows.find((row: any) => row.id === payout.id).transferAmountCents).toBe(20053);
  });
  it('gives a pending dated booking its frozen first-day bounds before confirmation', async () => {
    const id = await requested();
    expect(bounds(await getBooking(id), 'UTC')?.start.toISOString()).toBe('2099-11-02T09:00:00.000Z');
  });
});
