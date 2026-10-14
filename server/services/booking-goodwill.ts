import { sql } from 'drizzle-orm';
import { paymentTransactions } from '@shared/schema';

/**
 * Cents Local Cooks has refunded on this payment as goodwill (platform-funded; the kitchen payout is unchanged).
 * Read from the verified payment-history evidence so the booking pages can name the amount.
 */
export const goodwillRefundCentsSql = sql<string>`COALESCE((SELECT SUM((h.metadata->>'amountCents')::bigint) FROM payment_history h
  WHERE h.transaction_id = ${paymentTransactions.id} AND h.event_type = 'support_goodwill_verified'
  AND h.metadata->>'amountCents' ~ '^[0-9]+$'), 0)`;
