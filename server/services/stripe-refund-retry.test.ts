import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ source: { transferId: 'tr_one', managerRevenue: '11116', amount: '12200' } as any,
  lookupFailed: false, frozen: false, noTransfer: false, transfer: { id: 'tr_one', amount: 11116, amount_reversed: 0 }, reversals: [] as any[], refunds: [] as any[],
  reverse: vi.fn(), refund: vi.fn() }));
vi.mock('../db', () => { const db: any = { execute: async (query: any) => ({ rows: state.frozen || new PgDialect().sqlToQuery(query).sql.includes('payout_partition') && state.source.payoutPartition === 'per_day' ? [{ id: 9 }] : [] }), transaction: async (work: any) => work(db), select: () => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain,
    then: (resolve: any, reject: any) => state.lookupFailed ? reject(Error('Database unavailable')) : resolve([state.source]) }; return chain;
} }; return { db }; });
vi.mock('stripe', () => ({ default: class {
  static createFetchHttpClient() { return {}; }
  paymentIntents = { retrieve: async () => ({ latest_charge: { currency: 'cad', id: 'ch_one', amount_captured: 12200, balance_transaction: { fee: 384 } } }) };
  transfers = { retrieve: async () => state.transfer, list: async function* () { if (!state.noTransfer) yield { ...state.transfer, metadata: { payment_intent_id: 'pi_one' } }; }, listReversals: async function* () { yield* state.reversals; }, createReversal: state.reverse };
  refunds = { list: async function* () { yield* state.refunds; }, create: state.refund };
} }));
let reverseTransferAndRefund: typeof import('./stripe-service').reverseTransferAndRefund;
let createRefund: typeof import('./stripe-service').createRefund;
beforeAll(async () => { vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); ({ reverseTransferAndRefund, createRefund } = await import('./stripe-service')); });
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
describe('original reservation retry receipt adoption', () => {
  it.each(['createRefund', 'reverseTransferAndRefund'])('%s refuses per-day sources before provider I/O, including reserved operations', async path => {
    state.source.payoutPartition = 'per_day';
    const run = path === 'createRefund' ? () => createRefund('pi_one', 2440, 'requested_by_customer', options)
      : () => reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', { ...options, reservedOperation: true });
    await expect(run()).rejects.toThrow('made per day');
    expect(state.refund).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it.each(['failed', 'canceled'])('adopts the successful retry while its older %s attempt remains', async status => {
    state.refunds = [
      { id: 're_success', charge: 'ch_one', amount: 2440, currency: 'cad', status: 'succeeded', metadata: { refund_operation_id: 'operation_one' } },
      { id: 're_failed', charge: 'ch_one', amount: 2440, currency: 'cad', status, metadata: { refund_operation_id: 'operation_one' } },
    ];
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).resolves.toMatchObject({ refundId: 're_success', refundStatus: 'succeeded' });
    expect(state.refund).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it.each(['pending', 'requires_action', 'succeeded'])('rejects a second %s attempt even if a success exists', async status => {
    state.refunds = [
      { id: 're_success', charge: 'ch_one', amount: 2440, currency: 'cad', status: 'succeeded', metadata: { refund_operation_id: 'operation_one' } },
      { id: 're_other', charge: 'ch_one', amount: 2440, currency: 'cad', status, metadata: { refund_operation_id: 'operation_one' } },
    ];
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options)).rejects.toThrow();
    expect(state.refund).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
  it('checks immutable allocation metadata while allowing a different support actor to recover the operation', async () => {
    const metadata = { refund_operation_id: 'operation_one', transaction_id: '99', customer_receives: '2440',
      manager_debited: '2300', platform_service_fee_returned: '140', support_actor_id: '2' };
    state.refunds = ['failed', 'succeeded'].map((status, index) => ({ id: `re_${index}`, charge: 'ch_one', amount: 2440,
      currency: 'cad', status, metadata }));
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', {
      ...options, metadata: { ...metadata, support_actor_id: '3' },
    })).resolves.toMatchObject({ refundId: 're_1' });
    await expect(reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', {
      ...options, metadata: { ...metadata, manager_debited: '2299' },
    })).rejects.toThrow('Conflicting refund receipts');
    expect(state.refund).not.toHaveBeenCalled(); expect(state.reverse).not.toHaveBeenCalled();
  });
});
