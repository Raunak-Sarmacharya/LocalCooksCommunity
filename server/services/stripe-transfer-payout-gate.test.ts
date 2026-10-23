import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// The gate sits in transferLockedSource, the single engine behind every caller: payment_intent.succeeded,
// charge.updated, the manual Stripe sync and the claim/overstay fallbacks all reach it through transferToManagerForBooking.
const state = vi.hoisted(() => ({ source: {} as any, eligible: true, retrieve: vi.fn(), list: vi.fn(), create: vi.fn(), record: vi.fn(), eligibility: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  charges = { retrieve: state.retrieve };
  transfers = { retrieve: vi.fn(), list: state.list, listReversals: async function* () {}, create: state.create, createReversal: vi.fn() };
} }));
vi.mock('../db', () => { const db: any = { execute: async () => ({ rows: [] }), transaction: async (work: any) => work(db),
  update: () => ({ set: () => ({ where: async () => {} }) }), select: () => {
    const chain: any = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain, then: (resolve: any) => resolve([state.source]) };
    return chain;
  } }; return { db }; });
vi.mock('./stripe-checkout-fee-service', () => ({ getFeeConfig: async () => ({ platformCommissionRate: 0 }) }));
vi.mock('./kitchen-payout-service', () => ({ releasedPayoutStillEligible: state.eligibility, recordReleasedPayout: state.record }));
vi.mock('./storage-rentals', () => ({ storageTermStillEligible: async () => false }));
let transferToManagerForBooking: typeof import('./stripe-transfer-service').transferToManagerForBooking;
let PAYOUT_DEFERRED_REASON: string;
beforeAll(async () => { vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); ({ transferToManagerForBooking, PAYOUT_DEFERRED_REASON } = await import('./stripe-transfer-service')); }, 30000);
const params = { paymentIntentId: 'pi_one', paymentTransactionId: 1, chargeAmountCents: 12000, actualStripeFeeCents: 358, chargeId: 'ch_one', transferGroup: 'pi_pi_one' };
beforeEach(() => {
  state.source = { id: 1, bookingId: 7, transferId: null, refundAmount: '0', baseAmount: '11300', serviceFee: '700', managerId: 2,
    stripeConnectAccountId: 'acct_kitchen', metadata: {}, payoutTiming: 'after_closeout', payoutReleasedAt: null, payoutHoldReason: null };
  state.retrieve.mockReset().mockResolvedValue({ amount_refunded: 0 });
  state.list.mockReset().mockImplementation(async function* () {});
  state.create.mockReset().mockResolvedValue({ id: 'tr_released' });
  state.record.mockReset(); state.eligibility.mockReset().mockResolvedValue(true);
});

describe('payout-after-closeout gate in the transfer engine', () => {
  it('never transfers a per_day source, including change/claim dispatch and a legacy release override', async () => {
    state.source.payoutPartition = 'per_day'; state.source.payoutReleasedAt = new Date();
    for (const metadata of [{}, { kitchenChangeId: 'change' }, { damage_claim_v2: 'true' }]) {
      state.source.metadata = metadata;
      expect(await transferToManagerForBooking({ ...params, existingMetadata: metadata })).toMatchObject({ transferred: false, transferredCents: 0,
        reason: 'deferred: this payment is partitioned per day' });
    }
    expect(state.create).not.toHaveBeenCalled(); expect(state.retrieve).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
  it('capture before AND after storage approval never transfers a storage term, even with a release timestamp', async () => {
    state.source.payoutTiming = 'storage_term'; state.source.bookingType = 'storage';
    for (const status of ['authorized', 'succeeded']) {
      state.source.status = status;
      for (const payoutReleasedAt of [null, new Date()]) {
        state.source.payoutReleasedAt = payoutReleasedAt;
        expect(await transferToManagerForBooking(params)).toMatchObject({ transferred: false, transferredCents: 0 });
      }
    }
    expect(state.retrieve).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled(); expect(state.eligibility).not.toHaveBeenCalled();
  });
  it('a captured after-closeout charge is not transferred by any caller before the release decision', async () => {
    const result = await transferToManagerForBooking(params);
    expect(result).toMatchObject({ transferred: false, transferredCents: 0, reason: PAYOUT_DEFERRED_REASON });
    expect(state.retrieve).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
  it('a saved hold also defers, and so does a hold opened after the decision', async () => {
    state.source.payoutReleasedAt = new Date(); state.source.payoutHoldReason = 'support_flag';
    expect((await transferToManagerForBooking(params)).reason).toBe(PAYOUT_DEFERRED_REASON);
    state.source.payoutHoldReason = null; state.eligibility.mockResolvedValue(false);
    expect((await transferToManagerForBooking(params)).reason).toBe(PAYOUT_DEFERRED_REASON);
    expect(state.create).not.toHaveBeenCalled();
  });
  it('after release the existing engine transfers the kitchen share once and records the payout in the same transaction', async () => {
    state.source.payoutReleasedAt = new Date();
    const result = await transferToManagerForBooking(params);
    expect(result).toMatchObject({ transferred: true, transferId: 'tr_released', transferredCents: 11300 - 358 });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create.mock.calls[0][0]).toMatchObject({ amount: 10942, destination: 'acct_kitchen', source_transaction: 'ch_one' });
    expect(state.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'transfer:pi_one' });
    expect(state.record).toHaveBeenCalledWith(1, expect.objectContaining({ transferId: 'tr_released' }), expect.anything());
  });
  it('after a Local Cooks-funded refund the unchanged kitchen share comes from the platform balance, under its own key (#229 on dev)', async () => {
    // $120 charged, $100 refunded by Local Cooks: $20 left on the charge, the kitchen's $109.42 is unchanged.
    state.source.payoutReleasedAt = new Date(); state.source.refundAmount = '10000';
    state.source.metadata = { refunds: [{ id: 're_lc', customerReceived: 10000, managerDebited: 0, platformServiceFeeReturned: 0, platformGoodwillCents: 10000 }] };
    state.retrieve.mockResolvedValue({ amount: 12000, amount_refunded: 10000 });
    const result = await transferToManagerForBooking(params);
    expect(result).toMatchObject({ transferred: true, transferredCents: 10942 });
    expect(state.create.mock.calls[0][0]).toMatchObject({ amount: 10942, destination: 'acct_kitchen' });
    expect(state.create.mock.calls[0][0]).not.toHaveProperty('source_transaction');
    expect(state.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'transfer:pi_one:platform' });
  });
  it('a refund before release reduces the transfer instead of reversing anything', async () => {
    state.source.payoutReleasedAt = new Date(); state.source.refundAmount = '2000';
    state.source.metadata = { refunds: [{ id: 're_1', customerReceived: 2000, managerDebited: 2000, platformServiceFeeReturned: 0 }] };
    state.retrieve.mockResolvedValue({ amount_refunded: 2000 });
    expect((await transferToManagerForBooking(params)).transferredCents).toBe(10942 - 2000);
    expect(state.create.mock.calls[0][0].amount).toBe(8942);
  });
  it('legacy at_capture and NULL rows are untouched by the gate', async () => {
    for (const payoutTiming of [null, 'at_capture']) {
      state.create.mockClear(); state.source.payoutTiming = payoutTiming;
      expect((await transferToManagerForBooking(params)).transferred).toBe(true);
      expect(state.create).toHaveBeenCalledTimes(1);
    }
    expect(state.eligibility).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
});
