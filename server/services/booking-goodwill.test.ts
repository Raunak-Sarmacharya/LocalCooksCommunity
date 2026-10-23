import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { paymentTransactions } from '@shared/schema';
import { goodwillRefundCentsSql } from './booking-goodwill';

describe('goodwill refund cents (executed in PGlite through Drizzle, as the booking routes select it)', () => {
  it('sums the verified goodwill rows of the selected payment, not of a payment_history row with the same id', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE payment_transactions (id serial PRIMARY KEY, booking_id integer, amount numeric);
        CREATE TABLE payment_history (id serial PRIMARY KEY, transaction_id integer, event_type text, metadata jsonb);
        INSERT INTO payment_transactions (id, booking_id, amount) VALUES (220, 229, 3050), (7, 1, 100);
        INSERT INTO payment_history (id, transaction_id, event_type, metadata) VALUES
          (7, 220, 'support_goodwill_verified', '{"amountCents": 500}'),
          (354, 220, 'support_goodwill_verified', '{"amountCents": 250}'),
          (355, 220, 'support_goodwill_requested', '{"amountCents": 999}');`);
      const db = drizzle(client);
      const [row] = await db.select({ id: paymentTransactions.id, goodwill: goodwillRefundCentsSql }).from(paymentTransactions).where(eq(paymentTransactions.id, 220));
      expect(Number(row.goodwill)).toBe(750);
      const [other] = await db.select({ goodwill: goodwillRefundCentsSql }).from(paymentTransactions).where(eq(paymentTransactions.id, 7));
      expect(Number(other.goodwill)).toBe(0);
    } finally { await client.close(); }
  }, 60_000);
});
