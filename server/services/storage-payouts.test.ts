import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

// Real payout service, refund module, money guard, support flags and transfer engine on in-memory Postgres; Stripe is simulated.
const h = vi.hoisted(() => ({ db: null as any, notices: vi.fn(), refunds: [] as any[], amountRefunded: 0, transfer: null as any, insufficient: false,
  createTransfer: vi.fn(), reverse: vi.fn() }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));
vi.mock('./storage-rental-notices', () => ({ queueStorageRentalNotice: h.notices }));
vi.mock('./booking-documents', () => ({ issueStorageDocumentsSafely: vi.fn(), issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./payout-document-evidence', () => ({ recordPayoutTransferEvidence: vi.fn() }));
vi.mock('./payment-transactions-service', () => ({ addPaymentHistory: vi.fn() }));
vi.mock('./stripe-checkout-fee-service', () => ({ getFeeConfig: async () => ({ platformCommissionRate: 0 }) }));
vi.mock('./booking-cancellation-refund', () => ({
  kitchenFundingShortfall: (error: unknown) => /exceeds the verified unreversed|kitchen transfer reversal has insufficient balance/i.test(String((error as Error)?.message)),
  finalizeCancellationRefund: async (tx: any, source: any, op: any) => (await import('./storage-rental-money')).finalizeStorageRefund(tx, source, op) }));
vi.mock('stripe', () => ({ default: class {
  charges = { retrieve: async () => ({ amount_refunded: h.amountRefunded }) };
  transfers = { retrieve: vi.fn(), list: async function* () {}, listReversals: async function* () {}, create: h.createTransfer, createReversal: vi.fn() };
} }));
vi.mock('./stripe-service', () => ({
  getStripePaymentAmounts: async () => ({ stripeAmount: 3550, stripeProcessingFee: 133, chargeId: 'ch_1' }),
  getCancellationPaymentFacts: async () => ({ captured: 3550, processingCost: 133, currency: 'cad', chargeId: 'ch_1', refunded: h.amountRefunded, refunds: h.refunds }),
  getCancellationReversalEvidence: async () => [],
  reverseTransferAndRefund: async (intentId: string, amount: number, _reason: string, options: any) => {
    h.reverse(options.reverseTransferAmount);
    if (h.transfer && options.reverseTransferAmount > 0 && h.insufficient) throw Error('Failed to reverse transfer and refund: The kitchen transfer reversal has insufficient balance.');
    const refund = { id: `re_${h.refunds.length + 1}`, amount, status: 'succeeded', currency: 'cad', charge: 'ch_1', payment_intent: intentId,
      metadata: { ...options.metadata, refund_operation_id: options.idempotencyKey } };
    h.refunds.push(refund); h.amountRefunded += amount;
    return { refundId: refund.id };
  } }));

import { releaseDueStoragePayouts, releaseStorageTermPayout, scheduleStorageTermPayout, storageTermPayout } from './storage-payouts';
import { refundRentalUnused, storageRefundShares } from './storage-rental-money';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { changeStorageFlag } from './booking-support-flags';

const { kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, users, commitmentProblems, damageClaims,
  bookingFlags, supportActions, kitchenBookingChanges, equipmentBookings } = schema;
const tables = [kitchens, locations, storageListings, storageBookings, storageRentalTerms, paymentTransactions, users, commitmentProblems, damageClaims,
  bookingFlags, supportActions, kitchenBookingChanges, equipmentBookings];
const dialect = new PgDialect();
let pg: PGlite;
const endOfTerm = new Date('2026-10-20T02:30:00Z'); // start of Oct 20 in St. John's (NDT)
const payment = async () => (await h.db.select().from(paymentTransactions).where(eq(paymentTransactions.id, 1)))[0];
const events = () => h.notices.mock.calls.map(call => call[2]);

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  pg = new PGlite();
  h.db = drizzle(pg);
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
}, 120000);
afterAll(async () => { await pg?.close(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.clearAllMocks(); h.refunds = []; h.amountRefunded = 0; h.transfer = null; h.insufficient = false;
  h.createTransfer.mockImplementation(async (params: any) => { h.transfer = { id: 'tr_1', amount: params.amount }; return h.transfer; });
  for (const table of tables) await h.db.delete(table);
  await h.db.insert(users).values([{ id: 2, username: 'kitchen@example.invalid', role: 'manager', stripeConnectAccountId: 'acct_kitchen' },
    { id: 3, username: 'chef@example.invalid', role: 'chef' }]);
  await h.db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' });
  await h.db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour' });
  await h.db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', basePrice: '1000' });
  await h.db.insert(storageBookings).values({ id: 7, referenceCode: 'SB-7', storageListingId: 1, chefId: 3, rentalState: 'active', termStart: '2026-10-17',
    paidThrough: '2026-10-19', timezone: 'America/St_Johns', rentalTerms: { version: 'storage-v1' }, startDate: new Date(), endDate: new Date(), totalPrice: '3000', pricingModel: 'daily' });
  await h.db.insert(storageRentalTerms).values({ id: 1, rentalId: 7, seq: 1, kind: 'first', startsOn: '2026-10-17', endsOn: '2026-10-19', days: 3, dailyPriceCents: 1000,
    subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100, totalCents: 3550, status: 'paid', requestKey: 'k', paymentIntentId: 'pi_1', paymentTransactionId: 1,
    paidAt: new Date('2026-10-16T12:00:00Z') });
  await h.db.insert(paymentTransactions).values({ id: 1, bookingId: 7, bookingType: 'storage', chefId: 3, managerId: 2, amount: '3550', baseAmount: '3450', taxAmount: '450',
    serviceFee: '100', managerRevenue: '3450', netAmount: '3550', currency: 'CAD', paymentIntentId: 'pi_1', status: 'succeeded', payoutTiming: 'storage_term',
    payoutEligibleAt: endOfTerm, paidAt: new Date('2026-10-16T12:00:00Z'), metadata: { storageTermId: 1, platformCommission: 100 } });
});

describe('storage term payout date', () => {
  const term = { endsOn: '2026-10-30', paidAt: new Date('2026-10-16T12:00:00Z') };
  const none = { openProblem: false, openClaim: false, openFlag: false };
  const rental = { endReason: null, checkoutApprovedAt: null, checkoutRequestedAt: null, releasedOn: null, timezone: 'America/St_Johns' } as any;
  it('is the start of the day after the term, earlier when the kitchen clears, after the claim window for an automatic clear', () => {
    expect(storageTermPayout(term, rental, none).eligibleAt.toISOString()).toBe('2026-10-31T02:30:00.000Z');
    expect(storageTermPayout(term, { ...rental, endReason: 'cleared', checkoutApprovedAt: new Date('2026-10-18T15:00:00Z') }, none).eligibleAt.toISOString()).toBe('2026-10-18T15:00:00.000Z');
    expect(storageTermPayout(term, { ...rental, endReason: 'auto_cleared', checkoutRequestedAt: new Date('2026-10-18T12:00:00Z'),
      checkoutApprovedAt: new Date('2026-10-19T12:00:00Z') }, none).eligibleAt.toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(storageTermPayout(term, rental, { ...none, openFlag: true, openProblem: true }).holdReason).toBe('support_flag');
    expect(storageTermPayout(term, rental, { ...none, openClaim: true }).holdReason).toBe('damage_claim');
  });
});

describe('storage payout release', () => {
  it('waits for the end of the term, then pays subtotal + tax − card fee once across two sweeps', async () => {
    expect(await releaseStorageTermPayout(1, 'test', new Date(endOfTerm.getTime() - 1000))).toMatchObject({ deferred: true });
    expect(h.createTransfer).not.toHaveBeenCalled();
    await releaseDueStoragePayouts(3, endOfTerm);
    await releaseDueStoragePayouts(3, endOfTerm);
    expect(h.createTransfer).toHaveBeenCalledTimes(1);
    expect(h.createTransfer.mock.calls[0][0]).toMatchObject({ amount: 3450 - 133, destination: 'acct_kitchen', source_transaction: 'ch_1' });
    expect((await payment()).transferId).toBe('tr_1');
    expect(events().filter(event => event === 'payout_released')).toHaveLength(1);
  });
  it('a problem the chef reported holds it (kitchen told once); resolving it releases', async () => {
    await h.db.insert(commitmentProblems).values({ id: 1, sourceKey: 'p', kind: 'live', storageBookingId: 7, reportedBy: 3, status: 'reported', description: 'x' });
    expect(await releaseStorageTermPayout(1, 'test', endOfTerm)).toMatchObject({ deferred: true, reason: 'On hold: reported_issue' });
    await releaseStorageTermPayout(1, 'test', endOfTerm);
    expect(events().filter(event => event === 'payout_on_hold')).toHaveLength(1);
    await h.db.update(commitmentProblems).set({ status: 'resolved' });
    expect(await releaseStorageTermPayout(1, 'test', endOfTerm)).toMatchObject({ transferred: true });
  });
  it('announces the payout date to the kitchen once', async () => {
    await h.db.transaction((tx: any) => scheduleStorageTermPayout(7, tx, new Date('2026-10-16T13:00:00Z')));
    await h.db.transaction((tx: any) => scheduleStorageTermPayout(7, tx, new Date('2026-10-16T14:00:00Z')));
    expect(h.notices.mock.calls.filter(call => call[2] === 'payout_scheduled')).toHaveLength(1);
    expect(h.notices.mock.calls.find(call => call[2] === 'payout_scheduled')![3]).toMatchObject({ amountCents: 3450, payoutDate: endOfTerm });
  });
  it('a chargeback flags the rental: refunds are frozen, the payout still goes; other flags hold it', async () => {
    await changeStorageFlag(7, 'chargeback', 'du_1', false, undefined, undefined, { title: 'Chargeback · {reference}', message: 'Respond in Stripe.' });
    const [flag] = await h.db.select().from(bookingFlags);
    expect(flag).toMatchObject({ storageBookingId: 7, bookingId: null, kind: 'chargeback' });
    expect(h.notices.mock.calls.find(call => call[2] === 'support_flag')![3].message).toBe('Chargeback · SB-7. Respond in Stripe.');
    await expect(assertBookingMoneyWritable({ storageRentalId: 7 })).rejects.toThrow('paused');
    await expect(assertBookingMoneyWritable({ paymentIntentId: 'pi_1' })).rejects.toThrow('paused');
    await expect(refundRentalUnused(7, { cause: 'goodwill_lc', amountCents: 500, actorId: 9, operationKey: 'gw' })).rejects.toThrow('paused');
    expect(await releaseStorageTermPayout(1, 'test', endOfTerm)).toMatchObject({ transferred: true });

    await h.db.update(paymentTransactions).set({ transferId: null, payoutReleasedAt: null, metadata: { storageTermId: 1, platformCommission: 100 } });
    await changeStorageFlag(7, 'manual_hold', 'hold_1');
    expect(await releaseStorageTermPayout(1, 'test', endOfTerm)).toMatchObject({ deferred: true, reason: 'On hold: support_flag' });
  });
  it('alerts Local Cooks once when a payout is unpaid 10 days after its date', async () => {
    await h.db.insert(damageClaims).values({ id: 1, bookingType: 'storage', storageBookingId: 7, chefId: 3, managerId: 2, locationId: 1, status: 'submitted',
      claimTitle: 'x', claimDescription: 'x', damageDate: '2026-10-19', claimedAmountCents: 100, chefResponseDeadline: new Date() });
    const later = new Date(endOfTerm.getTime() + 11 * 86400000);
    expect((await releaseDueStoragePayouts(3, later)).alerted).toBe(1);
    expect((await releaseDueStoragePayouts(3, later)).alerted).toBe(0);
    expect(h.notices.mock.calls.filter(call => call[2] === 'payout_overdue')).toHaveLength(1);
    expect(h.createTransfer).not.toHaveBeenCalled();
  });
});

describe('storage refunds', () => {
  const reclaim = { cause: 'kitchen' as const, fromDate: '2026-10-19', actorId: 2, operationKey: 'reclaim-1' };
  it('splits unused days pro rata, kitchen share and platform fee share', () => {
    const shares = storageRefundShares([{ id: 1, startsOn: '2026-10-17', endsOn: '2026-10-19', days: 3, subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100,
      totalCents: 3550, paidAt: null, processingFeeCents: 133, refundedCents: 0, remainingKitchenCents: 3317 }], reclaim);
    expect(shares.get(1)).toEqual({ customer: 1183, managerDebited: 1150, feeReturned: 33, goodwill: 0, processing: 0 });
  });
  it('before the payout lowers the transfer without any reversal', async () => {
    const result = await refundRentalUnused(7, reclaim);
    expect(result.refunds).toEqual([{ sourceId: 1, status: 'succeeded', customerRefund: 1183, kitchenDebtCents: 0 }]);
    expect(h.reverse).toHaveBeenCalledWith(1150);
    expect(events()).toEqual(expect.arrayContaining(['refund_issued']));
    expect(await refundRentalUnused(7, reclaim)).toMatchObject({ refunds: [{ status: 'succeeded' }] }); // same key: no second refund
    expect(h.refunds).toHaveLength(1);
    await releaseStorageTermPayout(1, 'test', endOfTerm);
    expect(h.createTransfer.mock.calls[0][0].amount).toBe(3450 - 133 - 1150);
  });
  it('after the payout takes the kitchen share back from the transfer', async () => {
    await releaseStorageTermPayout(1, 'test', endOfTerm);
    await refundRentalUnused(7, reclaim);
    expect(h.reverse).toHaveBeenCalledWith(1150);
    expect((await payment()).metadata.kitchenRefundDebts).toBeUndefined();
    expect(events()).not.toContain('kitchen_debt');
  });
  it('a kitchen balance that cannot cover it becomes a recorded debt and the chef is still refunded', async () => {
    await releaseStorageTermPayout(1, 'test', endOfTerm);
    h.insufficient = true;
    const result = await refundRentalUnused(7, reclaim);
    expect(result.refunds[0]).toMatchObject({ status: 'succeeded', kitchenDebtCents: 1150 });
    expect(h.reverse.mock.calls.map(call => call[0])).toEqual([1150, 0]);
    expect((await payment()).metadata.kitchenRefundDebts).toEqual([expect.objectContaining({ amountCents: 1150, status: 'open', storageRentalId: 7 })]);
    expect(h.notices.mock.calls.find(call => call[2] === 'kitchen_debt')![3]).toMatchObject({ amountCents: 1150 });
  });
  it('Local Cooks goodwill leaves the kitchen share and its payout untouched', async () => {
    await refundRentalUnused(7, { cause: 'goodwill_lc', amountCents: 500, actorId: 9, operationKey: 'gw' });
    expect(h.reverse).toHaveBeenCalledWith(0);
    expect(h.notices.mock.calls.filter(call => call[2] === 'refund_issued').map(call => call[3].only)).toEqual([['chef', 'admins']]);
    await releaseStorageTermPayout(1, 'test', endOfTerm);
    expect(h.createTransfer.mock.calls[0][0].amount).toBe(3450 - 133);
  });
});
