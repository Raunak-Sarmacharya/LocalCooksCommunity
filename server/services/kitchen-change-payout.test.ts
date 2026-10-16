/**
 * The kitchen's share of an extra booking-change charge: never before the change is applied, and an after-closeout booking pays it
 * out together with the booking's own payout. Real in-process Postgres (PGlite); only Stripe is replaced.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const h = vi.hoisted(() => ({ db: null as any, transfers: [] as any[] }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => { const value = h.db[key]; return typeof value === 'function' ? value.bind(h.db) : value; } }), pool: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => undefined }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: async () => undefined }));
vi.mock('./stripe-service', () => ({ getStripePaymentAmounts: async () => ({ chargeId: 'ch_extra', stripeAmount: 4800, stripeProcessingFee: 160 }) }));
vi.mock('./stripe-transfer-service', () => ({ transferToManagerForBooking: async (params: any) => { h.transfers.push(params); return { transferred: true, transferId: `tr_${params.paymentTransactionId}`, reason: 'ok' }; } }));

import { createTestDatabase } from './kitchen-booking-changes.pglite';
import { kitchenBookingChanges, kitchenBookings, paymentTransactions } from '@shared/schema';
import { releaseKitchenChangePayoutForSource, sweepKitchenChangePayouts } from './kitchen-change-payout';

const slots = [{ startTime: '09:00', endTime: '10:00' }];
async function seed(options: { changeState: string; timing: 'at_capture' | 'after_closeout'; parentReleased?: boolean }) {
  await h.db.execute(`TRUNCATE kitchen_booking_changes, payment_transactions, kitchen_bookings RESTART IDENTITY CASCADE` as any).catch(() => undefined);
  await h.db.delete(kitchenBookingChanges); await h.db.delete(paymentTransactions); await h.db.delete(kitchenBookings);
  h.transfers.length = 0;
  await h.db.insert(kitchenBookings).values({ id: 10, chefId: 3, kitchenId: 4, bookingDate: new Date('2026-11-20T12:00:00Z'), startTime: '09:00', endTime: '10:00', selectedSlots: slots,
    status: 'confirmed', paymentStatus: 'paid', paymentIntentId: 'pi_original' });
  await h.db.insert(kitchenBookingChanges).values({ id: 'chg_1', bookingId: 10, requestKey: 'k', kind: 'move', state: options.changeState, original: {}, destination: {}, quote: {}, policy: {},
    bookingVersion: new Date(), decisionBy: new Date(), managerId: 2 });
  await h.db.insert(paymentTransactions).values({ id: 1, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '9600', baseAmount: '9200', managerRevenue: '9200', netAmount: '9600',
    paymentIntentId: 'pi_original', status: 'succeeded', payoutTiming: options.timing, ...(options.parentReleased ? { payoutReleasedAt: new Date() } : {}),
    payoutEligibleAt: new Date(Date.now() + 5 * 3_600_000) });
  await h.db.insert(paymentTransactions).values({ id: 2, bookingId: 10, bookingType: 'kitchen', chefId: 3, managerId: 2, amount: '4800', baseAmount: '4600', managerRevenue: '4600', netAmount: '4800',
    paymentIntentId: 'pi_extra', status: 'succeeded', payoutTiming: options.timing, metadata: { kitchenChangeId: 'chg_1', originalBookingPaymentIntentId: 'pi_original' } });
}

beforeAll(async () => { h.db = (await createTestDatabase([kitchenBookings, kitchenBookingChanges, paymentTransactions])).db; }, 120_000);

describe('kitchen share of a booking-change charge', () => {
  it('is never paid before the change is applied', async () => {
    await seed({ changeState: 'capture_pending', timing: 'at_capture' });
    expect(await releaseKitchenChangePayoutForSource(2)).toMatchObject({ success: false, deferred: true, reason: 'The booking change is not applied yet' });
    expect(h.transfers).toEqual([]);
  });

  it('is paid at once for an at-capture booking once the change is applied, and only once', async () => {
    await seed({ changeState: 'applied', timing: 'at_capture' });
    expect(await releaseKitchenChangePayoutForSource(2)).toMatchObject({ success: true, transferred: true, transferId: 'tr_2' });
    expect(h.transfers).toHaveLength(1);
    expect(h.transfers[0]).toMatchObject({ paymentTransactionId: 2, paymentIntentId: 'pi_extra', chargeId: 'ch_extra', actualStripeFeeCents: 160 });
    await h.db.update(paymentTransactions).set({ transferId: 'tr_2' }).where(eq(paymentTransactions.id, 2));
    expect(await releaseKitchenChangePayoutForSource(2)).toMatchObject({ success: true, reason: 'Already sent' });
    expect(h.transfers).toHaveLength(1);
  });

  it('waits for the booking’s own payout when that is after closeout, and follows its schedule', async () => {
    await seed({ changeState: 'applied', timing: 'after_closeout' });
    const result = await releaseKitchenChangePayoutForSource(2);
    expect(result).toMatchObject({ success: false, deferred: true, reason: 'Released together with the booking payout' });
    expect(h.transfers).toEqual([]);
    const [source] = await h.db.select().from(paymentTransactions).where(eq(paymentTransactions.id, 2));
    expect(source.payoutEligibleAt.getTime()).toBeGreaterThan(Date.now() + 4 * 3_600_000);
  });

  it('is released with the booking payout once that has gone out', async () => {
    await seed({ changeState: 'applied', timing: 'after_closeout', parentReleased: true });
    expect(await releaseKitchenChangePayoutForSource(2)).toMatchObject({ transferred: true });
    expect(h.transfers).toHaveLength(1);
    const [source] = await h.db.select().from(paymentTransactions).where(eq(paymentTransactions.id, 2));
    expect(source.payoutReleasedAt).toBeTruthy();
    expect((source.metadata as any).payoutRelease.reason).toBe('follows_booking_payout');
  });

  it('ignores payments that are not booking-change charges', async () => {
    await seed({ changeState: 'applied', timing: 'at_capture' });
    expect(await releaseKitchenChangePayoutForSource(1)).toMatchObject({ success: false, reason: 'Not a booking-change charge' });
  });

  it('the worker sweep is bounded and pays only what is due', async () => {
    await seed({ changeState: 'applied', timing: 'at_capture' });
    expect(await sweepKitchenChangePayouts(3)).toEqual({ checked: 1, sent: 1 });
    await expect(sweepKitchenChangePayouts(11)).rejects.toThrow('one to ten');
    await h.db.update(paymentTransactions).set({ transferId: null, payoutEligibleAt: new Date(Date.now() + 3_600_000) }).where(eq(paymentTransactions.id, 2));
    h.transfers.length = 0;
    expect(await sweepKitchenChangePayouts(3)).toEqual({ checked: 0, sent: 0 });
    expect(h.transfers).toEqual([]);
  });
});
