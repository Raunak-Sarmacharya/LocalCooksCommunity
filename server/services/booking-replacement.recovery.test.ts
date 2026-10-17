import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { bookingLifecycleEvents, equipmentBookings, kitchenBookings, kitchenBookingVisits, kitchenCheckoutHolds, kitchens, locations,
  paymentTransactions, storageBookings } from '@shared/schema';

// Real SQL and transactions; no external database, card provider, or mail delivery.
const h = vi.hoisted(() => ({ db: null as any, client: null as any, afterExclusion: null as null | (() => Promise<void>),
  pauseCompletion: false, failNotice: '', decide: vi.fn(), queue: vi.fn(), capture: vi.fn(), intent: vi.fn(), session: vi.fn(), conflict: vi.fn(),
  inTransaction: 0, sql: [] as string[] }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_target, key) => {
  if (key === 'transaction') return (run: any) => h.db.transaction(async (tx: any) => {
    h.inTransaction++;
    try { return await run(tx); } finally { h.inTransaction--; }
  });
  return typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key];
} }), pool: { connect: async () => ({ query: vi.fn(), release: vi.fn() }) } }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => 'KB-NEW' }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./booking-response-deadline', () => ({ getBookingResponseDeadline: async () => new Date('2099-01-01T09:00:00Z') }));
vi.mock('./booking-policy-settings', () => ({ kitchenBookingPolicies: async () => {
  const hook = h.afterExclusion; h.afterExclusion = null;
  await hook?.();
  return { timezone: 'UTC', turnoverBufferEnabled: false };
} }));
vi.mock('./kitchen-checkout-incidents', () => ({ registerKitchenCheckout: vi.fn(), checkoutIncident: async () => ({ chefId: 3, kitchenId: 4 }),
  updateCheckoutIncident: vi.fn(), recordCheckoutConflict: h.conflict, resolveCheckoutConflict: async () => -1 }));
vi.mock('./booking-lifecycle-delivery', () => ({ deliverBookingLifecycleEvents: vi.fn(async () => ({})), queueBookingLifecycleEvent: h.queue }));
vi.mock('./booking-payment-decision', async original => ({ ...await original<typeof import('./booking-payment-decision')>(), decideAuthorizedBooking: h.decide }));
vi.mock('./booking-replacement', async original => {
  const real = await original<typeof import('./booking-replacement')>();
  return { ...real, completeReplacementSafely: (...args: Parameters<typeof real.completeReplacementSafely>) => h.pauseCompletion ? null : real.completeReplacementSafely(...args) };
});
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: h.intent, getBookingCheckoutSession: h.session,
  capturePaymentIntent: h.capture, cancelPaymentIntent: vi.fn() }));

import { fulfillQuotedKitchenBooking } from './booking-checkout-fulfillment';
import { completeReplacement, readReplacementOutcome, recordReplacementPending, retryStuckReplacements } from './booking-replacement';
import { workerContext } from './worker-context';

const session = (date = '2099-01-01'): any => ({ id: 'cs_replacement', currency: 'cad', amount_total: 2440, metadata: {
  kitchen_id: '4', chef_id: '3', booking_date: date, start_time: '10:00', end_time: '12:00', replaces_booking_id: '10',
  total_price_cents: '2000', tax_cents: '300', platform_fee_cents: '140', tax_rate_percent: '15',
  fee_model: 'separate-charge-commission-v1', addon_prices: '{"s":[],"e":[]}', hourly_rate_cents: '1000', duration_hours: '2' } });
const intent: any = { id: 'pi_new', amount: 2440, status: 'requires_capture' };
const old = (id = 10) => ({ id, kitchenId: 4, chefId: 3, referenceCode: `KB-OLD${id}`, paymentIntentId: `pi_old${id}`,
  bookingDate: new Date('2099-01-01T12:00:00Z'), startTime: '10:00', endTime: '11:00', paymentStatus: 'authorized' as const });
const events = () => h.db.select().from(bookingLifecycleEvents).orderBy(bookingLifecycleEvents.id);
const original = async () => (await h.db.select().from(kitchenBookings).where(eq(kitchenBookings.id, 10)))[0];

beforeAll(async () => {
  const fixture = await createTestDatabase([locations, kitchens, kitchenBookings, kitchenBookingVisits, kitchenCheckoutHolds, storageBookings, equipmentBookings, paymentTransactions, bookingLifecycleEvents]);
  h.client = fixture.client;
  // Capture generated SQL as well as executing it, so tests fail if the lock or query bound disappears.
  h.db = drizzle(h.client, { logger: { logQuery: (query: string) => { h.sql.push(query); } } });
}, 30_000);
afterAll(async () => { await h.client?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); h.inTransaction = 0; h.sql = []; h.afterExclusion = null; h.pauseCompletion = false; h.failNotice = '';
  await h.client.exec('TRUNCATE booking_lifecycle_events, kitchen_bookings, payment_transactions, kitchens, locations RESTART IDENTITY');
  await h.db.insert(locations).values({ id: 1, name: 'Harbour', address: '12 Water Street', managerId: 2, timezone: 'UTC' });
  await h.db.insert(kitchens).values({ id: 4, locationId: 1, name: 'Harbour Kitchen' });
  await h.db.insert(kitchenBookings).values(old());
  await h.db.insert(paymentTransactions).values({ bookingId: 10, bookingType: 'kitchen', amount: '2440', baseAmount: '2300',
    managerRevenue: '2300', netAmount: '2440', chefId: 3, managerId: 2, status: 'authorized', paymentIntentId: 'pi_old10' });
  h.queue.mockImplementation(async (tx, bookingId, kind, title, message, actorId, metadata = {}) => {
    if (kind === h.failNotice) throw new Error('outbox unavailable');
    await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, title, message, actorId, metadata });
  });
  h.decide.mockImplementation(async id => {
    expect(h.inTransaction).toBe(0);
    await h.db.update(kitchenBookings).set({ status: 'cancelled', paymentStatus: 'failed' }).where(eq(kitchenBookings.id, id));
  });
});

describe('replacement transaction and recovery', () => {
  it('acceptance after the exclusion read wins the original lock and blocks an overlapping replacement', async () => {
    const real = await vi.importActual<typeof import('./booking-payment-decision')>('./booking-payment-decision');
    h.intent.mockResolvedValue({ id: 'pi_old10', status: 'requires_capture', amount: 2440 });
    h.session.mockResolvedValue({ ...session(), status: 'complete', metadata: { ...session().metadata, type: 'kitchen_booking' } });
    h.capture.mockRejectedValue(new Error('capture timeout'));
    h.afterExclusion = async () => {
      // fulfillKitchenCheckout has read the old request as undecided and excluded its hours by this point.
      expect((await original()).paymentDecision).toBeNull();
      await expect(real.decideAuthorizedBooking(10, 'confirmed')).rejects.toThrow('capture timeout');
      expect((await original()).paymentDecision.target).toBe('confirmed');
    };
    expect(await fulfillQuotedKitchenBooking(session(), intent, {} as any)).toBe(-1);
    expect(await h.db.select().from(kitchenBookings)).toHaveLength(1);
    expect(h.conflict).toHaveBeenCalledWith('cs_replacement');
    expect(h.sql.some(query => /for update/i.test(query) && query.includes('kitchen_bookings'))).toBe(true);
  });

  it('replacement locks and records the withdrawal before post-commit acceptance can decide', async () => {
    h.pauseCompletion = true;
    const newId = await fulfillQuotedKitchenBooking(session(), intent, {} as any);
    const saved = await original();
    expect(saved.paymentDecision).toMatchObject({ target: 'cancelled', state: 'pending', authorizedAmount: 2440,
      replacedBy: { bookingId: newId, reference: 'KB-NEW' } });
    expect(h.intent).not.toHaveBeenCalled();
    const real = await vi.importActual<typeof import('./booking-payment-decision')>('./booking-payment-decision');
    await expect(real.decideAuthorizedBooking(10, 'confirmed')).rejects.toThrow('different payment decision');
    expect(h.capture).not.toHaveBeenCalled();
    expect(await readReplacementOutcome(newId, 3)).toMatchObject({ outcome: 'pending', oldBookingId: 10 });
    // Simulate a process stopping after commit: no completion or status/notice retry from the webhook.
    h.pauseCompletion = false;
    expect(await retryStuckReplacements()).toEqual({ processed: 1, completed: 1 });
    expect(await readReplacementOutcome(newId, 3)).toMatchObject({ outcome: 'withdrawn' });
  });

  it('rolls back the original withdrawal and the new pair if the creation outbox fails', async () => {
    h.failNotice = 'requested';
    await expect(fulfillQuotedKitchenBooking(session(), intent, {} as any)).rejects.toThrow('outbox unavailable');
    expect(await h.db.select().from(kitchenBookings)).toHaveLength(1);
    expect((await original()).paymentDecision).toBeNull();
    expect(await events()).toHaveLength(0);
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('also freezes the original withdrawal when the new checkout payment was already captured', async () => {
    h.pauseCompletion = true;
    const id = await fulfillQuotedKitchenBooking(session(), { ...intent, status: 'succeeded' }, {} as any);
    expect((await original()).paymentDecision).toMatchObject({ target: 'cancelled', replacedBy: { bookingId: id } });
    expect(h.intent).not.toHaveBeenCalled();
  });

  it.each(['confirmed', 'cancelled'])('a non-overlapping replacement stands when a %s decision already exists', async target => {
    await h.db.update(kitchenBookings).set({ paymentDecision: { target, state: 'pending' } }).where(eq(kitchenBookings.id, 10));
    const id = await fulfillQuotedKitchenBooking(session('2099-01-03'), intent, {} as any);
    expect(id).toBeGreaterThan(0);
    expect(h.decide).not.toHaveBeenCalled();
    expect(await readReplacementOutcome(id, 3)).toMatchObject({ outcome: target === 'confirmed' ? 'two_bookings' : 'releasing' });
  });

  it('concurrent webhook/worker completion commits one status, one notice, and exactly one of each history link', async () => {
    h.pauseCompletion = true;
    const id = await fulfillQuotedKitchenBooking(session(), intent, {} as any);
    await h.db.update(kitchenBookings).set({ status: 'cancelled' }).where(eq(kitchenBookings.id, 10));
    await Promise.all([completeReplacement(id, 10), completeReplacement(id, 10), completeReplacement(id, 10)]);
    let rows = await events();
    expect(rows.filter((row: any) => row.kind === 'replacement_status' && row.metadata.outcome === 'withdrawn')).toHaveLength(1);
    expect(rows.filter((row: any) => row.kind === 'replaced_by')).toHaveLength(1);
    expect(rows.filter((row: any) => row.kind === 'replaces')).toHaveLength(1);
    // Acceptance races queue a chef warning; concurrent replays must still queue it only once.
    await h.db.insert(kitchenBookings).values({ ...old(20), startTime: '15:00', endTime: '16:00' });
    await h.db.update(kitchenBookings).set({ status: 'confirmed' }).where(eq(kitchenBookings.id, 20));
    await h.db.insert(kitchenBookings).values({ ...old(21), startTime: '17:00', endTime: '18:00' });
    await h.db.transaction((tx: any) => recordReplacementPending(tx, 21, 20, 'KB-OLD20'));
    await Promise.all([completeReplacement(21, 20), completeReplacement(21, 20), completeReplacement(21, 20)]);
    rows = await events();
    expect(rows.filter((row: any) => row.kind === 'request_replacement_update' && row.bookingId === 21)).toHaveLength(1);
    expect(rows.filter((row: any) => row.kind === 'replacement_status' && row.metadata.outcome === 'two_bookings')).toHaveLength(1);
    expect(h.sql.filter(query => /select "id" from "kitchen_bookings".*for update/i.test(query)).length).toBeGreaterThanOrEqual(6);
  });

  it('retains discoverable pending work if the terminal notice transaction fails', async () => {
    await h.db.update(kitchenBookings).set({ status: 'confirmed' }).where(eq(kitchenBookings.id, 10));
    h.failNotice = 'request_replacement_update';
    const id = await fulfillQuotedKitchenBooking(session('2099-01-03'), intent, {} as any);
    expect(await readReplacementOutcome(id, 3)).toMatchObject({ outcome: 'pending' });
    expect((await events()).some((row: any) => row.kind === 'request_replacement_update')).toBe(false);
    h.failNotice = '';
    expect(await retryStuckReplacements()).toEqual({ processed: 1, completed: 1 });
    expect(await readReplacementOutcome(id, 3)).toMatchObject({ outcome: 'two_bookings' });
  });

  it('cursor pages rotate past three permanent failures, bound SQL, and exclude support-only cases', async () => {
    for (let index = 0; index < 5; index++) {
      const source = 20 + index * 2, next = source + 1;
      await h.db.insert(kitchenBookings).values([old(source), old(next)]);
      await h.db.transaction((tx: any) => recordReplacementPending(tx, next, source, `KB-OLD${source}`));
    }
    await h.db.update(kitchenBookings).set({ paymentDecision: { target: 'cancelled', state: 'pending', deadEnd: { kind: 'captured_before_release' } } })
      .where(eq(kitchenBookings.id, 28));
    h.decide.mockImplementation(async id => {
      expect(workerContext.getStore()?.cursors.replacementRecovery).toBeGreaterThan(0);
      if (id < 26) throw new Error('provider unavailable');
      await h.db.update(kitchenBookings).set({ status: 'cancelled' }).where(eq(kitchenBookings.id, id));
    });
    const cursors: Record<string, number> = {};
    const context = { database: h.db, deadline: performance.now() + 60_000, taskDeadline: performance.now() + 60_000, cursors,
      checkpoint: async (key: string, id: number) => { cursors[key] = id; } };
    await workerContext.run(context, async () => {
      expect(await retryStuckReplacements()).toEqual({ processed: 3, completed: 0 });
      // Failed releases wrote newer status rows; their higher IDs must not hide the fourth original pending pair.
      expect(await retryStuckReplacements()).toEqual({ processed: 3, completed: 1 });
    });
    expect(h.decide.mock.calls.some(([id]) => id === 26)).toBe(true);
    expect(h.decide.mock.calls.some(([id]) => id === 28)).toBe(false);
    // A crash between marking the financial dead end and saving the replacement status still shows support copy.
    expect(await readReplacementOutcome(29, 3)).toMatchObject({ outcome: 'needs_support' });
    const pages = h.sql.filter(query => query.includes('NOT EXISTS') && query.includes('booking_lifecycle_events'));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.every(query => /limit \$\d+/i.test(query))).toBe(true);
  });
});
