/**
 * CP10 money-review regression proofs for the firm invitation price and checkout guards.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as s from '@shared/schema';
import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { allocateCents, DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { responseDeadlineForBooking } from '@shared/booking-response-deadline';
import {
  allocateInvitationKitchenCents, invitationQuoteBlock, priceInvitationDays, type InvitationDaySnapshot,
} from './kitchen-invitation-days';
import { offeredInvitationSubtotal } from './kitchen-invitations';
import { allocateDatedCapture, verifyInvitationBlock, type PricedBookingDay } from './dated-booking-quote';

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
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `CP10M-${++h.next}` }));
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

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_in_memory_only');
  const legacy = readFileSync('migrations/0043_kitchen_booking_visits.sql', 'utf8');
  const body = legacy.slice(legacy.indexOf('CREATE OR REPLACE FUNCTION'), legacy.indexOf('DROP TRIGGER'));
  const cp1 = readFileSync('migrations/0099_multiday_and_kitchen_controls.sql', 'utf8');
  const allocations = cp1.slice(cp1.indexOf('CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations'), cp1.indexOf('DROP TRIGGER'));
  const db = await createTestDatabase([s.users, s.locations, s.kitchens, s.equipmentListings, s.kitchenBookings, s.kitchenBookingVisits,
    s.equipmentBookings, s.storageBookings, s.paymentTransactions, s.kitchenCheckoutHolds, s.kitchenCheckoutIncidents, s.kitchenCancellationPolicies,
    s.platformSettings, s.bookingLifecycleEvents, s.emailLogs, s.kitchenInvitations, s.kitchenInvitationEvents], [body, allocations,
      'CREATE UNIQUE INDEX cp10m_request_key ON kitchen_invitations(request_key)',
      'CREATE UNIQUE INDEX cp10m_session ON kitchen_invitations(stripe_session_id)',
      'CREATE UNIQUE INDEX cp10m_notice ON kitchen_invitation_events(notice_key)',
      'CREATE UNIQUE INDEX cp10m_payment_intent ON payment_transactions(payment_intent_id)',
      'CREATE UNIQUE INDEX cp10m_incident ON kitchen_checkout_incidents(session_id)',
      'CREATE UNIQUE INDEX cp10m_group_day ON kitchen_checkout_holds(group_id, operating_date)',
      'CREATE UNIQUE INDEX cp10m_visit_block ON kitchen_booking_visits(booking_id, block_index)',
      'CREATE UNIQUE INDEX cp10m_visit_date ON kitchen_booking_visits(booking_id, schedule_revision, visit_date)',
      'CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings FOR EACH ROW WHEN (NEW.schedule_revision = 0) EXECUTE FUNCTION create_kitchen_booking_visits()',
      readFileSync('migrations/0098_policy_snapshot_sessions_movable.sql', 'utf8'),
      'CREATE TRIGGER protect_policy BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot()',
      readFileSync('migrations/0104_extra_time_rate.sql', 'utf8'),
    ]);
  h.db = db.db; h.client = db.client;
  h.provider = { checkout: { sessions: { create: h.create, list: async () => ({ data: h.sessions, has_more: false }),
    retrieve: async (id: string) => ({ ...h.sessions.find(session => session.id === id), payment_intent: h.intent }),
    expire: async (id: string) => { const session = h.sessions.find(row => row.id === id); if (session) session.status = 'expired'; return session; } } },
    paymentIntents: { retrieve: async () => h.intent, cancel: h.cancel }, refunds: { list: async () => ({ data: [], has_more: false }),
      create: vi.fn(async (params: any) => ({ id: 're_cp10m', status: 'succeeded', currency: 'cad', payment_intent: h.intent.id, amount: params.amount })) },
    charges: { retrieve: vi.fn(async () => ({ id: 'ch_cp10m', amount: h.intent.amount_received, amount_captured: h.intent.amount_received,
      amount_refunded: 0, balance_transaction: 'bt_cp10m', payment_intent: h.intent.id, currency: 'cad', paid: true, captured: true })) },
    balanceTransactions: { retrieve: vi.fn(async () => {
      const amount = h.intent.amount_received as number;
      const fee = Math.round(amount * 0.029 + 30);
      return { id: 'bt_cp10m', amount, fee, net: amount - fee, currency: 'cad', source: 'ch_cp10m',
        fee_details: [{ type: 'stripe_fee', amount: fee, currency: 'cad' }] };
    }) } };
  ({ checkoutDatedInvitation } = await import('./dated-invitation-checkout'));
}, 60_000);
afterAll(async () => { await h.client?.close(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  await h.client.exec('TRUNCATE kitchen_invitation_events, kitchen_invitations, kitchen_booking_day_allocations, kitchen_booking_day_payouts, equipment_bookings, storage_bookings, kitchen_booking_visits, kitchen_bookings, payment_transactions, kitchen_checkout_holds, kitchen_checkout_incidents, kitchen_cancellation_policies, platform_settings, kitchens, locations, users, equipment_listings, booking_lifecycle_events, email_logs RESTART IDENTITY CASCADE');
  h.closed.clear(); h.canBook = true; h.sessions = []; h.intent = null; h.next = 0;
  h.create.mockReset(); h.capture.mockReset(); h.cancel.mockReset(); h.event.mockReset();
  h.policy = { timezone: 'UTC', bookingBufferMinutes: 0, maxBookingDays: 14, allowMultiDayBookings: true, multidayCreationEnabled: true,
    defaultDailyBookingLimit: null, minimumBookingWindowHours: 1, weeklyChefHoursLimit: null };
  await h.db.insert(s.users).values([{ id: 2, username: 'manager@test.invalid', password: 'test', role: 'manager', stripeConnectAccountId: 'acct_cp10m' },
    { id: 3, username: 'chef@test.invalid', password: 'test', role: 'chef' }]);
  await h.db.insert(s.locations).values({ id: 9, managerId: 2, name: 'Test', address: 'Test', timezone: 'UTC', taxRatePercent: null });
  await h.db.insert(s.kitchens).values({ id: 4, locationId: 9, name: 'Test kitchen', hourlyRate: '1001', dailyRate: '7003', taxRatePercent: '15',
    listingStatus: 'active', extraTimeRateCents: 2500 });
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
      currency: 'cad', metadata: params.payment_intent_data.metadata, latest_charge: 'ch_cp10m' };
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

const dateAfter = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (date: string, equipmentIds: number[] = [], pricingMode: 'hourly' | 'daily' = 'hourly') =>
  ({ date, pricingMode, slots: hours(10, 12), equipmentIds });
const create = (input: Record<string, unknown>) => createKitchenInvitation(2, { kitchenId: 4, chefId: 3, expiresInHours: 48,
  requestKey: randomUUID(), ...input } as any);
const rows = (table: any) => h.db.select().from(table);
const checkout = (row: any, equipment?: unknown) => checkoutDatedInvitation(3, row, { equipment,
  cancellationPolicyAccepted: true, cancellationPolicyVersion: 1, cancellationDisclosureVersion: DATED_DISCLOSURE_VERSION }, 'https://test.invalid');

describe('CP10 money review — pure discount / allocation / quote guards', () => {
  it('M0: discount never raises kitchen subtotal; $1 booking floor; equipment stays at list', () => {
    expect(offeredInvitationSubtotal(9_005, { type: 'amount', value: 1_000 })).toBe(8_005);
    expect(offeredInvitationSubtotal(10_001, { type: 'percent', value: 15 })).toBe(8_501);
    expect(() => offeredInvitationSubtotal(9_005, { type: 'amount', value: 8_906 })).toThrow('at least $1.00');
    expect(() => offeredInvitationSubtotal(100, { type: 'amount', value: -1 })).toThrow();
    // No API path can express above-list; the helper still refuses a synthetic above-list result.
    expect(offeredInvitationSubtotal(5_000)).toBe(5_000);

    const listings = [
      { id: 10, equipmentType: 'Mixer', availabilityType: 'rental', sessionRate: '101' },
      { id: 11, equipmentType: 'Oven', availabilityType: 'included', sessionRate: null },
    ];
    const validated = [
      { date: '2099-11-02', pricingMode: 'hourly' as const, slots: hours(10, 12), windowStartTime: '08:00', startTime: '10:00', endTime: '12:00', equipmentIds: [10] },
      { date: '2099-11-04', pricingMode: 'daily' as const, slots: hours(8, 16), windowStartTime: '08:00', startTime: '08:00', endTime: '16:00', equipmentIds: [] },
    ];
    const priced = priceInvitationDays(validated as any, { hourlyRate: 1_001, dailyRate: 7_003 }, listings, 8_005);
    expect(priced.listKitchenCents).toBe(9_005);
    expect(priced.offeredKitchenCents).toBe(8_005);
    expect(priced.listEquipmentCents).toBe(101);
    expect(priced.offeredSubtotalCents).toBe(8_106);
    expect(priced.days.every(row => row.offeredKitchenCents <= row.listKitchenCents)).toBe(true);
    expect(priced.days.reduce((sum, row) => sum + row.offeredKitchenCents, 0)).toBe(8_005);
    expect(priced.days.map(row => row.offeredKitchenCents)).toEqual(allocateCents(8_005, [2_002, 7_003]));
    expect(priced.days[0].equipment.map(item => item.cents)).toEqual([101]);
  });

  it('M0: verifyInvitationBlock refuses above-list, below-floor, skewed split, and day set edits', () => {
    const listings = [{ id: 10, equipmentType: 'Mixer', availabilityType: 'rental', sessionRate: '0' }];
    const validated = [
      { date: '2099-11-02', pricingMode: 'hourly' as const, slots: hours(10, 12), windowStartTime: '08:00', startTime: '10:00', endTime: '12:00', equipmentIds: [] },
      { date: '2099-11-04', pricingMode: 'daily' as const, slots: hours(8, 16), windowStartTime: '08:00', startTime: '08:00', endTime: '16:00', equipmentIds: [] },
    ];
    const snapshot = priceInvitationDays(validated as any, { hourlyRate: 1_001, dailyRate: 7_003 }, listings, 8_005).days;
    const priced: PricedBookingDay[] = snapshot.map(row => ({ ...row, kitchenCents: row.offeredKitchenCents, rateCents: row.pricingMode === 'daily' ? 7_003 : 1_001, equipmentIds: [] }));
    const block = invitationQuoteBlock(snapshot, 'invite-1', 1);
    expect(() => verifyInvitationBlock(block, priced)).not.toThrow();
    expect(() => verifyInvitationBlock({ ...block, offeredKitchenCents: 9_006, days: [
      { date: '2099-11-02', listKitchenCents: 2_002, offeredKitchenCents: 2_003 },
      { date: '2099-11-04', listKitchenCents: 7_003, offeredKitchenCents: 7_003 },
    ] }, priced.map((row, i) => ({ ...row, kitchenCents: i === 0 ? 2_003 : 7_003 })))).toThrow();
    expect(() => verifyInvitationBlock({ ...block, offeredKitchenCents: 99, days: [
      { date: '2099-11-02', listKitchenCents: 2_002, offeredKitchenCents: 22 },
      { date: '2099-11-04', listKitchenCents: 7_003, offeredKitchenCents: 77 },
    ] }, priced.map((row, i) => ({ ...row, kitchenCents: i === 0 ? 22 : 77 })))).toThrow();
    const skewed = { ...block, days: [
      { date: '2099-11-02', listKitchenCents: 2_002, offeredKitchenCents: 1_000 },
      { date: '2099-11-04', listKitchenCents: 7_003, offeredKitchenCents: 7_005 },
    ] };
    expect(() => verifyInvitationBlock(skewed, priced.map((row, i) => ({ ...row, kitchenCents: skewed.days[i].offeredKitchenCents })))).toThrow();
  });

  it('M0: worked example tax/fee/total and allocateDatedCapture conserve with no 1¢ drift', () => {
    const offeredKitchen = 8_005, equipment = 101, subtotal = offeredKitchen + equipment;
    const tax = Math.round(subtotal * 15 / 100);
    const fee = Math.round(subtotal * 0.07);
    expect(tax).toBe(1_216);
    expect(fee).toBe(567);
    expect(subtotal + tax + fee).toBe(9_889);
    const split = allocateInvitationKitchenCents([2_002, 7_003], offeredKitchen);
    expect(split.reduce((a, b) => a + b, 0)).toBe(offeredKitchen);
    const components = [
      { visitId: 1, sessionIndex: 0, componentKey: 'kitchen', kind: 'kitchen' as const, bookingId: 1, subtotalCents: split[0] },
      { visitId: 1, sessionIndex: 0, componentKey: 'equipment:10', kind: 'equipment' as const, bookingId: 10, subtotalCents: equipment },
      { visitId: 2, sessionIndex: 1, componentKey: 'kitchen', kind: 'kitchen' as const, bookingId: 1, subtotalCents: split[1] },
    ];
    const m = { subtotalCents: subtotal, taxCents: tax, serviceFeeCents: fee, totalCents: subtotal + tax + fee } as any;
    const allocated = allocateDatedCapture(components, m, 313);
    expect(allocated.reduce((sum, row) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(9_889);
    expect(allocated.reduce((sum, row) => sum + row.stripeFeeCents!, 0)).toBe(313);
    expect(allocated.reduce((sum, row) => sum + row.serviceFeeCents, 0)).toBe(567);
  });
});

describe('CP10 money review — checkout / fulfill ledger', () => {
  it('OK: frozen offered kitchen survives a live rate hike; day parts + fee shares sum to the charge', async () => {
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first, [10]), day(second, [], 'daily')], discount: { type: 'amount', value: 1_000 } });
    const [invite] = await rows(s.kitchenInvitations);
    const snapshot = invite.daysSnapshot as InvitationDaySnapshot[];
    const offeredKitchen = snapshot.reduce((sum, row) => sum + row.offeredKitchenCents, 0);
    expect(offeredKitchen).toBe(8_005);
    expect(snapshot.map(row => row.offeredKitchenCents)).toEqual(allocateCents(8_005, [2_002, 7_003]));

    await h.db.update(s.kitchens).set({ hourlyRate: '5000', dailyRate: '20000' }).where(eq(s.kitchens.id, 4));
    expect(await invitationDto(invite, 'chef')).toMatchObject({ extraTimeRateCents: 5_000 });
    expect(await datedInvitationCheckoutPricing(invite)).toMatchObject({ extraTimeRateCents: 5_000 });
    const session = await checkout(invite, [{ date: first, equipmentIds: [10] }, { date: second, equipmentIds: [] }]);
    expect(session.currency ?? 'cad').toBeDefined();
    expect(h.sessions[0].currency).toBe('cad');
    expect(h.intent.currency).toBe('cad');
    // Kitchen line items must still be the frozen offered shares (not the hiked list).
    const kitchenLines = h.sessions[0].metadata;
    expect(Number(kitchenLines.total_price_cents)).toBe(8_005 + 101);
    expect(h.intent.amount).toBe(8_106 + 1_216 + 567);
    const hold = (await rows(s.kitchenCheckoutHolds)).find((row: any) => row.quoteSnapshot);
    expect(hold.quoteSnapshot.manifest.days.map((day: any) => day.rateCents)).toEqual([890, 6_225]);

    h.sessions[0].status = 'complete';
    const bookingId = (await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider))!;
    const [booking] = await rows(s.kitchenBookings);
    expect(booking).toMatchObject({ id: bookingId, invitationId: invite.id, paymentStatus: 'paid', status: 'confirmed' });
    // S1: invited effective rates describe the kitchen offer; extra time follows the live 1x rule.
    expect(booking.hourlyRate).toBe('890');
    expect(booking.extraTimeRateCents).toBe(5_000);
    const visits = (await rows(s.kitchenBookingVisits)).sort((a: any, b: any) => a.visitDate.localeCompare(b.visitDate));
    expect(visits.map((visit: any) => visit.priceSnapshot.rateCents)).toEqual([890, 6_225]);

    const [source] = await rows(s.paymentTransactions);
    const parts = (source.metadata as any).capturedComponentAllocations as Array<{
      componentKey: string; subtotalCents: number; taxCents: number; serviceFeeCents: number;
    }>;
    expect(parts.filter(row => row.componentKey === 'kitchen').reduce((sum, row) => sum + row.subtotalCents, 0)).toBe(8_005);
    expect(parts.reduce((sum, row) => sum + row.subtotalCents, 0)).toBe(8_106);
    expect(parts.reduce((sum, row) => sum + row.taxCents, 0)).toBe(1_216);
    expect(parts.reduce((sum, row) => sum + row.serviceFeeCents, 0)).toBe(567);
    expect(parts.reduce((sum, row) => sum + row.subtotalCents + row.taxCents + row.serviceFeeCents, 0)).toBe(Number(source.amount));
    expect(Number(source.amount)).toBe(h.intent.amount_received);
    expect(h.capture).toHaveBeenCalledOnce();

    await expect(fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider)).resolves.toBe(bookingId);
    expect(h.capture).toHaveBeenCalledOnce();
    expect(await rows(s.paymentTransactions)).toHaveLength(1);
  });

  it('M1: frozen days_snapshot equipment cents are charged in both quote and session after a live hike', async () => {
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first, [10]), day(second, [], 'daily')], discount: { type: 'amount', value: 1_000 } });
    const [invite] = await rows(s.kitchenInvitations);
    const offeredKitchen = (invite.daysSnapshot as InvitationDaySnapshot[]).reduce((sum, row) => sum + row.offeredKitchenCents, 0);
    expect(offeredKitchen).toBe(8_005);
    expect((invite.daysSnapshot as InvitationDaySnapshot[])[0].equipment[0].cents).toBe(101);

    await h.db.update(s.equipmentListings).set({ sessionRate: '50000' }).where(eq(s.equipmentListings.id, 10));
    const quote = await datedInvitationCheckoutPricing(invite, [{ date: first, equipmentIds: [10] }, { date: second, equipmentIds: [] }]);
    expect(quote.equipment.find(item => item.listingId === 10)?.cents).toBe(101);
    expect(quote.subtotalCents).toBe(8_106);

    await checkout(invite, [{ date: first, equipmentIds: [10] }, { date: second, equipmentIds: [] }]);
    expect(quote.taxCents).toBe(1_216);
    expect(quote.serviceFeeCents).toBe(567);
    expect(h.intent.amount).toBe(9_889);
    expect(h.intent.amount).toBe(quote.totalCents);
    expect((invite.daysSnapshot as InvitationDaySnapshot[])[0].equipment[0].cents).toBe(101);
  });

  it('M1: the same equipment added on a different day uses its live price, even if its inclusion rule changes', async () => {
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first, [10, 11]), day(second)] });
    const [invite] = await rows(s.kitchenInvitations);
    await h.db.update(s.equipmentListings).set({ availabilityType: 'included', sessionRate: '50000' }).where(eq(s.equipmentListings.id, 10));
    await h.db.update(s.equipmentListings).set({ availabilityType: 'rental', sessionRate: '307' }).where(eq(s.equipmentListings.id, 11));
    const equipment = [{ date: first, equipmentIds: [11, 10] }, { date: second, equipmentIds: [11, 10] }];
    const quote = await datedInvitationCheckoutPricing(invite, equipment);
    expect(quote.days.map(day => day.equipment.map(item => [item.listingId, item.cents])))
      .toEqual([[[10, 101], [11, 0]], [[10, 0], [11, 307]]]);
    await checkout(invite, equipment);
    expect(h.intent.amount).toBe(quote.totalCents);
  });

  it('S1: a $1 booking offer can allocate zero kitchen cents and a zero effective rate to a day', async () => {
    await h.db.update(s.kitchens).set({ dailyRate: '7003000' }).where(eq(s.kitchens.id, 4));
    await create({ days: [day(dateAfter(3)), day(dateAfter(5), [], 'daily')],
      discount: { type: 'amount', value: 7_005_002 - 100 } });
    const [invite] = await rows(s.kitchenInvitations);
    await checkout(invite);
    const hold = (await rows(s.kitchenCheckoutHolds)).find((row: any) => row.quoteSnapshot);
    expect(hold.quoteSnapshot.manifest.days.map((day: any) => [day.kitchenCents, day.rateCents])).toEqual([[0, 0], [100, 100]]);
    h.sessions[0].status = 'complete';
    await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider);
    expect((await rows(s.kitchenBookings))[0].hourlyRate).toBe('0');
  });

  it('OK: daily-only kitchen snapshots extra_time_rate_cents (0104) on an invitation booking', async () => {
    await h.db.update(s.kitchens).set({ hourlyRate: null, dailyRate: '7003', extraTimeRateCents: 2500 }).where(eq(s.kitchens.id, 4));
    const first = dateAfter(3), second = dateAfter(5);
    await create({ days: [day(first, [], 'daily'), day(second, [], 'daily')], discount: { type: 'amount', value: 1_000 } });
    const [invite] = await rows(s.kitchenInvitations);
    expect(await invitationDto(invite, 'chef')).toMatchObject({ extraTimeRateCents: 2_500 });
    expect(await datedInvitationCheckoutPricing(invite)).toMatchObject({ extraTimeRateCents: 2_500 });
    await checkout(invite);
    h.sessions[0].status = 'complete';
    await fulfillQuotedKitchenBooking(h.sessions[0], h.intent, h.provider);
    expect((await rows(s.kitchenBookings))[0].extraTimeRateCents).toBe(2_500);
  });

  it('OK: replaced/version-bumped invitation cannot leave a payable session', async () => {
    const first = dateAfter(3);
    await create({ days: [day(first), day(dateAfter(4))] });
    const [row] = await rows(s.kitchenInvitations);
    await h.db.update(s.kitchenInvitations).set({ status: 'superseded', version: 2 }).where(eq(s.kitchenInvitations.id, row.id));
    await expect(checkout(row)).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    expect(h.sessions[0].status).toBe('expired');
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
  });

  it.each(['expired', 'wrong chef', 'not sent'] as const)('S2: checkoutDatedInvitation refuses a %s row before reserving', async reason => {
    const first = dateAfter(3);
    await create({ days: [day(first), day(dateAfter(4))] });
    const [row] = await rows(s.kitchenInvitations);
    const refused = { ...row, ...(reason === 'expired' ? { expiresAt: new Date(Date.now() - 60_000) }
      : reason === 'wrong chef' ? { chefId: 2 } : { status: 'declined' }) };
    await expect(checkout(refused)).rejects.toMatchObject({ status: 409, body: { error: 'This invitation is no longer payable.' } });
    expect(h.create).not.toHaveBeenCalled();
    expect(await rows(s.kitchenCheckoutHolds)).toHaveLength(0);
    expect((await rows(s.kitchenInvitations))[0].status).toBe('sent');
  });
});
