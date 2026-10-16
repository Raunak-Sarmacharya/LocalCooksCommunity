import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
vi.mock('./outcome-delivery', () => ({ queuePaymentOutcome: vi.fn() }));
import { updatePaymentTransaction } from './payment-transactions-service';

const dialect = new PgDialect();
function racingDb(committedStatus: string) {
  const state = { status: 'succeeded', paidAt: new Date('2026-10-01T12:00:00Z'), refund: 0 };
  const queries: string[] = [], history: unknown[][] = [];
  let locked = false;
  const execute = vi.fn(async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query); queries.push(sql);
    if (/SELECT status,/.test(sql)) {
      const snapshot = { status: state.status, amount: '1000', refund_amount: String(state.refund), metadata: {} };
      if (!locked) { state.status = committedStatus; state.refund = 1000; }
      return { rows: [snapshot] };
    }
    if (/UPDATE payment_transactions/.test(sql)) {
      const value = /\bstatus = \$(\d+)/.exec(sql);
      if (value) state.status = String(params[Number(value[1]) - 1]);
      return { rows: [{ id: 1, status: state.status, amount: '1000', refund_amount: state.refund, paid_at: state.paidAt }] };
    }
    if (/INSERT INTO payment_history/.test(sql)) history.push(params);
    return { rows: [] };
  });
  const tx = { execute };
  const db = { execute, transaction: vi.fn(async (run: any) => {
    // A refund (or capture) committed before this caller acquired the row lock.
    state.status = committedStatus; state.refund = 1000; locked = true;
    try { return await run(tx); } finally { locked = false; }
  }) };
  return { db, state, history, queries };
}

describe('predeploy findings 3 and 4: atomic status-only transitions', () => {
  it.each(['refunded', 'partially_refunded'])('a success arriving around a committed %s cannot overwrite it or its history', async status => {
    const { db, state, history, queries } = racingDb(status);
    const paidAt = state.paidAt;
    await updatePaymentTransaction(1, { status: 'succeeded', paidAt: new Date(), stripeStatus: 'succeeded' }, db);
    expect(state.status).toBe(status); expect(state.refund).toBe(1000); expect(state.paidAt).toBe(paidAt);
    expect(queries.find(query => /SELECT status,/.test(query))).toContain('FOR UPDATE');
    expect(history).toEqual([]);
  });
  it.each(['succeeded', 'partially_refunded', 'refunded'])('a failure cannot demote a locked %s source or add false failure history', async status => {
    const { db, state, history, queries } = racingDb(status);
    await updatePaymentTransaction(1, { status: 'failed', stripeStatus: 'requires_payment_method', failureReason: 'old decline' }, db);
    expect(state.status).toBe(status); expect(history).toEqual([]);
    expect(queries.find(query => /SELECT status,/.test(query))).toContain('FOR UPDATE');
    expect(queries.join(' ')).not.toContain('failure_reason =');
  });
});
