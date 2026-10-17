import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const h = vi.hoisted(() => ({ db: null as any, notices: vi.fn(), timer: vi.fn(), canBook: true, claim: false, holdover: false }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: h.canBook }) } }));
vi.mock('./damage-claims-v2', () => ({ readClaimBookingHold: async () => ({ held: h.claim }) }));
vi.mock('./overstay-penalty-service', () => ({ hasChefUnpaidPenalties: async () => h.holdover }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: async () => ({ platformCommissionInCents: 100 }) }));
vi.mock('./storage-rental-notices', () => ({ queueStorageRentalNotice: h.notices }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: h.timer }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn() } }));
vi.mock('../email', () => ({ renderTransactionalEmail: vi.fn() }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `SB-${randomUUID()}` }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: vi.fn() }));
vi.mock('./storage-payouts', () => ({ storageTermStillEligible: async () => false, scheduleStorageTermPayout: vi.fn() }));

import { assertRentalAcceptance, createRentalCheckout, decideRental, expireRental, fulfillRentalCheckout, quoteRental,
  readRental, rentalIntentCanceled, storageRentalStripe, storageTermStillEligible, sweepStorageRentalRequests, withdrawRental } from './storage-rentals';

let pg: PGlite;
const { kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, platformSettings,
  kitchenCancellationPolicies, kitchenCheckoutIncidents, users } = schema;
const tables = [kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, platformSettings, kitchenCancellationPolicies, kitchenCheckoutIncidents, users];
const dialect = new PgDialect();
const now = new Date('2026-10-16T12:00:00Z');
const input = { listingId: 1, startOn: '2026-10-17', days: 3, requestKey: 'fixture_request', expectedTotalCents: 3550,
  acceptedTermsVersion: 'storage-v1', cancellationPolicyVersion: 1, disclosureVersion: 'storage-v1', quotedAt: now.toISOString() };
const intents = new Map<string, any>();
const stripe = { checkout: { sessions: { create: vi.fn() } }, paymentIntents: {
  retrieve: vi.fn(async (id: string) => ({ ...intents.get(id) })),
  capture: vi.fn(async (id: string) => { const intent = intents.get(id); Object.assign(intent, { status: 'succeeded', amount_received: intent.amount }); return { ...intent }; }),
  cancel: vi.fn(async (id: string) => { const intent = intents.get(id); Object.assign(intent, { status: 'canceled' }); return { ...intent }; }),
} };
const provider = stripe as any;
const rows = (table: any) => h.db.select().from(table);
const one = async (table: any) => (await rows(table))[0];
const approveActor = { id: 2, role: 'manager' as const };

beforeAll(async () => {
  pg = new PGlite({ extensions: { btree_gist } });
  h.db = drizzle(pg);
  // Use the production column definitions; omit unrelated FKs, retain the actual storage constraints below.
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(c => {
      const type = c.enumValues ? 'text' : c.getSQLType();
      const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
        ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
      return `"${c.name}" ${type}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
  const migration = readFileSync(new URL('../../migrations/0093_storage_rentals.sql', import.meta.url), 'utf8');
  await pg.exec(`CREATE EXTENSION btree_gist; ${migration.match(/ALTER TABLE storage_bookings ADD CONSTRAINT storage_unit_no_overlap[\s\S]*?;/)![0]}
    CREATE UNIQUE INDEX rental_term_intent ON storage_rental_terms(payment_intent_id);
    CREATE UNIQUE INDEX rental_term_request ON storage_rental_terms(request_key);
    CREATE UNIQUE INDEX incident_session ON kitchen_checkout_incidents(session_id);
    CREATE UNIQUE INDEX first_term ON storage_rental_terms(rental_id,seq);
    ${migration.match(/CREATE UNIQUE INDEX storage_terms_one_open[^;]+;/)![0]}
    ALTER TABLE storage_rental_terms ADD CHECK (ends_on = starts_on + days - 1);`);
}, 120000);
afterAll(async () => { await pg?.close(); vi.useRealTimers(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.clearAllMocks(); intents.clear(); h.canBook = true; h.claim = false; h.holdover = false;
  for (const table of tables) await h.db.delete(table);
  await h.db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' });
  await h.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour', taxRatePercent: '15' });
  await h.db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', isActive: true, status: 'approved', pricingModel: 'daily', basePrice: '1000', unitCount: 1 });
  await h.db.insert(kitchenCancellationPolicies).values({ id: 1, kitchenId: 1, version: 1, status: 'published', noticeHours: 48, lateChargePercent: 50 });
  stripe.checkout.sessions.create.mockImplementation(async (params: any) => ({ id: 'cs_test_fixture', livemode: false, url: 'https://checkout.stripe.test/fixture', ...params }));
}, 30000);

async function checkout(suffix = 'a', chef = 3) {
  await createRentalCheckout(chef, { ...input, requestKey: `request_${suffix}` }, provider, now);
  const params = stripe.checkout.sessions.create.mock.calls.at(-1)![0] as any;
  const intent = { id: `pi_${suffix}`, livemode: false, status: 'requires_capture', amount: 3550, amount_received: 0, currency: 'cad',
    customer: 'cus_fixture', payment_method: 'pm_fixture', metadata: params.metadata };
  intents.set(intent.id, intent);
  return { id: `cs_test_${suffix}`, livemode: false, metadata: params.metadata, payment_intent: intent.id, amount_total: 3550, status: 'complete', currency: 'cad' } as any;
}
async function rental() { const session = await checkout(); const result = await fulfillRentalCheckout(session, provider); return result.rentalId!; }

describe('standalone storage request and Checkout', () => {
  it('computes the daily quote and rejects price/policy/disclosure tampering before provider I/O', async () => {
    expect(await quoteRental(3, input, now)).toMatchObject({ subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100, totalCents: 3550, maxTermDays: 30 });
    for (const patch of [{ expectedTotalCents: 1 }, { cancellationPolicyVersion: 2 }, { disclosureVersion: 'old' }, { acceptedTermsVersion: 'old' }])
      await expect(createRentalCheckout(3, { ...input, ...patch }, provider, now)).rejects.toMatchObject({ status: 409 });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(() => assertRentalAcceptance({ ...input, expectedTotalCents: 1 }, 3550, 1)).toThrow('price_changed');
  });
  it('a newly created (active) listing can be rented, like the chef listing pages show it; drafts cannot (live #53)', async () => {
    await h.db.update(storageListings).set({ status: 'active' });
    expect(await quoteRental(3, input, now)).toMatchObject({ totalCents: 3550 });
    await h.db.update(storageListings).set({ status: 'draft' });
    await expect(quoteRental(3, input, now)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('enforces approved chef, claim/holdover holds, start window and kitchen/platform max', async () => {
    h.canBook = false; await expect(quoteRental(3, input, now)).rejects.toMatchObject({ code: 'approval_required', status: 403 }); h.canBook = true;
    h.claim = true; await expect(quoteRental(3, input, now)).rejects.toMatchObject({ code: 'claim_hold' }); h.claim = false;
    h.holdover = true; await expect(quoteRental(3, input, now)).rejects.toMatchObject({ code: 'unpaid_holdover' }); h.holdover = false;
    await expect(quoteRental(3, { ...input, startOn: '2026-10-31' }, now)).rejects.toMatchObject({ status: 400 });
    await h.db.update(storageListings).set({ maxTermDays: 2 });
    await expect(quoteRental(3, input, now)).rejects.toMatchObject({ status: 400 });
  });
  it('creates no rows before the webhook, uses manual capture, and freezes terms with the payout gate atomically', async () => {
    const session = await checkout();
    expect(await rows(storageBookings)).toHaveLength(0);
    expect(stripe.checkout.sessions.create.mock.calls[0]).toMatchObject([{ payment_intent_data: { capture_method: 'manual', setup_future_usage: 'on_session' }, customer_creation: 'always' }, { idempotencyKey: 'storage-rental:3:request_a' }]);
    const { rentalId } = await fulfillRentalCheckout(session, provider);
    expect(await one(storageBookings)).toMatchObject({ id: rentalId, rentalState: 'requested', kitchenBookingId: null, unitIndex: 1,
      rentalTerms: { version: 'storage-v1', graceDays: 5, removalReviewAfterDays: 15, cancellationPolicySnapshot: { noticeHours: 48, lateChargePercent: 50, disclosureVersion: 'storage-v1' } } });
    expect(await one(paymentTransactions)).toMatchObject({ bookingType: 'storage', payoutTiming: 'storage_term', status: 'authorized', metadata: { storageTermId: expect.any(Number) } });
    expect(h.timer).toHaveBeenCalledWith('storage_request', rentalId, new Date(now.getTime() + 86400000));
  });
  it('retries one checkout key with identical provider parameters and refuses stale quotes', async () => {
    await createRentalCheckout(3, input, provider, now);
    await createRentalCheckout(3, input, provider, new Date(now.getTime() + 5000));
    expect(stripe.checkout.sessions.create.mock.calls[0]).toEqual(stripe.checkout.sessions.create.mock.calls[1]);
    await expect(createRentalCheckout(3, input, provider, new Date(now.getTime() + 61000))).rejects.toMatchObject({ status: 409, code: 'quote_expired' });
  });
  it('replays create exactly one rental, term and payment', async () => {
    const session = await checkout();
    const results = await Promise.all([fulfillRentalCheckout(session, provider), fulfillRentalCheckout(session, provider)]);
    expect(results[0]).toEqual(results[1]);
    for (const table of [storageBookings, storageRentalTerms, paymentTransactions]) expect(await rows(table)).toHaveLength(1);
    expect(h.notices).toHaveBeenCalledTimes(1);
  });
  it('releases a new hold reusing an already fulfilled request key after provider idempotency expires', async () => {
    await h.db.update(storageListings).set({ unitCount: 2 });
    const first = await checkout('a'), second = await checkout('b'); second.metadata.request_key = first.metadata.request_key;
    await fulfillRentalCheckout(first, provider);
    expect(await fulfillRentalCheckout(second, provider)).toEqual({ full: true });
    expect(await rows(storageBookings)).toHaveLength(1); expect(intents.get('pi_b').status).toBe('canceled');
  });
  it('serializes last-unit requests: the loser is full and its hold is canceled, including replay', async () => {
    const first = await checkout('a'), second = await checkout('b', 4);
    const results = await Promise.all([fulfillRentalCheckout(first, provider), fulfillRentalCheckout(second, provider)]);
    expect(results.filter(r => r.rentalId)).toHaveLength(1); expect(results.filter(r => r.full)).toHaveLength(1);
    expect(await rows(storageBookings)).toHaveLength(1);
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(intents.get('pi_b').status).toBe('canceled');
    await expect(fulfillRentalCheckout(second, provider)).resolves.toEqual({ full: true });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale completed Checkout and durably releases its hold', async () => {
    const session = await checkout();
    await h.db.update(storageListings).set({ basePrice: '2000' });
    expect(await fulfillRentalCheckout(session, provider)).toEqual({ full: true });
    expect(await rows(storageBookings)).toHaveLength(0);
    expect(await one(kitchenCheckoutIncidents)).toMatchObject({ inventoryConflict: true, moneyStatus: 'hold_released' });
  });
});

describe('storage decisions and exact expiry', () => {
  it('approves with one persisted capture operation and shifts late approval dates and cancellation start', async () => {
    const id = await rental();
    await h.db.update(storageBookings).set({ termStart: '2026-10-15', paidThrough: '2026-10-17' });
    stripe.paymentIntents.capture.mockImplementationOnce(async (intentId: string) => {
      expect((await one(storageRentalTerms)).operation).toMatchObject({ action: 'reserved', state: 'pending' });
      expect((await one(paymentTransactions)).payoutTiming).toBe('storage_term');
      const intent = intents.get(intentId); Object.assign(intent, { status: 'succeeded', amount_received: intent.amount }); return { ...intent };
    });
    await decideRental(id, 'reserved', approveActor, { now }, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'reserved', termStart: '2026-10-16', paidThrough: '2026-10-18', rentalTerms: { cancellationPolicySnapshot: { sessions: [{ startAt: '2026-10-16T02:30:00.000Z' }] } } });
    expect(await one(paymentTransactions)).toMatchObject({ payoutTiming: 'storage_term', payoutReleasedAt: null, payoutEligibleAt: new Date('2026-10-19T02:30:00Z') });
    await decideRental(id, 'reserved', approveActor, { now }, provider);
    expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
  });
  it('refuses approval at the deadline without capturing', async () => {
    const id = await rental();
    await expect(decideRental(id, 'reserved', approveActor, { now: new Date(now.getTime() + 86400000) }, provider)).rejects.toMatchObject({ code: 'deadline_passed', status: 409 });
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
  it('timer vs worker expiry releases once and queues one expiration', async () => {
    const id = await rental(); vi.setSystemTime(new Date(now.getTime() + 86400000));
    await Promise.all([expireRental(id, new Date(), provider), sweepStorageRentalRequests(3, new Date(), provider)]);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'expired', occupancy: null, paymentStatus: 'failed' });
    expect(h.notices.mock.calls.filter(c => c[2] === 'expired')).toHaveLength(1);
    // Both contenders may call Stripe, but they use the exact same idempotency key.
    expect(new Set(stripe.paymentIntents.cancel.mock.calls.map(c => (c as any)[2].idempotencyKey)).size).toBe(1);
  });
  it('withdraws for free and rejects another chef or manager', async () => {
    const id = await rental();
    await expect(withdrawRental(id, 9, provider)).rejects.toMatchObject({ status: 404 });
    await expect(decideRental(id, 'reserved', { id: 9, role: 'manager' }, {}, provider)).rejects.toMatchObject({ status: 404 });
    await withdrawRental(id, 3, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'withdrawn', occupancy: null });
    expect(h.notices.mock.calls.at(-1)![2]).toBe('withdrawn');
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
  it('declines with a saved kitchen reason and cancels the hold', async () => {
    const id = await rental();
    await decideRental(id, 'declined', approveActor, { reason: 'Unavailable for these dates' }, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'declined', declineReason: 'Unavailable for these dates', occupancy: null });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1); expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
  it('a saved capture survives an ambiguous timeout and is recovered by the bounded worker', async () => {
    const id = await rental();
    stripe.paymentIntents.capture.mockRejectedValueOnce(Error('provider timeout'));
    await expect(decideRental(id, 'reserved', approveActor, {}, provider)).rejects.toThrow('provider timeout');
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'requested' });
    expect(await one(storageRentalTerms)).toMatchObject({ operation: { state: 'pending', action: 'reserved' } });
    expect(await one(kitchenCheckoutIncidents)).toMatchObject({ outcome: 'needs_support', moneyStatus: 'unverified' });
    await sweepStorageRentalRequests(3, now, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'reserved' });
    expect(await one(kitchenCheckoutIncidents)).toMatchObject({ outcome: 'closed', moneyStatus: 'paid' });
    expect(stripe.paymentIntents.capture.mock.calls[0]).toEqual(stripe.paymentIntents.capture.mock.calls[1]);
  });
  it('a stale cancellation webhook cannot undo a completed approval', async () => {
    const id = await rental();
    await decideRental(id, 'reserved', approveActor, {}, provider);
    await rentalIntentCanceled({ ...intents.get('pi_a'), status: 'canceled' }, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'reserved' });
    expect(h.notices.mock.calls.filter(c => c[2] === 'approved')).toHaveLength(1);
  });
  it('provider cancellation before deadline expires the rental and cannot undo approval', async () => {
    const id = await rental(); Object.assign(intents.get('pi_a'), { status: 'canceled' });
    await rentalIntentCanceled(intents.get('pi_a'), provider);
    expect(await one(storageBookings)).toMatchObject({ id, rentalState: 'expired' });
    await rentalIntentCanceled(intents.get('pi_a'), provider);
    expect(h.notices.mock.calls.filter(c => c[2] === 'authorization_lapsed')).toHaveLength(1);
  });
  it('recovers a captured approval after a timeout without charging again', async () => {
    const id = await rental();
    stripe.paymentIntents.capture.mockImplementationOnce(async (intentId: string) => { Object.assign(intents.get(intentId), { status: 'succeeded', amount_received: 3550 }); throw Error('timeout'); });
    await decideRental(id, 'reserved', approveActor, {}, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'reserved' });
    expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
  });
  it('a lapsed hold becomes expired and tells the chef no payment was taken', async () => {
    const id = await rental(); intents.get('pi_a').status = 'canceled';
    await decideRental(id, 'reserved', approveActor, {}, provider);
    expect(await one(storageBookings)).toMatchObject({ rentalState: 'expired', occupancy: null });
    expect(h.notices.mock.calls.at(-1)![2]).toBe('authorization_lapsed');
  });
  it('exposes only owned DTOs and server-computed actions, never payment operation ids', async () => {
    const id = await rental();
    expect(await readRental(id, { id: 3, role: 'chef' }, now)).toMatchObject({ actions: ['withdraw'], terms: [{ totalCents: 3550 }] });
    const dto = await readRental(id, approveActor, now);
    expect(dto.actions).toEqual(['approve', 'decline']); expect(JSON.stringify(dto)).not.toMatch(/pi_a|cs_test_a|storage-decision/);
    expect((await readRental(id, approveActor, new Date(now.getTime() + 86400000))).actions).toEqual(['decline']);
    expect(await storageTermStillEligible(id, h.db)).toBe(false);
    await h.db.update(storageBookings).set({ rentalState: 'active', termStart: '2026-10-16', paidThrough: '2026-10-22' }).where(eq(storageBookings.id, id));
    expect((await readRental(id, { id: 3, role: 'chef' }, now)).actions).toContain('extend');
    expect((await readRental(id, approveActor, now)).actions).not.toContain('extend');
    await h.db.update(storageBookings).set({ paidThrough: '2026-11-05' }).where(eq(storageBookings.id, id));
    expect((await readRental(id, { id: 3, role: 'chef' }, now)).actions).not.toContain('extend');
  });
  it('refuses live keys before any Stripe request', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_not_a_secret');
    expect(storageRentalStripe).toThrow('sandbox_only'); vi.unstubAllEnvs();
  });
});
