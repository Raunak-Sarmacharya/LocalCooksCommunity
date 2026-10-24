import 'dotenv/config';
import Stripe from 'stripe';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, pool } from '../server/db';
import { paymentTransactions } from '../shared/schema';
import { recordPayoutTransferEvidence } from '../server/services/payout-document-evidence';

/**
 * Kitchen Revenue reads transfer reversals from the "verified transfer and reversals" record (added Oct 15).
 * Refunds made before that record existed reversed the kitchen's transfer in Stripe but saved no evidence, so
 * Revenue still showed the full amount as paid out. This asks Stripe for every recorded kitchen transfer and saves
 * any reversal the database is missing. Read-only on Stripe; idempotent.
 *
 *   npx tsx scripts/backfill-payout-reversals.ts           # report only
 *   npx tsx scripts/backfill-payout-reversals.ts --apply   # save the missing evidence
 */
const apply = process.argv.includes('--apply');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const rows = await db.select({ id: paymentTransactions.id, intentId: paymentTransactions.paymentIntentId, transferId: paymentTransactions.transferId })
  .from(paymentTransactions).where(and(isNotNull(paymentTransactions.transferId), isNotNull(paymentTransactions.paymentIntentId)));
const seen = new Set<string>();
let missing = 0, failed = 0;
try {
  for (const row of rows) {
    const key = `${row.intentId}:${row.transferId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const transfer = await stripe.transfers.retrieve(row.transferId!);
      if (!transfer.amount_reversed) continue;
      const saved = await db.execute(sql`SELECT max((ph.metadata->>'reversedCents')::int) AS reversed FROM payment_history ph
        JOIN payment_transactions pt ON pt.id = ph.transaction_id WHERE pt.payment_intent_id = ${row.intentId}
        AND ph.event_type = 'payout_transfer_verified' AND ph.metadata->>'transferId' = ${transfer.id}`) as { rows: Array<{ reversed: number | null }> };
      if ((saved.rows[0]?.reversed ?? 0) >= transfer.amount_reversed) continue;
      missing += 1;
      console.log(`payment ${row.id} ${transfer.id}: Stripe reversed ${transfer.amount_reversed} of ${transfer.amount}; saved ${saved.rows[0]?.reversed ?? 0}`);
      if (apply) await db.transaction(async tx => {
        await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, row.intentId!)).for('update');
        await recordPayoutTransferEvidence(tx, row.intentId!, { transferId: transfer.id, originalAmountCents: transfer.amount, reversedCents: transfer.amount_reversed });
      });
    } catch (error) {
      failed += 1;
      console.error(`payment ${row.id} ${row.transferId}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`${rows.length} rows, ${seen.size} transfers checked, ${missing} missing reversal${missing === 1 ? '' : 's'}${apply ? ' saved' : ' (dry run)'}, ${failed} failed`);
} finally {
  await pool.end();
}
