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
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: vi.fn(), BookingMoneyFrozen: class extends Error {} }));

import { quoteExtension, payExtension, syncStorageTerm, recoverStorageTerms, handleStorageTermWebhook } from './storage-extensions';

let pg: PGlite;
const { kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, platformSettings,
  kitchenCancellationPolicies, kitchenCheckoutIncidents, users, bookingFlags, supportActions } = schema;
const tables = [kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, platformSettings, kitchenCancellationPolicies, kitchenCheckoutIncidents, users, bookingFlags, supportActions];
const dialect = new PgDialect();
const now = new Date('2026-10-16T12:00:00Z');
const intents = new Map<string, any>();
const sessions = new Map<string, any>();
const stripe = { paymentMethods: { retrieve: vi.fn(async () => ({ livemode: false, customer: 'cus_chef', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } })) }, checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(async (id: string) => ({ ...sessions.get(id) })), list: vi.fn(async () => ({ data: [...sessions.values()], has_more: false })) } }, paymentIntents: {
  create: vi.fn(), search: vi.fn(async () => ({ data: [...intents.values()], has_more: false })),
  retrieve: vi.fn(async (id: string) => ({ ...intents.get(id) })),
  cancel: vi.fn(async (id: string) => { const intent = intents.get(id); Object.assign(intent, { status: 'canceled' }); return { ...intent }; }),
} };
const provider = stripe as any;
const rows = (table: any) => h.db.select().from(table);
const one = async (table: any) => (await rows(table))[0];

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
  vi.clearAllMocks(); intents.clear(); sessions.clear(); h.canBook = true; h.claim = false; h.holdover = false;
  for (const table of tables) await h.db.delete(table);
  await h.db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' });
  await h.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour', taxRatePercent: '15' });
  await h.db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', isActive: true, status: 'approved', pricingModel: 'daily', basePrice: '1000', unitCount: 1 });
  await h.db.insert(kitchenCancellationPolicies).values({ id: 1, kitchenId: 1, version: 1, status: 'published', noticeHours: 48, lateChargePercent: 50 });
  stripe.paymentIntents.create.mockImplementation(async (params: any) => {
    const existing = [...intents.values()].find(i => i.metadata.attempt_key === params.metadata.attempt_key);
    if (existing) return { ...existing };
    const intent = { ...params, id: `pi_term_${intents.size}`, object: 'payment_intent', livemode: false, status: 'succeeded', amount_received: params.amount, latest_charge: 'ch_term' };
    intents.set(intent.id, intent); return { ...intent };
  });
  stripe.checkout.sessions.create.mockImplementation(async (params: any) => {
    const existing = [...sessions.values()].find(s => s.metadata.attempt_key === params.metadata.attempt_key);
    if (existing) return existing;
    const session = { id: `cs_test_${sessions.size}`, object: 'checkout.session', livemode: false, url: 'https://checkout.stripe.test/fixture', status: 'open', ...params };
    sessions.set(session.id, session); return session;
  });
  await h.db.insert(storageBookings).values({ id: 7, chefId: 3, storageListingId: 1, rentalState: 'active', status: 'confirmed', unitIndex: 1,
    termStart: '2026-10-01', paidThrough: '2026-10-18', timezone: 'America/St_Johns', occupancy: '[2026-10-01,2026-10-24)',
    stripeCustomerId: 'cus_chef', stripePaymentMethodId: 'pm_chef', rentalTerms: { version: 'storage-v1', dailyPriceCents: 1000, taxRatePercent: 15 } });
  await h.db.insert(storageRentalTerms).values({ rentalId: 7, seq: 1, kind: 'first', startsOn: '2026-10-01', endsOn: '2026-10-18', days: 18,
    dailyPriceCents: 1000, subtotalCents: 18000, taxCents: 2700, serviceFeeCents: 100, totalCents: 20800, status: 'paid', requestKey: 'first_term' });
}, 30000);


const pay = (patch: Partial<{ days: number; expectedTotalCents: number; requestKey: string; useSavedCard: boolean }> = {}) =>
  payExtension(7, 3, { days: 3, expectedTotalCents: 3550, requestKey: 'extension_key', useSavedCard: true, ...patch }, provider, now);
const extension = async () => (await rows(storageRentalTerms)).find((t: any) => t.kind === 'extension');
const rental = () => one(storageBookings);
async function actionIntent() {
  stripe.paymentIntents.create.mockImplementationOnce(async (params: any) => {
    const intent = { ...params, id: 'pi_3ds', object: 'payment_intent', livemode: false, status: 'requires_action', amount_received: 0, client_secret: 'secret_fixture' };
    intents.set(intent.id, intent); return { ...intent };
  });
  return pay();
}

describe('storage extension payment operations', () => {
  it.each(['reserved', 'active'])('permits %s rentals during grace without the unpaid-holdover gate', async state => {
    h.holdover = true;
    await h.db.update(storageBookings).set({ rentalState: state, paidThrough: '2026-10-14', occupancy: '[2026-10-01,2026-10-20)' });
    expect(await pay()).toMatchObject({ paid: true, rental: { state, paidThrough: '2026-10-17' } });
    expect(await extension()).toMatchObject({ startsOn: '2026-10-15', subtotalCents: 3000 });
  });
  it('double taps commit one attempt, one charge, payment, and paid notice', async () => {
    const results = await Promise.all([pay(), pay()]);
    expect(results.every(r => 'paid' in r && r.paid)).toBe(true);
    expect(intents.size).toBe(1); expect(await rows(paymentTransactions)).toHaveLength(1);
    expect(await extension()).toMatchObject({ status: 'paid', startsOn: '2026-10-19', endsOn: '2026-10-21', operation: { key: expect.stringMatching(/^storage-term:/), attemptKey: expect.any(String), state: 'done' } });
    expect(await rental()).toMatchObject({ paidThrough: '2026-10-21', occupancy: '[2026-10-01,2026-10-27)' });
    expect(await one(paymentTransactions)).toMatchObject({ payoutTiming: 'storage_term', payoutReleasedAt: null, payoutEligibleAt: new Date('2026-10-22T02:30:00Z'), metadata: { storageTermId: expect.any(Number) } });
    expect(h.notices).toHaveBeenCalledTimes(1);
    expect(h.notices).toHaveBeenCalledWith(expect.anything(), 7, 'extended', expect.objectContaining({ amountCents: 3550, paidThrough: '2026-10-21' }));
    expect(stripe.paymentIntents.create.mock.calls[0]).toMatchObject([{ capture_method: 'automatic', confirm: true, off_session: false, use_stripe_sdk: true, metadata: { type: 'storage_term' } }, { idempotencyKey: expect.stringMatching(/^storage-term:/) }]);
  });
  it('recovers a lost response by metadata without another create', async () => {
    const create = stripe.paymentIntents.create.getMockImplementation()!;
    stripe.paymentIntents.create.mockImplementationOnce(async (...args: any[]) => { await (create as any)(...args); throw Error('lost response'); });
    await expect(pay()).rejects.toThrow('lost response');
    expect(await rental()).toMatchObject({ paidThrough: '2026-10-18', occupancy: '[2026-10-01,2026-10-27)' });
    expect(await syncStorageTerm(7, (await extension()).id, 3, provider, now)).toMatchObject({ paid: true });
    expect(stripe.paymentIntents.search).toHaveBeenCalledWith({ query: expect.stringContaining("metadata['attempt_key']"), limit: 10 });
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
  it('a decline is cancelled before restoring the original state and occupancy', async () => {
    stripe.paymentIntents.create.mockImplementationOnce(async (params: any) => {
      const intent = { ...params, id: 'pi_decline', livemode: false, status: 'requires_payment_method', payment_method: null };
      intents.set(intent.id, intent); throw Object.assign(Error('declined'), { payment_intent: intent });
    });
    expect(await pay()).toEqual({ cardFailed: true });
    expect(await rental()).toMatchObject({ rentalState: 'active', paidThrough: '2026-10-18', occupancy: '[2026-10-01,2026-10-24)' });
    expect(await extension()).toMatchObject({ status: 'failed', operation: { state: 'done' } });
    expect(await rows(paymentTransactions)).toHaveLength(0); expect(h.notices).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(await pay()).toEqual({ cardFailed: true }); expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(await pay({ requestKey: 'retry_with_new_key', useSavedCard: false })).toHaveProperty('checkoutUrl');
  });
  it('3DS persists the identity, then sync applies the completed charge once', async () => {
    const result = await actionIntent();
    expect(result).toEqual({ requiresAction: true, clientSecret: 'secret_fixture', termId: (await extension()).id });
    expect(await rental()).toMatchObject({ paidThrough: '2026-10-18' });
    Object.assign(intents.get('pi_3ds'), { status: 'succeeded', amount_received: 3550 });
    await syncStorageTerm(7, (await extension()).id, 3, provider, now);
    await syncStorageTerm(7, (await extension()).id, 3, provider, now);
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1); expect(await rows(paymentTransactions)).toHaveLength(1);
    expect(await rental()).toMatchObject({ paidThrough: '2026-10-21' });
  });
  it('an abandoned 3DS attempt is cancelled after an hour, restoring occupancy and freeing the unit for a new tap', async () => {
    await actionIntent();
    expect(await recoverStorageTerms(provider, 3, new Date(now.getTime() + 20 * 60000))).toEqual({ processed: 1, errors: 0 });
    expect(await extension()).toMatchObject({ status: 'awaiting_payment' }); expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    await recoverStorageTerms(provider, 3, new Date(now.getTime() + 61 * 60000));
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(await extension()).toMatchObject({ status: 'failed', operation: { state: 'done' } });
    expect(await rental()).toMatchObject({ paidThrough: '2026-10-18', occupancy: '[2026-10-01,2026-10-24)' });
    expect(await rows(paymentTransactions)).toHaveLength(0); expect(h.notices).not.toHaveBeenCalled();
    expect(await pay({ requestKey: 'second_try_key' })).toMatchObject({ paid: true });
  });
  it('blocks another request while an attempt is open and rejects another chef', async () => {
    await actionIntent();
    await expect(pay({ requestKey: 'another_request' })).rejects.toMatchObject({ code: 'decision_pending' });
    await expect(syncStorageTerm(7, (await extension()).id, 4, provider, now)).rejects.toMatchObject({ status: 404 });
    await expect(quoteExtension(7, 4, 3, provider, now)).rejects.toMatchObject({ status: 404 });
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
  it('clamps quotes by the next reservation on the same unit and by reclaim', async () => {
    await h.db.insert(storageBookings).values({ id: 8, chefId: 4, storageListingId: 1, unitIndex: 1, rentalState: 'reserved', termStart: '2026-10-26', paidThrough: '2026-10-28', occupancy: '[2026-10-26,2026-11-03)' });
    expect(await quoteExtension(7, 3, 3, provider, now)).toMatchObject({ maxDays: 2, limitReason: 'reservation', card: { brand: 'visa', last4: '4242' } });
    await expect(pay()).rejects.toMatchObject({ code: 'full' });
    await h.db.delete(storageBookings).where(eq(storageBookings.id, 8));
    await h.db.update(storageBookings).set({ reclaimEndOn: '2026-10-19' });
    expect(await quoteExtension(7, 3, 3, provider, now)).toMatchObject({ maxDays: 1, limitReason: 'reclaim' });
    await expect(pay()).rejects.toMatchObject({ code: 'full' });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('enforces the 14-day window and kitchen/platform maximum using frozen daily pricing', async () => {
    await h.db.insert(platformSettings).values({ key: 'storage_max_term_days', value: '10' });
    await h.db.update(storageListings).set({ maxTermDays: 7, basePrice: '9999' });
    expect(await quoteExtension(7, 3, 3, provider, now)).toMatchObject({ maxDays: 7, subtotalCents: 3000, taxCents: 450, totalCents: 3550 });
    await h.db.update(storageBookings).set({ paidThrough: '2026-10-31', occupancy: '[2026-10-01,2026-11-06)' });
    expect(await quoteExtension(7, 3, 3, provider, now)).toMatchObject({ maxDays: 0, limitReason: 'window' });
    await expect(pay()).rejects.toMatchObject({ code: 'full' });
  });
  it('pays grace and holdover days from the old boundary at the normal daily price', async () => {
    await h.db.update(storageBookings).set({ paidThrough: '2026-10-07', occupancy: '[2026-10-01,2026-10-17)' });
    expect(await pay({ days: 9, expectedTotalCents: 10450 })).toMatchObject({ paid: true, rental: { paidThrough: '2026-10-16', phase: 'ending_soon', accruedCents: 0 } });
    expect(await extension()).toMatchObject({ startsOn: '2026-10-08', endsOn: '2026-10-16', subtotalCents: 9000 });
  });
  it('requires removal review to cover today, then returns to active', async () => {
    await h.db.update(storageBookings).set({ rentalState: 'removal_review', paidThrough: '2026-10-01', occupancy: '[2026-10-01,)' });
    await expect(pay()).rejects.toMatchObject({ code: 'invalid_details' });
    expect(await pay({ days: 15, expectedTotalCents: 17350 })).toMatchObject({ paid: true, rental: { state: 'active', paidThrough: '2026-10-16' } });
    expect(await rental()).toMatchObject({ occupancy: '[2026-10-01,2026-10-22)' });
  });
  it('recovery only reads an old committed attempt and finishes its payment', async () => {
    const create = stripe.paymentIntents.create.getMockImplementation()!;
    stripe.paymentIntents.create.mockImplementationOnce(async (...args: any[]) => { await (create as any)(...args); throw Error('lost'); });
    await expect(pay()).rejects.toThrow('lost');
    expect(await recoverStorageTerms(provider, 10, new Date(now.getTime() + 14 * 60000))).toEqual({ processed: 0, errors: 0 });
    expect(await recoverStorageTerms(provider, 10, new Date(now.getTime() + 16 * 60000))).toEqual({ processed: 1, errors: 0 });
    expect(await extension()).toMatchObject({ status: 'paid' }); expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
  it('rolls back payment, dates, and notice together when local commit fails, then recovers', async () => {
    h.notices.mockRejectedValueOnce(Error('outbox unavailable'));
    await expect(pay()).rejects.toThrow('outbox unavailable');
    expect(await rows(paymentTransactions)).toHaveLength(0);
    expect(await rental()).toMatchObject({ paidThrough: '2026-10-18', occupancy: '[2026-10-01,2026-10-27)' });
    expect(await extension()).toMatchObject({ status: 'awaiting_payment', paymentTransactionId: null });
    expect(await recoverStorageTerms(provider, 3, new Date(now.getTime() + 16 * 60000))).toEqual({ processed: 1, errors: 0 });
    expect(await rows(paymentTransactions)).toHaveLength(1); expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
  it('an old chef retry searches instead of reusing a possibly expired provider key', async () => {
    const create = stripe.paymentIntents.create.getMockImplementation()!;
    stripe.paymentIntents.create.mockImplementationOnce(async (...args: any[]) => { await (create as any)(...args); throw Error('lost'); });
    await expect(pay()).rejects.toThrow('lost');
    expect(await payExtension(7, 3, { days: 3, expectedTotalCents: 3550, requestKey: 'extension_key', useSavedCard: true }, provider,
      new Date(now.getTime() + 25 * 3600000))).toMatchObject({ paid: true });
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
  it('a succeeded intent webhook binds a lost identity before search is consistent', async () => {
    const create = stripe.paymentIntents.create.getMockImplementation()!;
    stripe.paymentIntents.create.mockImplementationOnce(async (...args: any[]) => { await (create as any)(...args); throw Error('lost'); });
    await expect(pay()).rejects.toThrow('lost');
    stripe.paymentIntents.search.mockResolvedValueOnce({ data: [], has_more: false });
    expect(await handleStorageTermWebhook(provider, [...intents.values()][0])).toMatchObject({ paid: true });
    expect(stripe.paymentIntents.search).not.toHaveBeenCalled();
  });
  it('an unknown create stays pending for search consistency, then releases without retrying', async () => {
    stripe.paymentIntents.create.mockRejectedValueOnce(Error('unreachable'));
    await expect(pay()).rejects.toThrow('unreachable');
    expect(await recoverStorageTerms(provider, 3, new Date(now.getTime() + 16 * 60000))).toEqual({ processed: 1, errors: 0 });
    expect(await extension()).toMatchObject({ status: 'awaiting_payment' });
    await recoverStorageTerms(provider, 3, new Date(now.getTime() + 61 * 60000));
    expect(await extension()).toMatchObject({ status: 'failed' }); expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(await rental()).toMatchObject({ occupancy: '[2026-10-01,2026-10-24)' });
  });
  it('falls back to Checkout when no saved card and fulfills a signed-session identity without search', async () => {
    await h.db.update(storageBookings).set({ stripeCustomerId: null, stripePaymentMethodId: null });
    expect(await pay()).toHaveProperty('checkoutUrl');
    expect(stripe.checkout.sessions.create.mock.calls[0]).toMatchObject([{ customer_creation: 'always', payment_intent_data: { capture_method: 'automatic', setup_future_usage: 'on_session', metadata: { type: 'storage_term' } } }, { idempotencyKey: expect.stringMatching(/:checkout$/) }]);
    const term = await extension(), session = [...sessions.values()][0];
    const intent = { id: 'pi_checkout', object: 'payment_intent', livemode: false, status: 'succeeded', amount: 3550, amount_received: 3550,
      currency: 'cad', capture_method: 'automatic', customer: 'cus_new', payment_method: 'pm_new', metadata: session.metadata };
    intents.set(intent.id, intent); Object.assign(session, { status: 'complete', payment_intent: intent.id, customer: 'cus_new' });
    expect(await handleStorageTermWebhook(provider, session)).toMatchObject({ paid: true });
    expect(await rental()).toMatchObject({ stripeCustomerId: 'cus_new', stripePaymentMethodId: 'pm_new' });
    await handleStorageTermWebhook(provider, session);
    expect(await rows(paymentTransactions)).toHaveLength(1); expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.search).not.toHaveBeenCalled();
  });
  it('a lost Checkout response is recovered by the worker, including expiry', async () => {
    const create = stripe.checkout.sessions.create.getMockImplementation()!;
    stripe.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => { await (create as any)(...args); throw Error('lost checkout'); });
    await expect(pay({ useSavedCard: false })).rejects.toThrow('lost checkout');
    expect((await extension()).checkoutSessionId).toBeNull();
    const session = [...sessions.values()][0]; session.status = 'expired';
    expect(await recoverStorageTerms(provider, 3, new Date(now.getTime() + 35 * 60000))).toEqual({ processed: 1, errors: 0 });
    expect(await extension()).toMatchObject({ checkoutSessionId: session.id, status: 'failed' });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1); expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('refuses tampered provider amounts, attempts, currency, customer, or live mode', async () => {
    await actionIntent();
    const original = { ...intents.get('pi_3ds') };
    for (const patch of [{ amount: 1 }, { currency: 'usd' }, { customer: 'cus_other' }, { capture_method: 'manual' }, { metadata: { ...original.metadata, attempt_key: 'retired' } }, { livemode: true }]) {
      intents.set('pi_3ds', { ...original, ...patch, status: 'succeeded', amount_received: 3550 });
      await expect(syncStorageTerm(7, (await extension()).id, 3, provider, now)).rejects.toBeInstanceOf(Error);
      expect(await rows(paymentTransactions)).toHaveLength(0);
    }
  });
  it('storage support flags and in-flight actions prevent provider I/O', async () => {
    await h.db.insert(bookingFlags).values({ storageBookingId: 7, kind: 'support' });
    await expect(pay()).rejects.toMatchObject({ code: 'payment_review' });
    await h.db.delete(bookingFlags);
    await h.db.insert(supportActions).values({ storageBookingId: 7, status: 'executing', actionType: 'refund' });
    await expect(pay()).rejects.toMatchObject({ code: 'payment_review' });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled(); expect(await extension()).toBeUndefined();
  });
});
