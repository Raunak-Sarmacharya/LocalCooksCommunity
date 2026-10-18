/**
 * CP10: multi-day kitchen invitations, executed against real Postgres (PGlite).
 *
 * The invitation is a frozen day set with an offered kitchen subtotal. Checkout must produce the same dated contract,
 * grouped hold and single manual capture as a chef's own multi-day checkout, and every replay (request, checkout,
 * webhook, auto-accept) must settle on one booking and one captured total. Only provider I/O and the day engine's
 * neighbours are stubbed; the invitation service, validator, quote, holds and fulfilment are real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { allocateCents, DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import { matchingLocalInstants } from '@shared/booking-dst';

const h = vi.hoisted(() => ({ db: null as any, client: null as any, provider: null as any, sessions: [] as any[], intent: null as any,
  policy: {} as any, closed: new Set<string>(), canBook: true, create: vi.fn(), capture: vi.fn(), cancel: vi.fn(), event: vi.fn(), next: 0 }));
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
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `CP10-${++h.next}` }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.event }));
vi.mock('./booking-response-deadline', async importOriginal => ({ ...await importOriginal<object>(),
  getBookingResponseDeadline: async (booking: any) => responseDeadlineForBooking(booking, 'UTC') }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
vi.mock('./visit-code-challenge', () => ({ ensureChallengesForBooking: vi.fn() }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./auth-expiry-service', () => ({ lazyExpireKitchenBookingAuth: vi.fn(), sendAuthExpiryNotification: vi.fn() }));
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

import { createKitchenInvitation, datedInvitationCheckoutPricing, invitationDto } from './kitchen-invitations';
import { fulfillQuotedKitchenBooking } from './booking-checkout-fulfillment';
let checkoutDatedInvitation: typeof import('./dated-invitation-checkout').checkoutDatedInvitation;
let invitationsRouter: typeof import('../routes/kitchen-invitations').default;

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_in_memory_only');
  const legacy = readFileSync('migrations/0043_kitchen_booking_visits.sql', 'utf8');
  const body = legacy.slice(legacy.indexOf('CREATE OR REPLACE FUNCTION'), legacy.indexOf('DROP TRIGGER'));
  const cp1 = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const allocations = cp1.slice(cp1.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), cp1.indexOf('DROP TRIGGER'));
  const db = await createTestDatabase([s.users, s.locations, s.kitchens, s.equipmentListings, s.kitchenBookings, s.kitchenBookingVisits,
    s.equipmentBookings, s.storageBookings, s.paymentTransactions, s.kitchenCheckoutHolds, s.kitchenCheckoutIncidents, s.kitchenCancellationPolicies,
    s.platformSettings, s.bookingLifecycleEvents, s.emailLogs, s.kitchenInvitations, s.kitchenInvitationEvents], [body, allocations,
      'CREATE UNIQUE INDEX cp10_request_key ON kitchen_invitations(request_key)',
      'CREATE UNIQUE INDEX cp10_session ON kitchen_invitations(stripe_session_id)',
      'CREATE UNIQUE INDEX cp10_notice ON kitchen_invitation_events(notice_key)',
      'CREATE UNIQUE INDEX cp10_payment_intent ON payment_transactions(payment_intent_id)',
      'CREATE UNIQUE INDEX cp10_incident ON kitchen_checkout_incidents(session_id)',
      'CREATE UNIQUE INDEX cp10_group_day ON kitchen_checkout_holds(group_id, operating_date)',
      'CREATE UNIQUE INDEX cp10_visit_block ON kitchen_booking_visits(booking_id, block_index)',
      'CREATE UNIQUE INDEX cp10_visit_date ON kitchen_booking_visits(booking_id, schedule_revision, visit_date)',
      'CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings FOR EACH ROW WHEN (NEW.schedule_revision = 0) EXECUTE FUNCTION create_kitchen_booking_visits()',
      readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
      'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()',
    ]);
  h.db = db.db; h.client = db.client;
  h.provider = { checkout: { sessions: { create: h.create, list: async () => ({ data: h.sessions, has_more: false }),
    retrieve: async (id: string) => ({ ...h.sessions.find(session => session.id === id), payment_intent: h.intent }),
    expire: async (id: string) => { const session = h.sessions.find(row => row.id === id); if (session) session.status = 'expired'; return session; } } },
    paymentIntents: { retrieve: async () => h.intent, cancel: h.cancel }, refunds: { list: async () => ({ data: [], has_more: false }),
      create: vi.fn(async (params: any) => ({ id: 're_cp10', status: 'succeeded', currency: 'cad', payment_intent: h.intent.id, amount: params.amount })) },
    charges: { retrieve: vi.fn() }, balanceTransactions: { retrieve: vi.fn() } };
  // Import after the provider exists: the checkout service captures its Stripe client when first loaded.
  ({ checkoutDatedInvitation } = await import('./dated-invitation-checkout'));
  ({ default: invitationsRouter } = await import('../routes/kitchen-invitations'));
}, 60_000);
afterAll(async () => { await h.client?.close(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  await h.client.exec('TRUNCATE kitchen_invitation_events, kitchen_invitations, kitchen_booking_day_allocations, equipment_bookings, storage_bookings, kitchen_booking_visits, kitchen_bookings, payment_transactions, kitchen_checkout_holds, kitchen_checkout_incidents, kitchen_cancellation_policies, platform_settings, kitchens, locations, users, equipment_listings, booking_lifecycle_events, email_logs RESTART IDENTITY CASCADE');
  h.closed.clear(); h.canBook = true; h.sessions = []; h.intent = null; h.next = 0;
  h.create.mockReset(); h.capture.mockReset(); h.cancel.mockReset(); h.event.mockReset();
  h.policy = { timezone: 'UTC', bookingBufferMinutes: 0, maxBookingDays: 14, allowMultiDayBookings: true, multidayCreationEnabled: true,
    defaultDailyBookingLimit: null, minimumBookingWindowHours: 1, weeklyChefHoursLimit: null };
  await h.db.insert(s.users).values([{ id: 2, username: 'manager@test.invalid', password: 'test', role: 'manager', stripeConnectAccountId: 'acct_cp10' },
    { id: 3, username: 'chef@test.invalid', password: 'test', role: 'chef' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Test', address: 'Test', timezone: 'UTC', taxRatePercent: null });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Test kitchen', hourlyRate: '1001', dailyRate: '7003', taxRatePercent: '15', listingStatus: 'active' });
  await h.db.insert(s.kitchenCancellationPolicies).values({ id: 8, kitchenId: 4, version: 1, status: 'published', noticeHours: 24, lateChargePercent: 50,
    tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], publishedBy: 2 });
  await h.db.insert(s.platformSettings).values({ key: 'platform_commission_rate', value: '0.07' });
  await h.db.insert(s.equipmentListings).values([{ id: 10, kitchenId: 4, category: 'cooking', equipmentType: 'Mixer', condition: 'good', sessionRate: '101', availabilityType: 'rental' },
    { id: 11, kitchenId: 4, category: 'cooking', equipmentType: 'Included oven', condition: 'good', availabilityType: 'included' }]);
  h.create.mockImplementation(async (params: any, options: any) => {
    const previous = h.sessions.find(session => session.key === options.idempotencyKey);
    if (previous) return previous;
    const amount = params.line_items.reduce((sum: number, item: any) => sum + item.price_data.unit_amount, 0);
    h.intent = { id: `pi_${h.sessions.length}`, status: 'requires_capture', amount, amount_capturable: amount, amount_received: 0, capture_method: 'manual',
      currency: 'cad', metadata: params.payment_intent_data.metadata, latest_charge: null };
    const session = { id: `cs_${h.sessions.length}`, key: options.idempotencyKey, url: 'https://checkout.test.invalid',
      status: 'open', mode: 'payment', currency: 'cad', amount_total: amount, metadata: params.metadata, payment_intent: h.intent.id };
    h.sessions.push(session);
    return session;
  });
  h.capture.mockImplementation(async (_id: string, amount: number, _fee: unknown, key: string) => {
    expect(amount).toBe(h.intent.amount);
    h.intent.status = 'succeeded'; h.intent.amount_received = amount; h.intent.amount_capturable = 0;
    return { key };
  });
  h.cancel.mockImplementation(async () => { h.intent.status = 'canceled'; h.intent.amount_received = 0; return h.intent; });
});

/** A calendar date `offset` days from today, so the notice and advance windows stay meaningful whenever the suite runs. */
const dateAfter = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (date: string, equipmentIds: number[] = [], pricingMode: 'hourly' | 'daily' = 'hourly') =>
  ({ date, pricingMode, slots: hours(10, 12), equipmentIds });
const create = (input: Record<string, unknown>) => createKitchenInvitation(2, { kitchenId: 4, chefId: 3, expiresInHours: 48,
  requestKey: randomUUID(), ...input } as any);
const rows = (table: any) => h.db.select().from(table);
const checkout = (row: any, equipment?: unknown) => checkoutDatedInvitation(3, row, { equipment,
  cancellationPolicyAccepted: true, cancellationPolicyVersion: 1, cancellationDisclosureVersion: DATED_DISCLOSURE_VERSION }, 'https://test.invalid');

describe('CP10 creating a multi-day invitation', () => {
  it('freezes the day set and splits the discounted booking total across the listed days, never re-pricing a day', async () => {
    const first = dateAfter(3), second = dateAfter(5);
    const created = await create({ days: [day(first), day(second, [], 'daily')], discount: { type: 'amount', value: 1_000 } });
    const [row] = await rows(s.kitchenInvitations);
    const snapshot = row.daysSnapshot as any[];
    const listed = [2_002, 7_003];
    expect(snapshot.map(item => item.listKitchenCents)).toEqual(listed);
    expect(snapshot.map(item => item.offeredKitchenCents)).toEqual(allocateCents(8_005, listed));
    expect(snapshot.reduce((sum, item) => sum + item.offeredKitchenCents, 0)).toBe(8_005);
    expect(created).toMatchObject({ dated: true, dayCount: 2 });
    expect(created.pricing).toMatchObject({ listSubtotalCents: 9_005, offeredSubtotalCents: 8_005, taxCents: 1_201 });
    expect(created.pricing.totalCents).toBe(8_005 + 1_201 + created.pricing.serviceFeeCents);
    expect(snapshot.map(item => item.date)).toEqual([first, second]);
  });

  it('breaks equal-price ties by day order and applies the $1 floor to the booking, not each day', async () => {
    const first = dateAfter(3), second = dateAfter(4);
    await create({ days: [day(first), day(second)], discount: { type: 'amount', value: 2_003 } });
    const [row] = await rows(s.kitchenInvitations);
    expect((row.daysSnapshot as any[]).map(item => item.offeredKitchenCents)).toEqual([1_001, 1_000]);
    await expect(create({ days: [day(first), day(second)], discount: { type: 'amount', value: 3_905 } }))
      .rejects.toThrow('at least $1.00');
  });

  it('accepts a nonconsecutive set up to 14 days apart and refuses the 15th day', async () => {
    const first = dateAfter(3);
    await expect(create({ days: [day(first), day(dateAfter(17))] })).resolves.toMatchObject({ dayCount: 2 });
    await expect(create({ days: [day(first), day(dateAfter(18))] })).rejects.toThrow('within 14 days');
  });

  it('keeps each day’s equipment and charges a chef’s per-day choice at list', async () => {
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first, [10, 11]), day(second)] });
    const [row] = await rows(s.kitchenInvitations);
    expect((row.daysSnapshot as any[]).map(item => item.equipment.map((equipment: any) => [equipment.listingId, equipment.cents])))
      .toEqual([[[10, 101], [11, 0]], []]);
    const quote = await datedInvitationCheckoutPricing(row, [{ date: first, equipmentIds: [10] }, { date: second, equipmentIds: [11] }]);
    expect(quote).toMatchObject({ kitchenCents: row.listSubtotalCents - 101, listKitchenCents: row.listSubtotalCents - 101 });
    expect(quote.equipment).toEqual([{ listingId: 10, name: 'Mixer', cents: 101, date: first },
      { listingId: 11, name: 'Included oven', cents: 0, date: second }]);
    expect(quote.subtotalCents).toBe(row.listSubtotalCents);
    await expect(datedInvitationCheckoutPricing(row, [{ date: second, equipmentIds: [10] }, { date: second, equipmentIds: [] }]))
      .rejects.toThrow('Choose equipment for each invited day');
  });

  it('derives expiry from the FIRST day’s start minus the kitchen’s notice and checkout buffer', async () => {
    const first = dateAfter(2);
    const created = await create({ days: [day(first), day(dateAfter(4))], expiresInHours: 168 });
    const [row] = await rows(s.kitchenInvitations);
    const start = matchingLocalInstants(first, '10:00', 'UTC')[0];
    expect(new Date(row.expiresAt).getTime()).toBe(start - (24 * 60 + 37) * 60_000);
    expect(created.expiresAt).toBe(new Date(row.expiresAt).toISOString());
  });

  it('returns the same invitation for a duplicate request and never inserts twice', async () => {
    const requestKey = randomUUID();
    const first = await create({ requestKey, days: [day(dateAfter(3))] });
    const second = await create({ requestKey, days: [day(dateAfter(3))] });
    expect(second.id).toBe(first.id);
    expect(await rows(s.kitchenInvitations)).toHaveLength(1);
  });

  it('leaves a legacy one-date invitation on the old contract, even with multi-day creation switched off', async () => {
    h.policy.multidayCreationEnabled = false;
    const date = dateAfter(3);
    const created = await create({ date, startTime: '10:00', endTime: '12:00' });
    const [row] = await rows(s.kitchenInvitations);
    expect(row.daysSnapshot).toBeNull();
    expect(created).toMatchObject({ dated: false, dayCount: 1, date, startTime: '10:00', endTime: '12:00' });
    expect(created.days).toEqual([{ date, pricingMode: 'hourly', startTime: '10:00', endTime: '12:00', equipment: [] }]);
    expect(await invitationDto(row, 'chef')).toMatchObject({ dated: false, canPay: true });
  });
});

describe('CP10 paying a multi-day invitation', () => {
  it.each([0, 1])('refuses unavailable day %i through service and route, leaves sent and reserves nothing', async index => {
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first), day(second)] });
    const [row] = await rows(s.kitchenInvitations);
    const closed = [first, second][index];
    h.closed.add(closed);
    await expect(checkout(row)).rejects.toMatchObject({ status: 409, body: { dayErrors: [{ date: closed, reason: 'closed' }] } });
    const route = (invitationsRouter as any).stack.find((layer: any) => layer.route?.path === '/chef/invitations/:id/checkout').route;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await route.stack.at(-1).handle({ neonUser: { id: 3 }, params: { id: row.id }, body: {},
      protocol: 'https', get: () => 'test.invalid' }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dayErrors: [expect.objectContaining({ date: closed, reason: 'closed' })] }));
    expect(h.create).not.toHaveBeenCalled();
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
    expect((await rows(s.kitchenInvitations))[0].status).toBe('sent');
  });

  it('refuses a checkout of a replaced (version-bumped) invitation and releases the session it started', async () => {
    const first = dateAfter(3);
    await create({ days: [day(first), day(dateAfter(4))] });
    const [row] = await rows(s.kitchenInvitations);
    await h.db.update(s.kitchenInvitations).set({ status: 'superseded', version: 2 }).where(eq(s.kitchenInvitations.id, row.id));
    await expect(checkout(row)).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.sessions[0].status).toBe('expired');
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
    expect((await rows(s.kitchenInvitations))[0]).toMatchObject({ status: 'superseded', version: 2, holdId: null });
  });

  it('books and captures once, then settles duplicate webhooks and a replayed auto-accept without charging again', async () => {
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first, [10]), day(second, [], 'daily')] });
    const [row] = await rows(s.kitchenInvitations);
    const session = await checkout(row, [{ date: first, equipmentIds: [10] }, { date: second, equipmentIds: [] }]);
    expect(session.sessionUrl).toBe('https://checkout.test.invalid');
    const [stripeSession] = h.sessions;
    stripeSession.status = 'complete';
    const bookingId = (await fulfillQuotedKitchenBooking(stripeSession, h.intent, h.provider))!;
    expect(bookingId).toEqual(expect.any(Number));
    expect(await rows(s.kitchenBookings)).toHaveLength(1);
    expect((await rows(s.kitchenBookings))[0]).toMatchObject({ invitationId: row.id, status: 'confirmed', paymentStatus: 'paid' });
    expect((await rows(s.kitchenInvitations))[0]).toMatchObject({ status: 'accepted', bookingId });
    expect(h.capture).toHaveBeenCalledOnce();
    const captured = h.capture.mock.calls[0][1];
    expect(captured).toBe(h.intent.amount);

    // The same checkout webhook again, and a direct replay of the auto-accept: one booking, one capture.
    await expect(fulfillQuotedKitchenBooking(stripeSession, h.intent, h.provider)).resolves.toBe(bookingId);
    const { acceptFulfilledInvitation } = await import('./kitchen-invitations');
    await acceptFulfilledInvitation((await rows(s.kitchenInvitations))[0], bookingId);
    expect(await rows(s.kitchenBookings)).toHaveLength(1);
    expect(await rows(s.paymentTransactions)).toHaveLength(1);
    expect(h.capture).toHaveBeenCalledOnce();
  });
});
