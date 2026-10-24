import 'dotenv/config';
import { pool } from '../server/db';
import { saveMissingTransferReversals } from '../server/services/payout-reconciliation';

/**
 * Kitchen Revenue reads transfer reversals from the "verified transfer and reversals" record (added Oct 15).
 * Refunds made before that record existed reversed the kitchen's transfer in Stripe but saved no evidence, so
 * Revenue still showed the full amount as paid out. This asks Stripe for every recorded kitchen transfer and saves
 * any reversal the database is missing. Read-only on Stripe; idempotent. The daily payout check runs the same repair.
 *
 *   npx tsx scripts/backfill-payout-reversals.ts           # report only
 *   npx tsx scripts/backfill-payout-reversals.ts --apply   # save the missing evidence
 */
const apply = process.argv.includes('--apply');
try {
  const missing = await saveMissingTransferReversals(undefined, apply, console.log);
  console.log(`${missing} missing reversal${missing === 1 ? '' : 's'}${apply ? ' saved' : ' (dry run)'}`);
} finally {
  await pool.end();
}
