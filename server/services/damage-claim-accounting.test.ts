import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./stripe-service', () => ({ calculateRefundBreakdown: () => ({ maxRefundableToCustomer: 0 }) }));
vi.mock('./outcome-delivery', () => ({ queuePaymentOutcome: vi.fn() }));
import { getTransactionHistory } from './revenue-service';
import { updatePaymentTransaction } from './payment-transactions-service';
const dialect = new PgDialect();
describe('claim accounting reaches manager statements and generic Stripe sync', () => {
  it.each([false, true])('manager statements retain the whole amount with platform-paid processing, refunded=%s', async refunded => {
    const row = { id: 7, transaction_id: 1, pt_amount: '2000', pt_base_amount: '2000', pt_manager_revenue: '2000', actual_stripe_fee: '88',
      pt_refund_amount: refunded ? '2000' : '0', pt_metadata: { type: 'damage_claim', damage_claim_v2: 'true', platformAbsorbsProcessingFee: true,
        ...(refunded ? { kitchenRetainsTransfer: true } : {}) }, transaction_status: refunded ? 'refunded' : 'succeeded', status: 'completed',
      kitchen_id: 4, location_id: 3, created_at: new Date(), booking_date: new Date() };
    const db: any = { execute: async (query: any) => ({ rows: dialect.sqlToQuery(query).sql.includes('kb.id,') ? [row] : [] }) };
    const result = await getTransactionHistory(2, db);
    expect(result.transactions[0]).toMatchObject({ managerRevenue: 2000, netRevenue: 2000, stripeFee: 0 });
  });
  it.each([2000, 0])('generic fee synchronization cannot overwrite the durable kitchen share of %s cents', async revenue => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const current = { id: 1, status: 'succeeded', refund_amount: '0', amount: '2000', payout_timing: null, manager_revenue: String(revenue),
      metadata: { type: 'damage_claim', damage_claim_v2: 'true', platformAbsorbsProcessingFee: true, platformRecovery: revenue === 0 } };
    const db: any = { transaction: async (run: any) => run(db), execute: async (query: any) => {
      const compiled = dialect.sqlToQuery(query); queries.push(compiled); return { rows: [current] };
    } };
    await updatePaymentTransaction(1, { status: 'succeeded', stripeAmount: 2000, stripeNetAmount: 1912,
      stripeProcessingFee: 88, stripePlatformFee: 88, managerRevenue: 1912 }, db);
    const update = queries.find(query => query.sql.includes('UPDATE payment_transactions'))!;
    const parameter = /manager_revenue = \$(\d+)/.exec(update.sql)!;
    expect(update.params[Number(parameter[1]) - 1]).toBe(String(revenue));
    expect(update.sql).toContain('stripe_processing_fee');
  });
});
