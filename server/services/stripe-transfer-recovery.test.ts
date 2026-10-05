import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ lookupFailed: false, source: {} as any, charge: { amount_refunded: 0 },
  transfer: { id: 'tr_one', amount: 11116, amount_reversed: 2300 }, candidates: [] as any[], reversals: [] as any[], create: vi.fn(), reverse: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  charges = { retrieve: async () => state.charge };
  transfers = { retrieve: async () => state.transfer, list: async function* () { yield* state.candidates; }, listReversals: async function* () { yield* state.reversals; }, create: state.create, createReversal: state.reverse };
} }));
vi.mock('../db', () => { const db: any = { transaction: async (work: any) => work(db), update: () => ({ set: () => ({ where: async () => {} }) }), select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain,
    then: (resolve: any, reject: any) => state.lookupFailed ? reject(Error('Source lookup unavailable')) : resolve([state.source]) }; return chain;
} }; return { db }; });
vi.mock('./stripe-checkout-fee-service', () => ({ getFeeConfig: async () => ({ platformCommissionRate: .07 }) }));
let transferToManagerForBooking: typeof import('./stripe-transfer-service').transferToManagerForBooking;
beforeAll(async () => { vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); ({ transferToManagerForBooking } = await import('./stripe-transfer-service')); });
beforeEach(() => {
  state.lookupFailed = false; state.source = { transferId: 'tr_one', refundAmount: '0', baseAmount: '11500', serviceFee: '700', metadata: {} };
  state.transfer = { id: 'tr_one', amount: 11116, amount_reversed: 2300 }; state.candidates = []; state.reversals = [];
  state.charge = { amount_refunded: 0 }; state.create.mockReset().mockResolvedValue({ id: 'tr_new' }); state.reverse.mockReset();
});
const params = { paymentIntentId: 'pi_one', paymentTransactionId: 1, chargeAmountCents: 12200,
  actualStripeFeeCents: 384, chargeId: 'ch_one', transferGroup: 'pi_pi_one' };
describe('late manager-transfer recovery', () => {
  it('recovers a corrected provider transfer after its local ID write was lost, without paying twice', async () => {
    state.transfer = { id: 'tr_one', amount: 10000, amount_reversed: 10000 };
    state.reversals = [{ id: 'trr_correction', amount: 10000, metadata: { reason: 'automatic_payout_reconciliation', corrected_transfer_amount_cents: '11116' } }];
    state.candidates = [{ id: 'tr_corrected', amount: 11116, amount_reversed: 0,
      metadata: { payment_intent_id: 'pi_one', replaces_transfer_id: 'tr_one' } }];
    const result = await transferToManagerForBooking(params);
    expect(result).toMatchObject({ transferred: true, transferId: 'tr_corrected', transferredCents: 11116, originalManagerNetCents: 11116 });
    expect(state.create).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('does not call a fully reversed correction paid when the replacement outcome is unknown', async () => {
    state.transfer = { id: 'tr_one', amount: 10000, amount_reversed: 10000 };
    const result = await transferToManagerForBooking(params);
    expect(result).toMatchObject({ transferred: false, transferredCents: 0 });
    expect(result.reason).toContain('provider reconciliation');
    expect(state.create).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('provider refund arriving before local receipt prevents payout creation or correction', async () => {
    state.charge.amount_refunded = 2440;
    expect((await transferToManagerForBooking(params)).reason).toContain('Provider/local refund history');
    expect(state.create).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('local refunded history blocks a stale fee callback', async () => {
    state.source.refundAmount = '2440';
    expect((await transferToManagerForBooking(params)).reason).toContain('Provider/local refund history');
    expect(state.create).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('a captured cancellation race remains owned recovery without a manager payout', async () => {
    state.source.metadata = { capturedCancellationRace: true };
    expect((await transferToManagerForBooking(params)).reason).toContain('Captured cancellation race');
    expect(state.create).not.toHaveBeenCalled();
  });
  it('does not correct an intentional partial reversal back to the gross transfer', async () => {
    const result = await transferToManagerForBooking(params);
    expect(result.transferredCents).toBe(8816);
    expect(result.originalManagerNetCents).toBe(11116);
    expect(result.platformCommissionCents).toBe(700); expect(result.feeWithheldCents).toBe(1084);
    expect(state.create).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('a failed source lookup cannot trigger a duplicate transfer', async () => {
    state.lookupFailed = true;
    await expect(transferToManagerForBooking(params)).rejects.toThrow('Source lookup unavailable');
    expect(state.create).not.toHaveBeenCalled();
  });
  it('refund before initial payout transfers only retained manager entitlement without re-deducting processing fees', async () => {
    state.source = { ...state.source, transferId: null, managerId: 2, stripeConnectAccountId: 'acct_mock', refundAmount: '2440',
      metadata: { refunds: [{ id: 're_one', customerReceived: 2440, managerDebited: 2300, platformServiceFeeReturned: 140 }] } };
    state.charge.amount_refunded = 2440;
    const result = await transferToManagerForBooking(params);
    expect(result).toMatchObject({ transferred: true, transferredCents: 8816, originalManagerNetCents: 11116, platformCommissionCents: 700, feeWithheldCents: 1084 });
    expect(state.create.mock.calls[0][0].amount).toBe(8816);
    expect(state.reverse).not.toHaveBeenCalled();
  });
});
