import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
vi.mock('./outcome-delivery', () => ({ queuePaymentOutcome: vi.fn() }));
import { updatePaymentTransaction } from './payment-transactions-service';

const dialect = new PgDialect();
const text = (query: any) => dialect.sqlToQuery(query);

/** A db whose first read returns the stored status; every statement is recorded so the written columns can be checked. */
function fakeDb(status: string, paidAt: Date | null = new Date('2026-10-01T12:00:00Z')) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const execute = vi.fn(async (query: any) => {
    const { sql, params } = text(query);
    if (/^\s*SELECT status/i.test(sql)) return { rows: [{ status, refund_amount: '5000', amount: '5000', payout_timing: null, metadata: {}, manager_revenue: '4000' }] };
    if (/^\s*SELECT metadata/i.test(sql)) return { rows: [{ metadata: {} }] };
    if (/^\s*UPDATE payment_transactions/i.test(sql)) { writes.push({ sql, params }); return { rows: [{ id: 1, status, paid_at: paidAt, amount: '5000' }] }; }
    return { rows: [] };
  });
  return { db: { execute, transaction: (run: any) => run({ execute }) } as any, writes };
}

describe('payment_intent.succeeded cannot rewind a later payment status', () => {
  it.each(['refunded', 'partially_refunded', 'failed', 'canceled'])('keeps %s when a late success is replayed', async status => {
    const { db, writes } = fakeDb(status);
    await updatePaymentTransaction(1, { status: 'succeeded', stripeStatus: 'succeeded', paidAt: new Date(), lastSyncedAt: new Date() }, db);
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).not.toMatch(/\bstatus = /);
    expect(writes[0].sql).not.toMatch(/paid_at/);
    expect(writes[0].sql).toMatch(/stripe_status = /); // the provider fact is still recorded
  });

  it.each(['pending', 'authorized', 'processing'])('upgrades %s to succeeded', async status => {
    const { db, writes } = fakeDb(status, null);
    await updatePaymentTransaction(1, { status: 'succeeded', paidAt: new Date() }, db);
    expect(writes[0].sql).toMatch(/\bstatus = /);
    expect(writes[0].params).toContain('succeeded');
  });

  it('never moves an existing paid_at when the same success arrives again', async () => {
    const { db, writes } = fakeDb('succeeded');
    await updatePaymentTransaction(1, { status: 'succeeded', paidAt: new Date('2026-10-15T00:00:00Z') }, db);
    expect(writes[0].sql).toMatch(/paid_at = COALESCE\(paid_at, /);
  });

  it('still lets a refund or cancellation move a succeeded payment forward', async () => {
    const { db, writes } = fakeDb('succeeded');
    await updatePaymentTransaction(1, { status: 'refunded', refundAmount: 5000, refundedAt: new Date() }, db);
    expect(writes[0].params).toContain('refunded');
  });
});
