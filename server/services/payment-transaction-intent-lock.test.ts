import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('./outcome-delivery', () => ({ queuePaymentOutcome: vi.fn() }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import { findOrCreatePaymentTransactionByIntent } from './payment-transactions-service';

const dialect = new PgDialect();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** In-memory payment_transactions with a real advisory-lock mutex, held until the transaction ends (as in Postgres). */
function fakeDb() {
  const rows: any[] = [], log: string[] = [];
  const locks = new Map<string, Promise<void>>();
  const db = {
    rows, log,
    transaction: async (run: (tx: any) => Promise<any>) => {
      const releases: Array<() => void> = [];
      const tx = {
        execute: async (query: any) => {
          const { sql: text, params } = dialect.sqlToQuery(query);
          await tick(); // every statement yields, so two unlocked callers would interleave read-before-insert
          if (text.includes('pg_advisory_xact_lock')) {
            const key = String(params[0]);
            while (locks.has(key)) await locks.get(key);
            let release!: () => void;
            locks.set(key, new Promise<void>(resolve => { release = () => { locks.delete(key); resolve(); }; }));
            releases.push(release); log.push(`lock ${key}`);
            return { rows: [] };
          }
          if (text.includes('SELECT * FROM payment_transactions')) {
            log.push('find');
            return { rows: rows.filter(row => row.payment_intent_id === params[0]) };
          }
          if (text.includes('INSERT INTO payment_transactions')) {
            const row = { id: rows.length + 1, payment_intent_id: params[12] };
            rows.push(row); log.push('insert');
            return { rows: [row] };
          }
          return { rows: [{ id: 1 }] }; // payment_history and anything else
        },
      };
      try { return await run(tx); } finally { releases.forEach(release => release()); }
    },
  };
  return db;
}

const params = (source: string) => ({ bookingId: 43, bookingType: 'storage' as const, chefId: 8, managerId: 2, amount: 518, baseAmount: 450,
  serviceFee: 0, managerRevenue: 518, currency: 'CAD', paymentIntentId: 'pi_same', status: 'succeeded' as const, metadata: { source } });

describe('payment intent ledger row', () => {
  it('records one row when checkout.session.completed and payment_intent.succeeded confirm the same payment together', async () => {
    const db = fakeDb();
    const [checkout, intent] = await Promise.all([
      findOrCreatePaymentTransactionByIntent(params('checkout.session.completed'), db),
      findOrCreatePaymentTransactionByIntent(params('payment_intent.succeeded'), db),
    ]);
    expect(db.rows).toHaveLength(1);
    expect([checkout.created, intent.created].sort()).toEqual([false, true]);
    expect(checkout.record.id).toBe(intent.record.id);
    // The lock is taken before each read, so the second read sees the first insert.
    expect(db.log).toEqual(['lock payment-intent:pi_same', 'find', 'insert', 'lock payment-intent:pi_same', 'find']);
  });
});
