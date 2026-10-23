import { sql } from 'drizzle-orm';

/**
 * Cents Local Cooks has refunded on this payment as goodwill (platform-funded; the kitchen payout is unchanged).
 * Read from the verified payment-history evidence so the booking pages can name the amount.
 * The outer id is written out: in a one-table select Drizzle prints a bare "id", which inside this subquery is payment_history's.
 */
export const goodwillRefundCentsSql = sql<string>`COALESCE((SELECT SUM((h.metadata->>'amountCents')::bigint) FROM payment_history h
  WHERE h.transaction_id = "payment_transactions"."id" AND h.event_type = 'support_goodwill_verified'
  AND h.metadata->>'amountCents' ~ '^[0-9]+$'), 0)`;
