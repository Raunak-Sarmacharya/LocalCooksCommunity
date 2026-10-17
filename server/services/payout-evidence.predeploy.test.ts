import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ source: { transferId: 'tr_one', managerRevenue: '11116', amount: '12200' } as any,
  evidence: [] as any[], lookupFailed: false, frozen: false, noTransfer: false, transfer: { id: 'tr_one', amount: 11116, amount_reversed: 0 }, reversals: [] as any[], refunds: [] as any[],
  reverse: vi.fn(), refund: vi.fn() }));
vi.mock('../db', () => { const db: any = { execute: async (query: any) => {
  const { sql, params } = new PgDialect().sqlToQuery(query);
  if (sql.startsWith('SELECT ph.metadata')) return { rows: state.evidence.length ? [{ metadata:
    Object.fromEntries(Object.entries(state.evidence.at(-1)).reverse()) }] : [] }; // JSONB need not retain key order.
  if (sql.startsWith('INSERT INTO payment_history')) state.evidence.push(JSON.parse(params.find(value => typeof value === 'string' && value.startsWith('{')) as string));
  return { rows: state.frozen ? [{ id: 9 }] : [] };
}, transaction: async (work: any) => work(db), select: () => {
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
  state.evidence = []; state.lookupFailed = false; state.frozen = false; state.noTransfer = false; state.source = { transferId: 'tr_one', managerRevenue: '11116', amount: '12200', serviceFee: '700' };
  state.transfer = { id: 'tr_one', amount: 11116, amount_reversed: 0 }; state.reversals = []; state.refunds = [];
  state.reverse.mockReset().mockImplementation(async (_id: string, params: any) => {
    const result = { id: 'trr_one', ...params }; state.reversals.push(result); state.transfer.amount_reversed += params.amount; return result;
  });
  state.refund.mockReset().mockImplementation(async (params: any) => {
    const result = { id: 're_one', status: 'succeeded', ...params }; state.refunds.push(result); return result;
  });
});
const options = { idempotencyKey: 'operation_one', reverseTransferAmount: 2300, refundApplicationFee: false };

describe('predeploy finding 6: refund evidence survives metadata replacement and recovery', () => {
  it('records the provider original payout and the exact reversal against the verified refund', async () => {
    await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]).toMatchObject({ transferId: 'tr_one', originalAmountCents: 11116, reversedCents: 2300,
      refunds: { re_one: { reversalId: 'trr_one', amountCents: 2300 } } });
    state.source.metadata = { transfer: { transferredCents: 8816 } };
    await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(state.evidence).toHaveLength(1);
    expect(state.reverse).toHaveBeenCalledTimes(1); expect(state.refund).toHaveBeenCalledTimes(1);
  });
  it('recovers the original reversal evidence even when a prior refund succeeded before the local commit', async () => {
    state.transfer.amount_reversed = 2300;
    state.reversals = [{ id: 'trr_original', amount: 2300, metadata: { refund_operation_id: options.idempotencyKey } }];
    state.refunds = [{ id: 're_original', status: 'succeeded', amount: 2440, charge: 'ch_one', metadata: { refund_operation_id: options.idempotencyKey } }];
    await reverseTransferAndRefund('pi_one', 2440, 'requested_by_customer', options);
    expect(state.evidence[0]).toMatchObject({ originalAmountCents: 11116, reversedCents: 2300,
      refunds: { re_original: { reversalId: 'trr_original', amountCents: 2300 } } });
    expect(state.reverse).not.toHaveBeenCalled(); expect(state.refund).not.toHaveBeenCalled();
  });
});
