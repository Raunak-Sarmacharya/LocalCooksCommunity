import { sql } from 'drizzle-orm';
import type { db } from '../db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export interface PayoutTransferEvidence {
  transferId: string; originalAmountCents: number; reversedCents: number;
  refund?: { refundId: string; reversalId: string; amountCents: number };
}

/** Call under the payment source lock. Provider amounts and reversal receipts are separate from today's net payout. */
export async function recordPayoutTransferEvidence(tx: Tx, intentId: string, evidence: PayoutTransferEvidence) {
  const result = await tx.execute(sql`SELECT ph.metadata FROM payment_history ph
    JOIN payment_transactions pt ON pt.id = ph.transaction_id
    WHERE pt.payment_intent_id = ${intentId} AND ph.event_type = 'payout_transfer_verified'
      AND ph.metadata->>'transferId' = ${evidence.transferId} ORDER BY ph.id DESC LIMIT 1`);
  const saved = result.rows[0]?.metadata as Record<string, any> | undefined;
  if (saved && saved.originalAmountCents !== evidence.originalAmountCents) throw Error('Original transfer amount changed');
  const { refund, ...transfer } = evidence;
  const previousRefund = refund && saved?.refunds?.[refund.refundId];
  if (previousRefund && (previousRefund.reversalId !== refund!.reversalId || previousRefund.amountCents !== refund!.amountCents))
    throw Error('Verified refund reversal changed');
  if (saved && saved.reversedCents >= evidence.reversedCents && (!refund || previousRefund)) return;
  const refunds = { ...saved?.refunds, ...(refund ? { [refund.refundId]: refund } : {}) };
  const verified = { ...transfer, reversedCents: Math.max(saved?.reversedCents || 0, evidence.reversedCents), refunds };
  // History survives callers replacing their older metadata snapshot after the provider call.
  await tx.execute(sql`INSERT INTO payment_history (transaction_id, previous_status, new_status, event_type, event_source, description, metadata)
    SELECT id, status, status, 'payout_transfer_verified', 'stripe', 'Verified original transfer and reversals', ${JSON.stringify(verified)}::jsonb
    FROM payment_transactions WHERE payment_intent_id = ${intentId}`);
}
