import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ source: { transferId: 'tr_one', managerRevenue: '11116', amount: '12200' } as any,
  lookupFailed: false, frozen: false, noTransfer: false, transfer: { id: 'tr_one', amount: 11116, amount_reversed: 0 }, reversals: [] as any[], refunds: [] as any[],
  reverse: vi.fn(), refund: vi.fn() }));
vi.mock('../db', () => { const db: any = { execute: async () => ({ rows: state.frozen ? [{ id: 9 }] : [] }), transaction: async (work: any) => work(db), select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain,
    then: (resolve: any, reject: any) => state.lookupFailed ? reject(Error('Database unavailable')) : resolve([state.source]) }; return chain;
} }; return { db }; });
vi.mock('stripe', () => ({ default: class {
  static createFetchHttpClient() { return {}; }
  paymentIntents = { retrieve: async () => ({ latest_charge: { id: 'ch_one', amount_captured: 12200, balance_transaction: { fee: 384 } } }) };
  transfers = { retrieve: async () => state.transfer, list: async function* () { if (!state.noTransfer) yield { ...state.transfer, metadata: { payment_intent_id: 'pi_one' } }; }, listReversals: async function* () { yield* state.reversals; }, createReversal: state.reverse };
  refunds = { list: async function* () { yield* state.refunds; }, create: state.refund };
} }));
let reverseTransferAndRefund: typeof import('./stripe-service').reverseTransferAndRefund;
beforeAll(async () => { vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); ({ reverseTransferAndRefund } = await import('./stripe-service')); });
beforeEach(() => {
  state.lookupFailed = false; state.frozen = false; state.noTransfer = false; state.source = { transferId: 'tr_one', managerRevenue: '11116', amount: '12200', serviceFee: '700' };
  state.transfer = { id: 'tr_one', amount: 11116, amount_reversed: 0 }; state.reversals = []; state.refunds = [];
  state.reverse.mockReset().mockImplementation(async (_id: string, params: any) => {
    const result = { id: 'trr_one', ...params }; state.reversals.push(result); state.transfer.amount_reversed += params.amount; return result;
  });
  state.refund.mockReset().mockImplementation(async (params: any) => {
    const result = { id: 're_one', status: 'succeeded', ...params }; state.refunds.push(result); return result;
  });
});
const options = { idempotencyKey: 'operation_one', reverseTransferAmount: 2300, refundApplicationFee: false };
describe('source-specific reversal and refund recovery', () => {
  it('freezes refunds before any provider refund or reversal', async () => {
    state.frozen = true;
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('paused');
    expect(state.reverse).not.toHaveBeenCalled(); expect(state.refund).not.toHaveBeenCalled();
  });
  it.each(['pending', 'requires_action', 'failed', 'canceled'])('does not certify a recovered %s refund or create another one', async status => {
    state.refunds = [{ id: 're_existing', charge: 'ch_one', amount: 2440, status, metadata: { refund_operation_id: 'operation_one' } }];
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('not verified as complete');
    expect(state.reverse).not.toHaveBeenCalled(); expect(state.refund).not.toHaveBeenCalled();
  });
  it('preserves a newly pending provider operation for same-key verification rather than reporting success', async () => {
    state.refund.mockImplementationOnce(async (params: any) => {
      const receipt = { id: 're_pending', status: 'pending', ...params }; state.refunds.push(receipt); return receipt;
    });
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('not verified as complete');
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('not verified as complete');
    expect(state.reverse).toHaveBeenCalledTimes(1); expect(state.refund).toHaveBeenCalledTimes(1);
    state.refunds[0].status = 'succeeded';
    expect((await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).refundId).toBe('re_pending');
  });
  it('reverses manager kitchen/tax only; platform funds the separate fee refund', async () => {
    const result = await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(result.refundAmount).toBe(2440);
    expect(state.reverse.mock.calls[0][1].amount).toBe(2300);
    expect(state.transfer.amount - state.transfer.amount_reversed).toBe(8816);
  });
  it('recovers reversal success/refund failure without repeating reversal beyond key retention', async () => {
    state.refund.mockRejectedValueOnce(Error('Provider response lost'));
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('Provider response lost');
    await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(state.reverse).toHaveBeenCalledTimes(1); expect(state.refund).toHaveBeenCalledTimes(2);
    await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(state.reverse).toHaveBeenCalledTimes(1); expect(state.refund).toHaveBeenCalledTimes(2);
  });
  it('refuses a manager shortfall instead of silently capping the promised refund', async () => {
    state.transfer.amount_reversed = 10000;
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('Separate funding approval');
    expect(state.refund).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('lookup failure is not evidence that manager funds were never transferred', async () => {
    state.lookupFailed = true;
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('Database unavailable');
    expect(state.refund).not.toHaveBeenCalled();
  });
  it('finds the provider transfer when local transfer-ID persistence was lost', async () => {
    state.source.transferId = null;
    await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(state.reverse.mock.calls[0][0]).toBe('tr_one');
    expect(state.reverse.mock.calls[0][1].amount).toBe(2300);
  });
  it('refund before payout reduces unpaid entitlement without manufacturing a reversal', async () => {
    state.noTransfer = true; state.source.transferId = null;
    const result = await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(result.refundAmount).toBe(2440); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('a large refund cannot consume unrecoverable processing costs before payout', async () => {
    state.noTransfer = true; state.source.transferId = null;
    await expect(reverseTransferAndRefund('pi_one', 12200, 'requested_by_customer', { ...options, reverseTransferAmount: 11500 })).rejects.toThrow('Separate funding approval');
    expect(state.refund).not.toHaveBeenCalled();
  });
  it('payout after closeout: a chef or kitchen-caused cancellation before release refunds from the platform without any reversal', async () => {
    state.noTransfer = true;
    state.source = { transferId: null, payoutTiming: 'after_closeout', payoutReleasedAt: null, managerRevenue: '11500', amount: '12200', serviceFee: '700' };
    // Chef cancellation keeping a retained share: refund 50% of the kitchen share.
    await reverseTransferAndRefund('pi_one', 5558, 'requested_by_customer', { idempotencyKey: 'chef_cancel', reverseTransferAmount: 5558 });
    // Kitchen-caused: the whole unpaid share (charge - commission - actual fee) plus the service fee.
    await reverseTransferAndRefund('pi_one', 12200, 'requested_by_customer', { idempotencyKey: 'kitchen_cancel', reverseTransferAmount: 12200 - 700 - 384 });
    expect(state.refund).toHaveBeenCalledTimes(2); expect(state.reverse).not.toHaveBeenCalled();
    await expect(reverseTransferAndRefund('pi_one', 12200, 'requested_by_customer', { idempotencyKey: 'too_much', reverseTransferAmount: 12200 - 700 }))
      .rejects.toThrow('exceeds verified unpaid entitlement');
  });
  describe('CP6 per-day sources: explicit installment reversals', () => {
    const day = { idempotencyKey: 'kitchen-day-refund:1:op:1', refundApplicationFee: false };
    it('reverses exactly the listed day transfer, never a discovered or prorated source transfer', async () => {
      state.source.transferId = null;
      await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...day, installmentReversals: [{ transferId: 'tr_day3', amountCents: 2000 }] });
      expect(state.reverse).toHaveBeenCalledTimes(1);
      expect(state.reverse.mock.calls[0]).toEqual(['tr_day3', { amount: 2000, metadata: { refund_operation_id: day.idempotencyKey } }, { idempotencyKey: `${day.idempotencyKey}:tr_day3` }]);
      expect(state.refund.mock.calls[0][0]).toMatchObject({ amount: 2440, metadata: { refund_operation_id: day.idempotencyKey } });
    });
    it('an unpaid day (no reversal) never touches a transfer found by payment intent', async () => {
      await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...day, installmentReversals: [] });
      expect(state.reverse).not.toHaveBeenCalled(); expect(state.refund).toHaveBeenCalledTimes(1);
    });
    it('a retry recovers the day reversal by its operation and does not reverse twice', async () => {
      state.refund.mockRejectedValueOnce(Error('Provider response lost'));
      const run = () => reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...day, installmentReversals: [{ transferId: 'tr_day3', amountCents: 2000 }] });
      await expect(run()).rejects.toThrow('Provider response lost');
      await run();
      expect(state.reverse).toHaveBeenCalledTimes(1); expect(state.refund).toHaveBeenCalledTimes(2);
    });
    it('names the day transfer that cannot fund its share, before any refund', async () => {
      state.transfer.amount_reversed = 10000;
      const error = await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...day, installmentReversals: [{ transferId: 'tr_day3', amountCents: 2000 }] })
        .catch(caught => caught);
      expect(error).toMatchObject({ transferId: 'tr_day3', message: expect.stringContaining('exceeds the verified unreversed transfer') });
      expect(state.refund).not.toHaveBeenCalled();
    });
  });
  describe('M3: a support retry never makes a second refund while the first may still be in flight', () => {
    const variants = [['single-day', { idempotencyKey: 'chef-cancel-10-99-op', reverseTransferAmount: 2300, refundApplicationFee: false }],
      ['day refund', { idempotencyKey: 'kitchen-day-refund:1:op:1', refundApplicationFee: false, installmentReversals: [{ transferId: 'tr_day3', amountCents: 2000 }] }]] as const;
    // Stripe's idempotency: the same key returns the same refund. An in-flight refund is not in the list yet.
    const provider = new Map<string, any>();
    beforeEach(() => { provider.clear(); state.refund.mockImplementation(async (params: any, opts: any) => {
      if (!provider.has(opts.idempotencyKey)) provider.set(opts.idempotencyKey, { id: `re_${provider.size + 1}`, status: 'succeeded', charge: 'ch_one', ...params });
      return provider.get(opts.idempotencyKey);
    }); });
    it.each(variants)('%s: the support retry reuses the original key, so Stripe returns the same refund', async (_name, base) => {
      await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...base });
      await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...base, refundIdempotencyKey: `${base.idempotencyKey}-refund-support-retry` });
      expect(state.refund.mock.calls.map(call => call[1].idempotencyKey)).toEqual([`${base.idempotencyKey}-refund`, `${base.idempotencyKey}-refund`]);
      expect(provider.size).toBe(1);
    });
    it.each(variants)('%s: only after Stripe shows the attempt failed does the retry use a new key (shared by concurrent retries)', async (_name, base) => {
      state.refunds = [{ id: 're_failed', created: 1, charge: 'ch_one', amount: 2440, status: 'failed', metadata: { refund_operation_id: base.idempotencyKey } }];
      await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...base, refundIdempotencyKey: `${base.idempotencyKey}-refund-support-a` });
      await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...base, refundIdempotencyKey: `${base.idempotencyKey}-refund-support-b` });
      expect(state.refund.mock.calls.map(call => call[1].idempotencyKey)).toEqual([`${base.idempotencyKey}-refund-after-re_failed`, `${base.idempotencyKey}-refund-after-re_failed`]);
      expect(provider.size).toBe(1);
    });
  });
  it('a reserved cancellation source cannot fund a competing direct refund', async () => {
    state.source.metadata = { cancellationRefundOperation: { id: 'reserved_cancellation', status: 'pending' } };
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow('Refund funding cannot be verified');
    expect(state.refund).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
});
