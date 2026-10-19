/** Real Postgres execution/transactions via PGlite; only provider I/O, delivery and the independently tested day engine are stubbed. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { allocateCents, DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, provider: null as any, sessions: [] as any[], intent: null as any,
  policy: {} as any, closed: new Set<string>(), canBook: true, loseCreate: false, loseCapture: false, capturedKeys: new Set<string>(),
  create: vi.fn(), capture: vi.fn(), cancel: vi.fn(), event: vi.fn(), lazyExpire: vi.fn(), next: 0 }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }), pool: {} }));
vi.mock('stripe', () => ({ default: class { constructor() { return h.provider; } } }));
vi.mock('./booking-policy-settings', () => ({ kitchenBookingPolicies: async () => h.policy }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: h.canBook }) } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 9, minimumBookingHours: 1 }) } }));
const hours = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ startTime: `${String(from + i).padStart(2, '0')}:00`, endTime: `${String(from + i + 1).padStart(2, '0')}:00` }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {
  operatingWindow: async () => ({ startTime: '08:00', endTime: '16:00' }),
  validateBookingAvailability: async (_k: number, date: Date, _a: string, _b: string, options: any) => h.closed.has(date.toISOString().slice(0, 10))
    ? { valid: false, code: 'closed', error: 'Closed' } : { valid: true, windowStartTime: '08:00', slots: options.fullDay ? hours(8, 16) : options.selectedSlots },
} }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `CP4-${++h.next}` }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.event }));
// The chef's window is the real function (the same one the kitchen's dialog reads); only the request rule is simplified.
vi.mock('./booking-response-deadline', async importOriginal => ({ ...await importOriginal<object>(),
  getBookingResponseDeadline: async (booking: any) => responseDeadlineForBooking(booking, 'UTC') }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
vi.mock('./visit-code-challenge', () => ({ ensureChallengesForBooking: vi.fn() }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./auth-expiry-service', () => ({ lazyExpireKitchenBookingAuth: h.lazyExpire, sendAuthExpiryNotification: vi.fn() }));
vi.mock('./booking-linked-cancellation', () => ({ cancelLinkedBookingDates: async (tx: any, id: number) => {
  await tx.update(s.equipmentBookings).set({ status: 'cancelled' }).where(eq(s.equipmentBookings.kitchenBookingId, id));
} }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn() } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Test Chef' }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: async () => structuredClone(h.intent),
  getBookingCheckoutSession: async () => h.sessions.find(session => session.payment_intent === h.intent.id),
  capturePaymentIntent: h.capture, cancelPaymentIntent: h.cancel,
  getDatedCaptureEvidence: async () => (await import('./dated-booking-allocations')).verifiedDatedCaptureEvidence(h.intent, h.provider),
}));

import { datedCheckoutMetadata, datedManifestHash, verifyDatedQuote, verifyDatedCheckout, allocateDatedCapture } from './dated-booking-quote';
import { fulfillQuotedKitchenBooking } from './booking-checkout-fulfillment';
import { decideAuthorizedBooking, answerPartialAcceptance, recoverPendingBookingDecisions, previewPartialAcceptance, LAST_MINUTE_MESSAGE } from './booking-payment-decision';
import { verifiedDatedCaptureEvidence, syncDatedPayment } from './dated-booking-allocations';
import { recoverUnboundDatedCheckouts, reconcileKitchenCheckout, registerKitchenCheckout, archiveExpiredDatedCheckout } from './kitchen-checkout-incidents';
import { assertLegacyBookingRefund } from './dated-booking-refund-guard';
let checkoutDatedBooking: typeof import('./dated-booking-checkout').checkoutDatedBooking;

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_in_memory_only');
  const legacy = readFileSync('migrations/0043_kitchen_booking_visits.sql', 'utf8');
  const body = legacy.slice(legacy.indexOf('CREATE OR REPLACE FUNCTION'), legacy.indexOf('DROP TRIGGER'));
  // Execute the actual 0099 allocation DDL, including its CHECKs, FK constraints and uniqueness.
  const cp1 = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const allocations = cp1.slice(cp1.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), cp1.indexOf('DROP TRIGGER'));
  const db = await createTestDatabase([s.users, s.locations, s.kitchens, s.equipmentListings, s.kitchenBookings, s.kitchenBookingVisits,
    s.equipmentBookings, s.storageBookings, s.paymentTransactions, s.kitchenCheckoutHolds, s.kitchenCheckoutIncidents, s.kitchenCancellationPolicies,
    s.platformSettings, s.bookingLifecycleEvents, s.emailLogs], [body, allocations,
      'CREATE UNIQUE INDEX cp4_payment_intent ON payment_transactions(payment_intent_id)',
      'CREATE UNIQUE INDEX cp4_incident ON kitchen_checkout_incidents(session_id)',
      'CREATE UNIQUE INDEX cp4_group_day ON kitchen_checkout_holds(group_id, operating_date)',
      'CREATE UNIQUE INDEX cp4_visit_block ON kitchen_booking_visits(booking_id, block_index)',
      'CREATE UNIQUE INDEX cp4_visit_date ON kitchen_booking_visits(booking_id, schedule_revision, visit_date)',
      'CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings FOR EACH ROW WHEN (NEW.schedule_revision = 0) EXECUTE FUNCTION create_kitchen_booking_visits()',
      readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
      'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()',
    ]);
  h.db = db.db; h.client = db.client;
  h.provider = { checkout: { sessions: { create: h.create, list: async () => ({ data: h.sessions, has_more: false }),
    retrieve: async (id: string) => ({ ...h.sessions.find(session => session.id === id), payment_intent: h.intent }) } },
    paymentIntents: { retrieve: async () => h.intent, cancel: h.cancel }, refunds: { list: async () => ({ data: [], has_more: false }),
      create: vi.fn(async (params: any) => ({ id: 're_cp4', status: 'succeeded', currency: 'cad', payment_intent: h.intent.id, amount: params.amount })) },
    charges: { retrieve: vi.fn() }, balanceTransactions: { retrieve: vi.fn() } };
  ({ checkoutDatedBooking } = await import('./dated-booking-checkout'));
}, 60_000);
afterAll(async () => { await h.client?.close(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  await h.client.exec('TRUNCATE kitchen_booking_day_allocations, equipment_bookings, storage_bookings, kitchen_booking_visits, kitchen_bookings, payment_transactions, kitchen_checkout_holds, kitchen_checkout_incidents, kitchen_cancellation_policies, platform_settings, kitchens, locations, users, equipment_listings, booking_lifecycle_events, email_logs RESTART IDENTITY CASCADE');
  h.closed.clear(); h.canBook = true; h.loseCreate = false; h.loseCapture = false; h.sessions = []; h.intent = null; h.capturedKeys.clear();
  h.create.mockReset(); h.capture.mockReset(); h.cancel.mockReset(); h.event.mockReset(); h.lazyExpire.mockReset();
  h.policy = { timezone: 'UTC', bookingBufferMinutes: 0, maxBookingDays: 14, allowMultiDayBookings: true, multidayCreationEnabled: true,
    defaultDailyBookingLimit: null, minimumBookingWindowHours: 1, weeklyChefHoursLimit: null };
  await h.db.insert(s.users).values([{ id: 2, username: 'manager@test.invalid', password: 'test', role: 'manager', stripeConnectAccountId: 'acct_cp4' },
    { id: 3, username: 'chef@test.invalid', password: 'test', role: 'chef' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Test', address: 'Test', timezone: 'UTC', taxRatePercent: null });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Test kitchen', hourlyRate: '1001', dailyRate: '7003', taxRatePercent: '15', listingStatus: 'active' });
  await h.db.insert(s.kitchenCancellationPolicies).values({ id: 8, kitchenId: 4, version: 1, status: 'published', noticeHours: 24, lateChargePercent: 50,
    tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], publishedBy: 2 });
  await h.db.insert(s.platformSettings).values({ key: 'platform_commission_rate', value: '0.07' });
  await h.db.insert(s.equipmentListings).values([{ id: 10, kitchenId: 4, category: 'cooking', equipmentType: 'Mixer', condition: 'good', sessionRate: '101', availabilityType: 'rental' },
    { id: 11, kitchenId: 4, category: 'cooking', equipmentType: 'Included oven', condition: 'good', availabilityType: 'included' }]);
  h.create.mockImplementation(async (params: any, options: any) => {
    // Saving the quote must precede the first provider call, including a lost response.
    const [head] = await h.db.select().from(s.kitchenCheckoutHolds).where(eq(s.kitchenCheckoutHolds.id, params.metadata.hold_id));
    expect(head?.quoteSnapshot?.hash).toBe(params.metadata.quote_hash);
    const previous = h.sessions.find(session => session.key === options.idempotencyKey);
    if (previous) return previous;
    const amount = params.line_items.reduce((sum: number, item: any) => sum + item.price_data.unit_amount, 0);
    h.intent = { id: `pi_${h.sessions.length}`, status: 'requires_capture', amount, amount_capturable: amount, amount_received: 0, capture_method: 'manual',
      currency: 'cad', metadata: params.payment_intent_data.metadata, latest_charge: null };
    const session = { id: `cs_${h.sessions.length}`, key: options.idempotencyKey, url: 'https://checkout.test.invalid',
      status: 'open', mode: 'payment', currency: 'cad', amount_total: amount, metadata: params.metadata, payment_intent: h.intent.id };
    h.sessions.push(session);
    if (h.loseCreate) throw Error('lost checkout response');
    return session;
  });
  h.capture.mockImplementation(async (_id: string, amount: number, _fee: unknown, key: string) => {
    const [source] = await h.db.select().from(s.paymentTransactions);
    expect(source.payoutPartition).toBe('per_day'); expect(source.payoutTiming).toBe('after_closeout');
    // A chef-accepted new total captures less than the hold; never more.
    expect(amount).toBeLessThanOrEqual(h.intent.amount);
    h.capturedKeys.add(key); h.intent.status = 'succeeded'; h.intent.amount_received = amount; h.intent.amount_capturable = 0;
    if (h.loseCapture) throw Error('lost capture response');
  });
  h.cancel.mockImplementation(async () => { h.intent.status = 'canceled'; h.intent.amount_received = 0; return h.intent; });
});

const day = (date: string, equipmentIds: number[] = [10, 11]) => ({ date, pricingMode: 'hourly' as const, slots: hours(10, 12), equipmentIds });
const input = (days: any[] = [day('2099-10-05'), { date: '2099-10-07', pricingMode: 'daily', equipmentIds: [10] }]) => ({ kitchenId: 4, days,
  cancellationPolicyAccepted: true, cancellationPolicyVersion: 1, cancellationDisclosureVersion: DATED_DISCLOSURE_VERSION });
const checkout = (days?: any[]) => checkoutDatedBooking(3, input(days), 'https://test.invalid');
async function authorized() { await checkout(); h.sessions[0].status = 'complete'; return h.sessions[0]; }
async function fulfill() { const session = await authorized(); return (await fulfillQuotedKitchenBooking(session, h.intent, h.provider))!; }
const quote = async () => (await h.db.select().from(s.kitchenCheckoutHolds)).find((row: any) => row.quoteSnapshot)?.quoteSnapshot;
const rows = (table: any) => h.db.select().from(table);
function balance(fee = 317) {
  const charge = { id: 'ch_cp4', payment_intent: h.intent.id, paid: true, captured: true, currency: 'cad', amount_captured: h.intent.amount,
    balance_transaction: { id: 'txn_cp4', source: 'ch_cp4', currency: 'cad', amount: h.intent.amount, fee, net: h.intent.amount - fee,
      fee_details: [{ type: 'stripe_fee', amount: fee, currency: 'cad' }] } };
  h.intent.latest_charge = charge; return charge;
}

describe('CP4 dated quote and authorization', () => {
  it('charges the kitchen 15% tax when the location rate is NULL', async () => {
    await h.db.update(s.kitchens).set({ taxRatePercent: '15' });
    await h.db.update(s.locations).set({ taxRatePercent: null });
    await checkout();
    expect((await quote()).manifest).toMatchObject({ taxRatePercent: 15, subtotalCents: 9207, taxCents: 1381 });
  });
  it('splits service fees by manager gross like cancellation sourceComponents: 11349/12421 -> 795/869', async () => {
    await checkout(); const m = (await quote()).manifest;
    const components = [11349, 12421].map((subtotalCents, sessionIndex) => ({ visitId: sessionIndex + 1, sessionIndex,
      componentKey: 'kitchen', kind: 'kitchen' as const, bookingId: 1, subtotalCents }));
    const allocations = allocateDatedCapture(components, { ...m, subtotalCents: 23770, taxCents: 3566, serviceFeeCents: 1664, totalCents: 29000 }, 317);
    const shares = allocations.map(row => row.serviceFeeCents);
    expect(shares).toEqual([795, 869]);
    expect(shares).toEqual(allocateCents(1664, allocations.map(row => row.managerGrossCents)));
  });
  it('prices mixed hourly/daily days and equipment once per day, including free items; aggregate fees are computed once', async () => {
    await checkout(); const q = await quote(), m = q.manifest;
    expect(m.days.map((day: any) => [day.kitchenCents, day.equipment.map((item: any) => item.cents)])).toEqual([[2002, [101, 0]], [7003, [101]]]);
    expect(m).toMatchObject({ subtotalCents: 9207, taxCents: 1381, serviceFeeCents: 644, totalCents: 11232 });
    expect(m.policy).toMatchObject({ deadlineBasis: 'booking_first_day', disclosureVersion: DATED_DISCLOSURE_VERSION,
      sessions: [{ startAt: '2099-10-05T10:00:00.000Z' }, { startAt: '2099-10-07T08:00:00.000Z' }] });
    expect(verifyDatedQuote(JSON.parse(JSON.stringify(q)))).toEqual(q);
    const params = h.create.mock.calls[0][0];
    expect(params.payment_intent_data.capture_method).toBe('manual');
    // The card is saved to a customer for later off-session charges (extra time, overstay), as single-day checkout does.
    expect(params).toMatchObject({ customer_creation: 'always', payment_intent_data: { setup_future_usage: 'off_session' } });
    expect(params).not.toHaveProperty('transfer_data'); expect(params.payment_intent_data).not.toHaveProperty('application_fee_amount');
    expect(await rows(s.kitchenBookings)).toHaveLength(0);
  });
  it('keeps metadata constant size for 14 days and every value below Stripe’s 500-character limit', async () => {
    await checkout(Array.from({ length: 14 }, (_, i) => day(`2099-10-${String(5 + i).padStart(2, '0')}`)));
    const meta = datedCheckoutMetadata(await quote());
    expect(Object.values(meta).every(value => value.length <= 500)).toBe(true);
    expect(JSON.stringify(meta).length).toBeLessThan(500);
    expect(meta).not.toHaveProperty('days'); expect(meta).not.toHaveProperty('selected_slots'); expect(meta).not.toHaveProperty('addon_prices');
    expect(h.create.mock.calls[0][0].line_items.length).toBeLessThanOrEqual(30);
  });
  it('gates even a one-day dated contract and requires its specific disclosure', async () => {
    h.policy.multidayCreationEnabled = false;
    await expect(checkout([day('2099-10-05')])).rejects.toMatchObject({ body: { code: 'MULTIDAY_DISABLED' } });
    h.policy.multidayCreationEnabled = true;
    await expect(checkoutDatedBooking(3, { ...input(), cancellationDisclosureVersion: 'food-corridor-v3' }, 'https://test.invalid')).rejects.toThrow('whole-booking');
    expect(h.create).not.toHaveBeenCalled();
  });
  it('refuses duplicate, foreign and noninteger-priced equipment before creating a session', async () => {
    await expect(checkout([day('2099-10-05', [10, 10])])).rejects.toThrow('once');
    await expect(checkout([day('2099-10-05', [99])])).rejects.toThrow('equipment');
    await h.db.update(s.equipmentListings).set({ sessionRate: '100.5' }).where(eq(s.equipmentListings.id, 10));
    await expect(checkout()).rejects.toThrow('cents'); expect(h.create).not.toHaveBeenCalled();
  });
  it('has deterministic hashing through JSONB key reordering and rejects every tampered component/aggregate', async () => {
    await checkout(); const q = await quote();
    expect(datedManifestHash(Object.fromEntries(Object.entries(q.manifest).reverse()) as any)).toBe(q.hash);
    for (const mutate of [(m: any) => m.days[0].kitchenCents++, (m: any) => m.taxCents++, (m: any) => m.serviceFeeCents++, (m: any) => m.days[0].equipment[0].cents++]) {
      const bad = structuredClone(q); mutate(bad.manifest); expect(() => verifyDatedQuote(bad)).toThrow();
      bad.hash = datedManifestHash(bad.manifest); expect(() => verifyDatedQuote(bad)).toThrow();
    }
  });
});

describe('Partial acceptance: the chef approves the new total before any capture (owner, Oct 17)', () => {
  // Mixer on the daily second day (101 cents) declined: 9106 accepted -> tax 1366, fee half-up 644*9106/9207 = 637 -> 11109.
  async function propose(listingId = 10, date = '2099-10-07') {
    const id = await fulfill();
    const visits = await rows(s.kitchenBookingVisits), items = await rows(s.equipmentBookings);
    const visit = visits.find((row: any) => row.visitDate === date);
    const item = items.find((row: any) => row.kitchenBookingVisitId === visit.id && row.equipmentListingId === listingId);
    const result: any = await decideAuthorizedBooking(id, 'confirmed', [], [{ equipmentBookingId: item.id, action: 'cancelled' }], 2);
    return { id, item, proposal: result.proposal };
  }
  function partialCharge(amount: number, fee = 352) {
    h.intent.latest_charge = { id: 'ch_pa', payment_intent: h.intent.id, paid: true, captured: true, currency: 'cad', amount_captured: amount,
      balance_transaction: { id: 'txn_pa', source: 'ch_pa', currency: 'cad', amount, fee, net: amount - fee, fee_details: [{ type: 'stripe_fee', amount: fee, currency: 'cad' }] } };
  }
  const expire = (id: number) => decideAuthorizedBooking(id, 'cancelled', [], [], undefined, undefined, { proposalOutcome: 'expired' });

  it('saves a proposal instead of capturing: hold, days and pending state stay; the chef is asked', async () => {
    const { id, item, proposal } = await propose();
    expect(h.capture).not.toHaveBeenCalled(); expect(h.cancel).not.toHaveBeenCalled();
    const [booking] = await rows(s.kitchenBookings);
    expect(booking).toMatchObject({ status: 'pending', paymentStatus: 'authorized', paymentDecision: null });
    expect(booking.partialAcceptance).toMatchObject({ id: proposal.id, state: 'waiting', actorId: 2, oldTotalCents: 11232, newTotalCents: 11109,
      declined: [{ id: item.id, name: 'Mixer', cents: 101, date: '2099-10-07' }] });
    // 24 h after the proposal (the booking is far away, so the refund-deadline cap does not apply).
    expect(Date.parse(booking.partialAcceptance.deadlineAt) - Date.parse(booking.partialAcceptance.proposedAt)).toBe(24 * 3_600_000);
    expect(h.event).toHaveBeenCalledWith(expect.anything(), id, 'partial_acceptance_proposed', expect.any(String), expect.any(String), 2,
      expect.objectContaining({ recipientPolicy: 'chef', partialAcceptance: expect.objectContaining({ variant: 'proposed', newCents: 11109, oldCents: 11232,
        items: [{ name: 'Mixer', date: '2099-10-07' }] }) }));
    expect((await rows(s.equipmentBookings)).every((row: any) => row.status === 'pending')).toBe(true);
    // The kitchen cannot change or re-confirm it while it waits.
    await expect(decideAuthorizedBooking(id, 'confirmed', [], [], 2)).rejects.toThrow('Waiting for the chef');
  });
  it('chef accepts: captures exactly the new total, excludes the declined item from every allocation and conserves the source', async () => {
    const { id, item, proposal } = await propose();
    partialCharge(11109);
    await answerPartialAcceptance(id, proposal.id, 'accept', 3);
    expect(h.capture).toHaveBeenCalledOnce();
    expect(h.capture).toHaveBeenCalledWith(h.intent.id, 11109, undefined, expect.stringMatching(/^booking-decision:/));
    const allocations = await rows(s.kitchenBookingDayAllocations);
    expect(allocations).toHaveLength(4);
    expect(allocations.some((row: any) => row.componentKey === `equipment:${item.id}`)).toBe(false);
    expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(11109);
    expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents, 0)).toBe(9106);
    expect(allocations.reduce((sum: number, row: any) => sum + row.stripeFeeCents, 0)).toBe(352);
    const [source] = await rows(s.paymentTransactions), [booking] = await rows(s.kitchenBookings);
    expect(source).toMatchObject({ amount: '11109', taxAmount: '1366', serviceFee: '637', status: 'succeeded', managerRevenue: String(11109 - 637 - 352) });
    expect(booking).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', totalPrice: '9106', partialAcceptance: { state: 'accepted', answeredBy: 3 } });
    expect((await rows(s.equipmentBookings)).find((row: any) => row.id === item.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    expect(h.event).toHaveBeenCalledWith(expect.anything(), id, 'confirmed', expect.any(String), expect.any(String), 2, expect.anything());
    // Replays (a retried answer, the recovery worker, a duplicate capture webhook) never capture again.
    await expect(answerPartialAcceptance(id, proposal.id, 'accept', 3)).resolves.toMatchObject({ recovered: true });
    await recoverPendingBookingDecisions();
    await syncDatedPayment(h.intent.id);
    expect(h.capture).toHaveBeenCalledOnce(); expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(4);
    await expect(answerPartialAcceptance(id, proposal.id, 'decline', 3)).rejects.toThrow('already answered');
  });
  // Owner (Oct 19): a multi-day request can be accepted for some days; the chef approves exactly as for an add-on.
  async function proposeDays(dates: string[]) {
    const id = await fulfill();
    const visits = await rows(s.kitchenBookingVisits);
    const visitIds = visits.filter((row: any) => dates.includes(row.visitDate)).map((row: any) => row.id);
    const preview = await previewPartialAcceptance(id, [], new Date(), visitIds);
    const result: any = await decideAuthorizedBooking(id, 'confirmed', [], [], 2, undefined, { declinedVisitIds: visitIds });
    return { id, visitIds, preview, proposal: result.proposal };
  }
  it('days: declining Wed (with its Mixer) proposes the Monday-only total, exactly as previewed; nothing is captured yet', async () => {
    const { id, visitIds, preview, proposal } = await proposeDays(['2099-10-07']);
    expect(h.capture).not.toHaveBeenCalled();
    // Kept: Monday 2002 + its Mixer 101 + the included oven 0 = 2103 before tax and fee.
    expect(preview).toMatchObject({ oldTotalCents: 11232, subtotalCents: 2103, allowed: true });
    expect(proposal).toMatchObject({ oldTotalCents: 11232, newTotalCents: preview.newTotalCents, declinedVisitIds: visitIds,
      declinedDays: [{ visitId: visitIds[0], date: '2099-10-07', cents: 7003 }], declined: [] });
    expect(h.event).toHaveBeenCalledWith(expect.anything(), id, 'partial_acceptance_proposed', expect.any(String),
      expect.stringContaining('but not on Wed, Oct 7'), 2, expect.anything());
    const [booking] = await rows(s.kitchenBookings);
    expect(booking).toMatchObject({ status: 'pending', paymentStatus: 'authorized', paymentDecision: null });
    expect((await rows(s.kitchenBookingVisits)).every((row: any) => row.scheduleState === 'active')).toBe(true);
  });
  it('days: the chef accepts -> captures the new total; only Monday is booked, allocated and in the policy sessions', async () => {
    const { id, visitIds, proposal } = await proposeDays(['2099-10-07']);
    partialCharge(proposal.newTotalCents, 80);
    await answerPartialAcceptance(id, proposal.id, 'accept', 3);
    expect(h.capture).toHaveBeenCalledWith(h.intent.id, proposal.newTotalCents, undefined, expect.stringMatching(/^booking-decision:/));
    const allocations = await rows(s.kitchenBookingDayAllocations);
    expect(allocations.every((row: any) => row.visitId !== visitIds[0] && row.evidence.sessionIndex === 0)).toBe(true);
    expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(proposal.newTotalCents);
    expect(allocations.reduce((sum: number, row: any) => sum + row.stripeFeeCents, 0)).toBe(80);
    const visits = await rows(s.kitchenBookingVisits), [booking] = await rows(s.kitchenBookings);
    expect(visits.find((row: any) => row.id === visitIds[0])).toMatchObject({ scheduleState: 'cancelled', cancellationPlan: { mode: 'declined_at_acceptance' } });
    expect(booking).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', totalPrice: '2103', partialAcceptance: { state: 'accepted' } });
    expect(booking.cancellationPolicySnapshot.sessions).toEqual([{ startAt: '2099-10-05T10:00:00.000Z' }]);
    expect((booking.selectedSlots as any[]).every(slot => slot.date !== '2099-10-07')).toBe(true);
    const wednesdayItems = (await rows(s.equipmentBookings)).filter((row: any) => row.kitchenBookingVisitId === visitIds[0]);
    expect(wednesdayItems.every((row: any) => row.status === 'cancelled' && row.paymentStatus === 'failed')).toBe(true);
    // Replays never capture again or shorten the sessions twice.
    await recoverPendingBookingDecisions(); await syncDatedPayment(h.intent.id);
    expect(h.capture).toHaveBeenCalledOnce();
    expect((await rows(s.kitchenBookings))[0].cancellationPolicySnapshot.sessions).toHaveLength(1);
  });
  it('days: declining the first day moves the one refund deadline to the first day the chef keeps', async () => {
    const { id, proposal } = await proposeDays(['2099-10-05']);
    partialCharge(proposal.newTotalCents, 210);
    await answerPartialAcceptance(id, proposal.id, 'accept', 3);
    const [booking] = await rows(s.kitchenBookings), allocations = await rows(s.kitchenBookingDayAllocations);
    expect(booking.cancellationPolicySnapshot.sessions).toEqual([{ startAt: '2099-10-07T08:00:00.000Z' }]);
    expect(allocations.every((row: any) => row.evidence.sessionIndex === 0)).toBe(true);
  });
  it('days: at least one day must stay, and a day must belong to the request', async () => {
    const id = await fulfill();
    const visits = await rows(s.kitchenBookingVisits);
    await expect(decideAuthorizedBooking(id, 'confirmed', [], [], 2, undefined, { declinedVisitIds: visits.map((row: any) => row.id) }))
      .rejects.toThrow('Keep at least one day');
    await expect(decideAuthorizedBooking(id, 'confirmed', [], [], 2, undefined, { declinedVisitIds: [999] })).rejects.toThrow('refresh');
    expect(h.capture).not.toHaveBeenCalled();
  });
  it('a declined included (free) item still asks the chef; accepting keeps the full total', async () => {
    const { id, proposal } = await propose(11, '2099-10-05');
    expect(proposal).toMatchObject({ oldTotalCents: 11232, newTotalCents: 11232 });
    partialCharge(11232);
    await answerPartialAcceptance(id, proposal.id, 'accept', 3);
    expect(h.capture).toHaveBeenCalledWith(h.intent.id, 11232, undefined, expect.any(String));
    expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(4);
  });
  it('chef declines: the whole hold is released, the request closes and both sides plus admins are told', async () => {
    const { id, proposal } = await propose();
    await answerPartialAcceptance(id, proposal.id, 'decline', 3);
    expect(h.capture).not.toHaveBeenCalled(); expect(h.cancel).toHaveBeenCalledOnce();
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', paymentStatus: 'failed', partialAcceptance: { state: 'declined', answeredBy: 3 } });
    // 'cancelled' is an admin-tracked kind: chef, kitchen and all admins (email only to toggle-on admins) are notified.
    expect(h.event).toHaveBeenLastCalledWith(expect.anything(), id, 'cancelled', 'New total declined', expect.any(String), 3,
      expect.objectContaining({ partialAcceptance: expect.objectContaining({ variant: 'declined' }) }));
    await expect(answerPartialAcceptance(id, proposal.id, 'accept', 3)).rejects.toThrow('already answered');
  });
  it('no answer by the deadline: a late accept is refused and the expiry releases the whole hold', async () => {
    const { id, proposal } = await propose();
    await h.db.update(s.kitchenBookings).set({ partialAcceptance: { ...proposal, deadlineAt: new Date(Date.now() - 1000).toISOString() } });
    await expect(answerPartialAcceptance(id, proposal.id, 'accept', 3)).rejects.toThrow('time to answer has passed');
    expect(h.lazyExpire).toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled();
    await expire(id);
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', paymentStatus: 'failed', partialAcceptance: { state: 'expired' } });
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.event).toHaveBeenLastCalledWith(expect.anything(), id, 'cancelled', 'Request closed', expect.any(String), undefined,
      expect.objectContaining({ partialAcceptance: expect.objectContaining({ variant: 'expired' }) }));
  });
  it('the kitchen withdraws (declines the request): the chef can no longer accept', async () => {
    const { id, proposal } = await propose();
    await decideAuthorizedBooking(id, 'cancelled', [], [], 2);
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', partialAcceptance: { state: 'withdrawn' } });
    await expect(answerPartialAcceptance(id, proposal.id, 'accept', 3)).rejects.toThrow('already answered');
    expect(h.capture).not.toHaveBeenCalled();
  });
  it.each([['kitchen withdraw', (id: number) => decideAuthorizedBooking(id, 'cancelled', [], [], 2)], ['expiry', expire]] as const)(
    'race: chef accept vs %s — exactly one decision and one Stripe call', async (_name, other) => {
      const { id, proposal } = await propose();
      partialCharge(11109);
      const results = await Promise.allSettled([answerPartialAcceptance(id, proposal.id, 'accept', 3), other(id)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const [booking] = await rows(s.kitchenBookings);
      expect(h.capture.mock.calls.length + h.cancel.mock.calls.length).toBe(1);
      expect(booking.partialAcceptance.state).toBe(booking.status === 'confirmed' ? 'accepted' : _name === 'expiry' ? 'expired' : 'withdrawn');
    });
  it('the card hold ended at the card network: accepting closes the request without charging, as "hold ended" (not "didn’t answer")', async () => {
    const { id, proposal } = await propose();
    h.intent.status = 'canceled';
    await expect(answerPartialAcceptance(id, proposal.id, 'accept', 3)).rejects.toThrow('The card hold ended before the booking could be confirmed');
    expect(h.capture).not.toHaveBeenCalled();
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', partialAcceptance: { state: 'hold_ended' } });
    expect(h.event).toHaveBeenLastCalledWith(expect.anything(), id, 'cancelled', 'Request closed',
      'The card hold ended before the booking could be confirmed. Nothing was charged.', undefined,
      expect.objectContaining({ partialAcceptance: expect.objectContaining({ variant: 'hold_ended' }) }));
  });
  it('the kitchen’s preview is the exact amount the proposal saves and the capture takes (dated, frozen quote)', async () => {
    const id = await fulfill();
    const visits = await rows(s.kitchenBookingVisits), items = await rows(s.equipmentBookings);
    const mixer = items.find((row: any) => row.equipmentListingId === 10 && row.kitchenBookingVisitId === visits.find((v: any) => v.visitDate === '2099-10-07').id);
    const preview = await previewPartialAcceptance(id, [mixer.id]);
    expect(preview).toMatchObject({ oldTotalCents: 11232, newTotalCents: 11109, subtotalCents: 9106, taxCents: 1366, serviceFeeCents: 637, allowed: true });
    const result: any = await decideAuthorizedBooking(id, 'confirmed', [], [{ equipmentBookingId: mixer.id, action: 'cancelled' }], 2);
    expect(result.proposal.newTotalCents).toBe(preview.newTotalCents);
    expect(result.proposal).not.toHaveProperty('actorId');
    partialCharge(11109);
    await answerPartialAcceptance(id, result.proposal.id, 'accept', 3);
    expect(h.capture).toHaveBeenCalledWith(h.intent.id, preview.newTotalCents, undefined, expect.any(String));
    expect(h.create).toHaveBeenCalledOnce();
  });
  it('review example: 24 h free cancellation and first start in 25 h 20 min leaves 20 min, so the offer is refused (409), never a full 24 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2099-10-04T08:40:00Z'));   // first day 2099-10-05 10:00Z = 25 h 20 min away
      const id = await fulfill(), items = await rows(s.equipmentBookings);
      expect((await previewPartialAcceptance(id, [items[0].id])).allowed).toBe(false);
      await expect(decideAuthorizedBooking(id, 'confirmed', [], [{ equipmentBookingId: items[0].id, action: 'cancelled' }], 2))
        .rejects.toMatchObject({ status: 409, message: LAST_MINUTE_MESSAGE });
      expect((await rows(s.kitchenBookings))[0].partialAcceptance).toBeNull();
      expect(h.capture).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('refuses to answer someone else’s or an unknown proposal', async () => {
    const { id } = await propose();
    await expect(answerPartialAcceptance(id, '00000000-0000-4000-8000-000000000000', 'accept', 3)).rejects.toThrow('no longer open');
    expect(h.capture).not.toHaveBeenCalled();
  });
});

describe('CP4 atomic fulfillment and manifest recovery', () => {
  it('a pending dated request gets kitchen reminders from its frozen first day (no visit clock needed; live webhook failed here, Oct 18)', async () => {
    await fulfill();
    const [booking] = await rows(s.kitchenBookings);
    expect(booking).toMatchObject({ status: 'pending', paymentStatus: 'authorized' });
    expect(booking.scheduleRevision).toBeGreaterThan(0);
    const { currentManagerDecisionReminders } = await import('./manager-decision-reminders');
    const reminders = await currentManagerDecisionReminders(h.db, booking.id, new Date(booking.createdAt));
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders[0].start).toBe(booking.cancellationPolicySnapshot.sessions[0].startAt);
  });
  it('serializes simultaneous webhook fulfillment and creates only one booking/source', async () => {
    const session = await authorized();
    const ids = await Promise.all([fulfillQuotedKitchenBooking(session, h.intent, h.provider), fulfillQuotedKitchenBooking(session, h.intent, h.provider)]);
    expect(ids[0]).toBe(ids[1]); expect(await rows(s.kitchenBookings)).toHaveLength(1); expect(await rows(s.paymentTransactions)).toHaveLength(1);
  });
  it('creates one booking, N dated visits, per-day equipment with real instants, source and incident together; replay returns the same booking', async () => {
    const id = await fulfill();
    const [parent] = await rows(s.kitchenBookings), visits = await rows(s.kitchenBookingVisits), items = await rows(s.equipmentBookings), [source] = await rows(s.paymentTransactions);
    expect(parent).toMatchObject({ scheduleRevision: 1, durationHours: '10', totalPrice: '9207', paymentStatus: 'authorized' });
    expect(visits.map((v: any) => v.visitDate)).toEqual(['2099-10-05', '2099-10-07']); expect(items).toHaveLength(3);
    expect(items.map((item: any) => item.kitchenBookingVisitId)).toEqual([visits[0].id, visits[0].id, visits[1].id]);
    expect(items[0].startDate.toISOString()).toBe('2099-10-05T10:00:00.000Z'); expect(items[2].endDate.toISOString()).toBe('2099-10-07T16:00:00.000Z');
    expect(source).toMatchObject({ amount: '11232', payoutPartition: 'per_day', payoutTiming: 'after_closeout' });
    expect((await rows(s.kitchenCheckoutIncidents))[0]).toMatchObject({ bookingId: id, outcome: 'booking_created' });
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
    expect(await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider)).toBe(id); expect(await rows(s.paymentTransactions)).toHaveLength(1);
    expect(h.event).toHaveBeenCalledOnce();
  });
  it('rolls all booking/visit/equipment/payment writes back if the outbox cannot commit', async () => {
    const session = await authorized(); h.event.mockRejectedValueOnce(Error('outbox unavailable'));
    await expect(fulfillQuotedKitchenBooking(session, h.intent, h.provider)).rejects.toThrow('outbox');
    for (const table of [s.kitchenBookings, s.kitchenBookingVisits, s.equipmentBookings, s.paymentTransactions]) expect(await rows(table)).toHaveLength(0);
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(2);
    expect(await fulfillQuotedKitchenBooking(session, h.intent, h.provider)).toBeTypeOf('number');
  });
  it('revalidates every day under locks and releases the entire authorization if a later day closes', async () => {
    const session = await authorized(); h.closed.add('2099-10-07');
    expect(await fulfillQuotedKitchenBooking(session, h.intent, h.provider)).toBeNull();
    expect(h.cancel).toHaveBeenCalledOnce(); expect(await rows(s.kitchenBookings)).toHaveLength(0); expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
    expect(await fulfillQuotedKitchenBooking(session, h.intent, h.provider)).toBeNull(); expect(h.cancel).toHaveBeenCalledOnce();
  });
  it('compensates the entire authorization when an active group is missing a quoted day', async () => {
    const session = await authorized();
    await h.db.delete(s.kitchenCheckoutHolds).where(eq(s.kitchenCheckoutHolds.operatingDate, '2099-10-07'));
    expect(await fulfillQuotedKitchenBooking(session, h.intent, h.provider)).toBeNull();
    expect(h.cancel).toHaveBeenCalledOnce(); expect(await rows(s.kitchenBookings)).toHaveLength(0);
  });
  it('recovers from expired/deleted hold rows using the incident manifest, keeping quoted rates after a listing edit and gate shutdown', async () => {
    const session = await authorized(); await h.db.delete(s.kitchenCheckoutHolds);
    await h.db.update(s.equipmentListings).set({ sessionRate: '99999' }); await h.db.update(s.kitchens).set({ hourlyRate: '88888' });
    h.policy.multidayCreationEnabled = false;
    expect(await reconcileKitchenCheckout(session.id, h.provider)).toBeTypeOf('number');
    expect((await rows(s.kitchenBookings))[0].totalPrice).toBe('9207'); expect((await rows(s.equipmentBookings))[0].totalPrice).toBe('101');
  });
  it('compensates an expired checkout if its capacity was taken; it never falls into legacy reconstruction', async () => {
    const session = await authorized(); await h.db.delete(s.kitchenCheckoutHolds);
    await h.db.insert(s.kitchenBookings).values({ kitchenId: 4, chefId: 7, bookingDate: new Date('2099-10-07T12:00Z'), startTime: '10:00', endTime: '12:00',
      operatingWindowStartTime: '08:00', selectedSlots: hours(10, 12), status: 'confirmed' });
    expect(await fulfillQuotedKitchenBooking(session, h.intent, h.provider)).toBeNull(); expect(h.cancel).toHaveBeenCalledOnce();
    expect(await rows(s.kitchenBookings)).toHaveLength(1); expect(await rows(s.paymentTransactions)).toHaveLength(0);
  });
  it.each(['quote_hash', 'chef_id', 'kitchen_id', 'booking_price_cents', 'booking_contract'])('rejects %s mismatch before writing or operating on money', async key => {
    const session = await authorized(); session.metadata = { ...session.metadata, [key]: 'incorrect' };
    await expect(fulfillQuotedKitchenBooking(session, h.intent, h.provider)).rejects.toThrow();
    expect(await rows(s.kitchenBookings)).toHaveLength(0); expect(h.cancel).not.toHaveBeenCalled();
  });
  it('rejects wrong session PI, currency and under-authorization', async () => {
    const session = await authorized(), q = await quote();
    for (const altered of [{ ...session, payment_intent: 'pi_other' }, { ...session, currency: 'usd' }]) expect(() => verifyDatedCheckout(q, altered, h.intent)).toThrow();
    expect(() => verifyDatedCheckout(q, session, { ...h.intent, amount_capturable: h.intent.amount - 1 })).toThrow();
  });
  it('recovers a lost provider-create response by head metadata and archives its manifest before removing holds', async () => {
    h.loseCreate = true; await expect(checkout()).rejects.toThrow('lost checkout');
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(2); expect(await rows(s.kitchenCheckoutIncidents)).toHaveLength(0);
    h.sessions[0].status = 'complete';
    await h.db.update(s.kitchenCheckoutHolds).set({ expiresAt: new Date(Date.now() - 1000) });
    await recoverUnboundDatedCheckouts(h.provider);
    expect(await rows(s.kitchenBookings)).toHaveLength(1); expect((await rows(s.kitchenCheckoutIncidents))[0].quoteSnapshot.hash).toBe(h.sessions[0].metadata.quote_hash);
    expect(h.create).toHaveBeenCalledOnce();
  });
  it('fulfills a verified webhook that arrives before session binding or its provider response', async () => {
    h.loseCreate = true; await expect(checkout()).rejects.toThrow('lost checkout');
    h.sessions[0].status = 'complete';
    expect(await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider)).toBeTypeOf('number');
    expect(await rows(s.kitchenBookings)).toHaveLength(1); expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
  });
  it('archives the quote when a session expires before its create response/binding was recorded', async () => {
    h.loseCreate = true; await expect(checkout()).rejects.toThrow(); h.sessions[0].status = 'expired';
    await archiveExpiredDatedCheckout(h.sessions[0]);
    expect((await rows(s.kitchenCheckoutIncidents))[0]).toMatchObject({ outcome: 'closed', quoteSnapshot: { hash: h.sessions[0].metadata.quote_hash } });
  });
  it('never loses an unbound manifest when provider discovery is incomplete', async () => {
    h.loseCreate = true; await expect(checkout()).rejects.toThrow();
    await h.db.update(s.kitchenCheckoutHolds).set({ expiresAt: new Date(Date.now() - 1000) });
    const provider = { ...h.provider, checkout: { sessions: { list: async () => ({ data: [], has_more: true }) } } };
    await recoverUnboundDatedCheckouts(provider as any); expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(2);
  });
  it.each(['incomplete page', 'ambiguous matches', 'provider error', 'invalid quote', 'wrong metadata'])('archives %s once for support and stops automatic discovery', async failure => {
    h.loseCreate = true; await expect(checkout()).rejects.toThrow();
    await h.db.update(s.kitchenCheckoutHolds).set({ expiresAt: new Date(0) });
    const q = await quote();
    if (failure === 'invalid quote') await h.db.update(s.kitchenCheckoutHolds).set({ quoteSnapshot: { ...q, hash: 'bad' } }).where(eq(s.kitchenCheckoutHolds.id, q.manifest.headId));
    const list = vi.fn(async () => {
      if (failure === 'provider error') throw Error('provider unavailable');
      if (failure === 'wrong metadata') return { data: [{ ...h.sessions[0], metadata: { ...h.sessions[0].metadata, quote_hash: 'bad' } }], has_more: false };
      return { data: failure === 'ambiguous matches' ? [h.sessions[0], h.sessions[0]] : [], has_more: failure === 'incomplete page' };
    });
    const provider = { ...h.provider, checkout: { sessions: { list } } };
    await recoverUnboundDatedCheckouts(provider as any);
    const [incident] = await rows(s.kitchenCheckoutIncidents);
    expect(incident).toMatchObject({ sessionId: `unbound:${q.manifest.headId}`, outcome: 'needs_support', quoteSnapshot: expect.any(Object) });
    const attempts = list.mock.calls.length;
    await recoverUnboundDatedCheckouts(provider as any);
    expect(list).toHaveBeenCalledTimes(attempts); expect(await rows(s.kitchenCheckoutIncidents)).toHaveLength(1);
  });
  it('rechecks all dates when acceptance of the replaced request wins before fulfillment', async () => {
    const [old] = await h.db.insert(s.kitchenBookings).values({ chefId: 3, kitchenId: 4, bookingDate: new Date('2099-10-05T12:00Z'),
      startTime: '10:00', endTime: '12:00', operatingWindowStartTime: '08:00', selectedSlots: hours(10, 12), status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_old' }).returning();
    await checkoutDatedBooking(3, { ...input(), replacesBookingId: old.id }, 'https://test.invalid'); h.sessions[0].status = 'complete';
    await h.db.update(s.kitchenBookings).set({ status: 'confirmed', paymentStatus: 'paid' }).where(eq(s.kitchenBookings.id, old.id));
    expect(await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider)).toBeNull();
    expect(h.cancel).toHaveBeenCalledOnce(); expect(await rows(s.kitchenBookings)).toHaveLength(1); expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
  });
  it('archives an expired unbound head when the complete provider window has no session', async () => {
    h.loseCreate = true; await expect(checkout()).rejects.toThrow(); h.sessions = [];
    await h.db.update(s.kitchenCheckoutHolds).set({ expiresAt: new Date(Date.now() - 1000) });
    await recoverUnboundDatedCheckouts(h.provider);
    expect((await rows(s.kitchenCheckoutIncidents))[0]).toMatchObject({ outcome: 'closed', quoteSnapshot: { manifest: { contract: 'kitchen-days-v1' } } });
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
  });
  it('fills a missing incident quote exactly once when a result-page read won the bind race', async () => {
    const session = await authorized(), q = await quote();
    await h.db.update(s.kitchenCheckoutIncidents).set({ quoteSnapshot: null });
    await registerKitchenCheckout(session.id, 3, 4, '2099-10-05', q);
    await registerKitchenCheckout(session.id, 3, 4, '2099-10-05', { different: true });
    expect((await rows(s.kitchenCheckoutIncidents))[0].quoteSnapshot.hash).toBe(q.hash);
  });
});

describe('CP4 all-or-nothing capture and actual day allocations', () => {
  it('no-ops delayed charge.updated evidence after every dated day was declined', async () => {
    const id = await fulfill(); await decideAuthorizedBooking(id, 'cancelled');
    await expect(syncDatedPayment(h.intent.id)).resolves.toBeUndefined();
    expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(0);
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
  });
  it.each(['revision', 'per_day'])('direct refund guard resolves parent, source and separately charged equipment for %s', async kind => {
    const id = await fulfill(); await decideAuthorizedBooking(id, 'confirmed');
    if (kind === 'revision') await h.db.update(s.paymentTransactions).set({ payoutPartition: null });
    else await h.db.update(s.kitchenBookings).set({ scheduleRevision: 0 });
    const [item] = await rows(s.equipmentBookings);
    const [addon] = await h.db.insert(s.paymentTransactions).values({ bookingId: item.id, bookingType: 'equipment', paymentIntentId: 'pi_separate',
      chefId: 3, managerId: 2, amount: '101', baseAmount: '101', serviceFee: '0', managerRevenue: '101', netAmount: '101', currency: 'CAD', status: 'succeeded' }).returning();
    for (const target of [{ bookingId: id }, { paymentIntentId: h.intent.id }, { paymentTransactionId: addon.id }, { paymentIntentId: 'pi_separate' }])
      await expect(assertLegacyBookingRefund(target, h.db)).rejects.toThrow('made per day');
    await h.db.update(s.kitchenBookings).set({ scheduleRevision: 0 }); await h.db.update(s.paymentTransactions).set({ payoutPartition: null });
    await expect(assertLegacyBookingRefund({ paymentTransactionId: addon.id }, h.db)).resolves.toBeUndefined();
  });
  it.each(['requires_capture', 'requires_payment_method', 'canceled'])('no-ops dated charge.updated evidence before capture (%s), even without a source', async status => {
    await authorized(); h.intent.status = status;
    await expect(syncDatedPayment(h.intent.id)).resolves.toBeUndefined();
    expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(0);
  });
  it('still retries a succeeded dated payment whose source is missing', async () => {
    await authorized(); h.intent.status = 'succeeded'; h.intent.amount_received = h.intent.amount;
    await expect(syncDatedPayment(h.intent.id)).rejects.toThrow('source');
  });
  it('writes verified actual fees in the same transaction as finalizing a full capture', async () => {
    const id = await fulfill(); balance(317); await decideAuthorizedBooking(id, 'confirmed');
    const allocations = await rows(s.kitchenBookingDayAllocations);
    expect(allocations.reduce((sum: number, row: any) => sum + row.stripeFeeCents, 0)).toBe(317);
    expect(allocations.every((row: any) => row.evidence.feeStatus === 'verified')).toBe(true);
  });
  it('rejects an equipment identity change before capture, even if its price stayed the same', async () => {
    const id = await fulfill(), [item] = await rows(s.equipmentBookings);
    await h.db.update(s.equipmentBookings).set({ equipmentListingId: 999 }).where(eq(s.equipmentBookings.id, item.id));
    await expect(decideAuthorizedBooking(id, 'confirmed')).rejects.toThrow('equipment'); expect(h.capture).not.toHaveBeenCalled();
  });
  it('captures the full total and conserves all components; unknown actual fee is NULL/pending', async () => {
    const id = await fulfill(); await decideAuthorizedBooking(id, 'confirmed');
    expect(h.capture).toHaveBeenCalledWith(h.intent.id, 11232, undefined, expect.stringMatching(/^booking-decision:/));
    const allocations = await rows(s.kitchenBookingDayAllocations);
    expect(allocations).toHaveLength(5); expect(allocations.every((row: any) => row.stripeFeeCents === null && row.evidence.feeStatus === 'pending')).toBe(true);
    expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(11232);
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });
  it('still refuses storage decisions on a dated booking (days stay all-or-nothing)', async () => {
    const id = await fulfill();
    await expect(decideAuthorizedBooking(id, 'confirmed', [{ storageBookingId: 1, action: 'cancelled' }], [])).rejects.toThrow('whole booking');
    expect(h.capture).not.toHaveBeenCalled(); expect((await rows(s.kitchenBookings))[0].paymentDecision).toBeNull();
  });
  it('declines every day and item and voids the whole authorization', async () => {
    const id = await fulfill(); await decideAuthorizedBooking(id, 'cancelled', [], [], 3);
    expect(h.capture).not.toHaveBeenCalled(); expect(h.cancel).toHaveBeenCalledOnce();
    expect((await rows(s.equipmentBookings)).every((row: any) => row.status === 'cancelled' && row.paymentStatus === 'failed')).toBe(true);
    expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(0);
    expect(await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider)).toBe(id);
  });
  it('recovers a lost capture response without charging twice', async () => {
    const id = await fulfill(); h.loseCapture = true;
    await expect(decideAuthorizedBooking(id, 'confirmed')).rejects.toThrow('lost capture');
    expect((await rows(s.kitchenBookings))[0].paymentDecision.state).toBe('pending');
    await decideAuthorizedBooking(id, 'confirmed');
    expect(h.capture).toHaveBeenCalledOnce(); expect(h.capturedKeys.size).toBe(1); expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(5);
  });
  it('serializes competing accepts into the same immutable decision and capture key', async () => {
    const id = await fulfill();
    const outcomes = await Promise.allSettled([decideAuthorizedBooking(id, 'confirmed'), decideAuthorizedBooking(id, 'confirmed')]);
    expect(outcomes.some(row => row.status === 'fulfilled')).toBe(true);
    await decideAuthorizedBooking(id, 'confirmed');
    expect(h.capturedKeys.size).toBe(1); expect(await rows(s.kitchenBookingDayAllocations)).toHaveLength(5);
  });
  it('keeps verified fee allocations frozen across webhook replays and updates pending fees only with BalanceTransaction evidence', async () => {
    const id = await fulfill(); await decideAuthorizedBooking(id, 'confirmed'); balance(317);
    await syncDatedPayment(h.intent.id); await syncDatedPayment(h.intent.id);
    const allocations = await rows(s.kitchenBookingDayAllocations);
    expect(allocations.reduce((sum: number, row: any) => sum + row.stripeFeeCents, 0)).toBe(317);
    expect(allocations.reduce((sum: number, row: any) => sum + row.subtotalCents + row.taxCents - row.stripeFeeCents, 0)).toBe(11232 - 644 - 317);
    expect(allocations.every((row: any) => row.evidence.balanceTransactionId === 'txn_cp4')).toBe(true);
    expect((await rows(s.paymentTransactions))[0].managerRevenue).toBe('10271');
    h.intent.latest_charge = null; await syncDatedPayment(h.intent.id);
    expect((await rows(s.kitchenBookingDayAllocations)).map((row: any) => row.stripeFeeCents)).toEqual(allocations.map((row: any) => row.stripeFeeCents));
    balance(318); await expect(syncDatedPayment(h.intent.id)).rejects.toThrow('Frozen');
  });
  it('does not invent a fee, and rejects a wrong charge, balance source, amount, currency or fee details', async () => {
    await fulfill(); h.intent.status = 'succeeded'; h.intent.amount_received = h.intent.amount;
    expect((await verifiedDatedCaptureEvidence(h.intent, h.provider)).feeCents).toBeNull();
    for (const mutate of [(c: any) => c.payment_intent = 'pi_other', (c: any) => c.balance_transaction.source = 'ch_other',
      (c: any) => c.balance_transaction.amount++, (c: any) => c.balance_transaction.currency = 'usd', (c: any) => c.balance_transaction.fee_details[0].amount++]) {
      const c = balance(); mutate(c); await expect(verifiedDatedCaptureEvidence(h.intent, h.provider)).rejects.toThrow();
    }
    balance(0); expect((await verifiedDatedCaptureEvidence(h.intent, h.provider)).feeCents).toBe(0);
  });
  it('uses the first day for the existing 24h / 1h-before-deadline rule and refuses expired acceptance', async () => {
    const id = await fulfill(), [parent] = await rows(s.kitchenBookings);
    const createdAt = new Date('2099-10-04T08:00Z');
    expect(responseDeadlineForBooking({ ...parent, createdAt }, 'UTC').toISOString()).toBe('2099-10-04T09:00:00.000Z');
    await h.db.update(s.kitchenBookings).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(s.kitchenBookings.id, id));
    await expect(decideAuthorizedBooking(id, 'confirmed')).rejects.toThrow('response deadline'); expect(h.capture).not.toHaveBeenCalled();
  });
  it('keeps 0098 policy terms immutable while still permitting session remapping', async () => {
    const id = await fulfill(), [parent] = await rows(s.kitchenBookings);
    const updated = { ...parent.cancellationPolicySnapshot, sessions: [{ startAt: '2099-10-10T10:00:00.000Z' }] };
    await h.db.update(s.kitchenBookings).set({ cancellationPolicySnapshot: updated }).where(eq(s.kitchenBookings.id, id));
    await expect(h.db.update(s.kitchenBookings).set({ cancellationPolicySnapshot: { ...updated, deadlineBasis: undefined } }).where(eq(s.kitchenBookings.id, id))).rejects.toThrow();
  });
  it('uses existing largest-remainder helpers across many uneven components without losing a cent', async () => {
    await checkout(); const m = (await quote()).manifest;
    for (let count = 1; count <= 30; count++) {
      const components = Array.from({ length: count }, (_, i) => ({ visitId: i + 1, sessionIndex: i, componentKey: 'kitchen', kind: 'kitchen' as const, bookingId: 1, subtotalCents: i + 1 }));
      const subtotal = components.reduce((sum, row) => sum + row.subtotalCents, 0);
      for (const fee of [0, 1, 7, 31]) {
        const result = allocateDatedCapture(components, { ...m, subtotalCents: subtotal, taxCents: 7, serviceFeeCents: 3, totalCents: subtotal + 10 }, fee);
        expect(result.reduce((sum, row) => sum + row.taxCents, 0)).toBe(7); expect(result.reduce((sum, row) => sum + row.serviceFeeCents, 0)).toBe(3);
        expect(result.reduce((sum, row) => sum + row.stripeFeeCents!, 0)).toBe(fee);
      }
    }
  });
});
