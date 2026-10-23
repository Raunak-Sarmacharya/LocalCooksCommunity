/**
 * Stripe Transfer Service — Separate Charges and Transfers Pattern
 *
 * ENTERPRISE STANDARD — industry-standard marketplace pattern (matches localcooks_app PHP):
 *
 *   1. At checkout: customer pays full amount via Stripe; charge lands on the
 *      PLATFORM'S Stripe balance. NO `transfer_data`, NO `application_fee_amount`.
 *
 *   2. After capture (manual or automatic), Stripe deducts the ACTUAL processing
 *      fee (varies by card type — domestic Visa, AMEX, international, currency
 *      conversion) from the platform's balance. Platform sees full charge as
 *      "balance_transaction" with `.fee` populated.
 *
 *   3. The webhook (payment_intent.succeeded or charge.updated) calls this service
 *      to create a Transfer to the manager's Connect account:
 *
 *        transfer_amount = chargeAmount − actualStripeFee − platformCommission
 *
 *      Manager receives EXACTLY this amount (no further fees deducted by Stripe
 *      on transfers). Platform keeps `platformCommission` (configurable, default 0).
 *
 *   4. transfer_id stored in payment_transactions for refund reversal.
 *
 * Why this matters:
 *   - Manager's Stripe statement always matches `payment_transactions.manager_revenue`.
 *   - Platform never overcharges or undercharges — the actual Stripe fee from
 *     `balance_transaction.fee` is used (no estimates, no safety margins).
 *   - Refunds are handled symmetrically via `stripe.transfers.createReversal()`.
 *
 * @see localcooks_app/public_html/app/webhook.php for the PHP reference implementation
 */

import Stripe from 'stripe';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { logger } from '../logger';
import { db } from '../db';
import { eq, ne, and, sql } from 'drizzle-orm';
import { users, paymentTransactions, kitchenBookingChanges } from '@shared/schema';
import { recordPayoutTransferEvidence } from './payout-document-evidence';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-02-25.clover',
}) : null;

// ============================================================================
// Types
// ============================================================================

export interface TransferToManagerParams {
  /** PaymentIntent ID for traceability and idempotency keys */
  paymentIntentId: string;
  /** payment_transactions.id for DB sync after transfer */
  paymentTransactionId: number;
  /** Captured amount in cents (charge.amount_captured, not paymentIntent.amount) */
  chargeAmountCents: number;
  /** Actual Stripe processing fee in cents from balance_transaction.fee */
  actualStripeFeeCents: number;
  /** Stripe Charge ID — passed to source_transaction so transfer is paid from this charge's funds */
  chargeId: string | undefined;
  /** Logical group for related transfers (e.g. `pi_xxx`). Helps in Stripe Dashboard. */
  transferGroup: string;
  /** Existing PT metadata (for merging) */
  existingMetadata?: Record<string, unknown> | null;
}

export interface TransferResult {
  /** True if a transfer was created. False if skipped (with `reason`). */
  transferred: boolean;
  /** Stripe Transfer ID (`tr_…`), set when transferred is true */
  transferId: string | null;
  /** Reason transfer was skipped (e.g. "manager has no Connect account") */
  reason?: string;
  /** Actual Stripe fee read from balance_transaction (cents) */
  actualStripeFeeCents: number;
  /** Platform commission withheld (cents) */
  platformCommissionCents: number;
  /** Total fee withheld from the charge (Stripe fee + platform commission) */
  feeWithheldCents: number;
  /** Amount actually transferred to manager Connect account (cents) */
  transferredCents: number;
  /** Verified original net before reversals; retain this for refund-share ceilings. */
  originalManagerNetCents?: number;
  originalTransferAmountCents?: number;
  reversedCents?: number;
}

// ============================================================================
// Internal helpers
// ============================================================================

async function fetchManagerConnectAccount(paymentTransactionId: number, connection: Pick<typeof db, 'select'>): Promise<string | null> {
  try {
    const [row] = await connection
      .select({
        managerId: paymentTransactions.managerId,
      })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, paymentTransactionId))
      .limit(1);

    if (!row?.managerId) {
      return null;
    }

    const [manager] = await connection
      .select({ stripeConnectAccountId: users.stripeConnectAccountId })
      .from(users)
      .where(
        and(
          eq(users.id, row.managerId),
          ne(users.stripeConnectAccountId, ''),
        ),
      )
      .limit(1);

    return manager?.stripeConnectAccountId ?? null;
  } catch (err) {
    logger.warn('[StripeTransferService] Could not fetch manager Connect account:', err as Error);
    return null;
  }
}

async function fetchPlatformCommission(connection: Pick<typeof db, 'select'>): Promise<number> {
  try {
    const { getFeeConfig } = await import('./stripe-checkout-fee-service');
    const config = await getFeeConfig(connection);
    return config.platformCommissionRate;
  } catch (err) {
    logger.warn('[StripeTransferService] Could not load platform commission rate, defaulting to 0:', err as Error);
    return 0;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a Stripe Transfer from the platform balance to the manager's Connect
 * account, withholding the actual Stripe processing fee + platform commission.
 *
 * Idempotent: uses an idempotency key derived from the PaymentIntent ID, so
 * webhook retries will return the same Transfer instead of duplicating it.
 *
 * Skipped (returns `transferred: false`) if:
 *   - Stripe is not configured
 *   - chargeAmountCents <= 0
 *   - actualStripeFeeCents <= 0 (balance_transaction not yet available)
 *   - Manager has no Connect account
 *   - Computed transfer amount <= 0 (charge too small to net anything)
 */
export async function transferToManagerForBooking(
  params: TransferToManagerParams,
): Promise<TransferResult> {
  const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, params.paymentTransactionId)).limit(1);
  if (source?.payoutPartition === 'per_day') return deferredDayTransfer(params);
  if (params.existingMetadata?.damage_claim_v2 === 'true') {
    const result = await (await import('./damage-claim-money')).sendClaimKitchenMoney(Number(params.existingMetadata.damage_claim_id), 'payment');
    return { transferred: !!result.transferId, transferId: result.transferId, actualStripeFeeCents: params.actualStripeFeeCents,
      platformCommissionCents: 0, feeWithheldCents: 0, transferredCents: result.transferId ? params.chargeAmountCents : 0 };
  }
  if ((source?.metadata as any)?.sessionExtensionId || (source?.metadata as any)?.kitchenChangeId) {
    const partitioned = await db.transaction(tx => import('./kitchen-day-payout-sources').then(d => d.partitionDatedSupplement(source!.id, tx)));
    if (partitioned) return deferredDayTransfer(params);
  }
  if ((source?.metadata as any)?.kitchenChangeId) return transferKitchenChangeSource(params);
  return db.transaction(async tx => {
    await tx.select({ id: paymentTransactions.id }).from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.paymentTransactionId)).limit(1).for('update');
    await assertBookingMoneyWritable({ paymentTransactionId: params.paymentTransactionId, paymentIntentId: params.paymentIntentId, payout: true }, tx);
    const [timing] = await tx.select({ payoutTiming: paymentTransactions.payoutTiming }).from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.paymentTransactionId)).limit(1);
    const result = await transferLockedSource(params, tx);
    if (result.transferred && result.transferId && result.originalTransferAmountCents !== undefined)
      await recordPayoutTransferEvidence(tx, params.paymentIntentId, { transferId: result.transferId,
        originalAmountCents: result.originalTransferAmountCents, reversedCents: result.reversedCents || 0 });
    // The release command's transfer (or a webhook/sync recovery of it) records the payout and queues its notice once.
    if (timing?.payoutTiming === 'after_closeout' && result.transferred)
      await (await import('./kitchen-payout-service')).recordReleasedPayout(params.paymentTransactionId, result, tx);
    if (timing?.payoutTiming === 'storage_term' && result.transferred)
      await (await import('./storage-payouts')).recordReleasedStoragePayout(params.paymentTransactionId, result, tx);
    return result;
  });
}

/** Reserve locally, run provider I/O without a transaction, then lock and record the same operation. */
async function transferKitchenChangeSource(params: TransferToManagerParams): Promise<TransferResult> {
  const key = `transfer:${params.paymentIntentId}`;
  const prepared = await db.transaction(async tx => {
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, params.paymentTransactionId)).for('update');
    await assertBookingMoneyWritable({ paymentTransactionId: source.id, payout: true, operationKey: key }, tx);
    const saved = (source.metadata || {}) as Record<string, any>;
    const [change] = await tx.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, saved.kitchenChangeId)).limit(1);
    if (change?.state !== 'applied') throw new Error('The booking change must finish before its kitchen payout.');
    const previous = saved.changeTransferOperation;
    const { changeTransferOperation: _previous, ...paymentMeta } = saved;
    const frozen = previous?.state === 'pending' ? previous.params : { ...params, existingMetadata: paymentMeta };
    await tx.update(paymentTransactions).set({ metadata: { ...saved, changeTransferOperation: { key, state: 'pending', params: frozen } } })
      .where(eq(paymentTransactions.id, source.id));
    return frozen as TransferToManagerParams;
  });
  // The marker blocks concurrent refunds/support money until this exact transfer is reconciled.
  const result = await transferLockedSource(prepared, db as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0], true);
  await db.transaction(async tx => {
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, params.paymentTransactionId)).for('update');
    const saved = (source.metadata || {}) as Record<string, any>;
    if (saved.changeTransferOperation?.key !== key) throw new Error('The kitchen payout decision changed.');
    if (result.transferred && result.transferId && result.originalTransferAmountCents !== undefined) {
      await tx.update(paymentTransactions).set({ transferId: result.transferId, stripeProcessingFee: String(result.actualStripeFeeCents),
        managerRevenue: String(result.originalManagerNetCents ?? result.transferredCents), updatedAt: new Date(),
        metadata: { ...saved, transfer: { ...saved.transfer, transferred: true, transferId: result.transferId,
          transferredCents: result.transferredCents, transferredAt: saved.transfer?.transferredAt || new Date().toISOString() } } }).where(eq(paymentTransactions.id, source.id));
      await recordPayoutTransferEvidence(tx, params.paymentIntentId, { transferId: result.transferId,
        originalAmountCents: result.originalTransferAmountCents, reversedCents: result.reversedCents || 0 });
      if (source.payoutTiming === 'after_closeout') await (await import('./kitchen-payout-service')).recordReleasedPayout(source.id, result, tx);
    }
    await tx.update(paymentTransactions).set({ metadata: sql`jsonb_set(${paymentTransactions.metadata}, '{changeTransferOperation,state}', '"done"'::jsonb)` })
      .where(eq(paymentTransactions.id, source.id));
  });
  return result;
}

/** Reason prefix for an after-closeout kitchen charge that has no release decision yet. Not an error. */
export const PAYOUT_DEFERRED_REASON = 'deferred: the kitchen payout is sent after the visit closes';
export const DAY_PAYOUT_DEFERRED_REASON = 'deferred: this payment is partitioned per day';
function deferredDayTransfer(params: TransferToManagerParams): TransferResult {
  return { transferred: false, transferId: null, transferredCents: 0, actualStripeFeeCents: params.actualStripeFeeCents,
    platformCommissionCents: 0, feeWithheldCents: 0, reason: DAY_PAYOUT_DEFERRED_REASON };
}

async function transferLockedSource(params: TransferToManagerParams, connection: Parameters<Parameters<typeof db.transaction>[0]>[0], deferWrites = false): Promise<TransferResult> {
  const saveTransfer = async (transferId: string) => {
    if (!deferWrites) await connection.update(paymentTransactions).set({ transferId, updatedAt: new Date() }).where(eq(paymentTransactions.id, params.paymentTransactionId));
  };
  const baseResult: TransferResult = {
    transferred: false,
    transferId: null,
    actualStripeFeeCents: params.actualStripeFeeCents,
    platformCommissionCents: 0,
    feeWithheldCents: params.actualStripeFeeCents,
    transferredCents: Math.max(0, params.chargeAmountCents - params.actualStripeFeeCents),
  };

  // Payout after closeout: every caller (payment_intent.succeeded, charge.updated, manual sync, claim/overstay
  // fallbacks) reaches this point under the source lock, before any provider I/O. A kitchen charge snapshotted
  // `after_closeout` is only transferred once releaseKitchenPayout committed a decision and it is still eligible.
  // NULL/at_capture rows (legacy) skip this block entirely.
  const [payout] = await connection.select({ payoutTiming: paymentTransactions.payoutTiming, payoutReleasedAt: paymentTransactions.payoutReleasedAt,
    payoutHoldReason: paymentTransactions.payoutHoldReason, transferId: paymentTransactions.transferId, bookingId: paymentTransactions.bookingId,
    metadata: paymentTransactions.metadata, payoutPartition: paymentTransactions.payoutPartition })
    .from(paymentTransactions).where(eq(paymentTransactions.id, params.paymentTransactionId)).limit(1);
  if (payout?.payoutPartition === 'per_day') return deferredDayTransfer(params);
  if ((payout?.metadata as { damage_claim_v2?: string } | null)?.damage_claim_v2 === 'true')
    return { ...baseResult, reason: 'Claim payment uses full-amount fulfillment; retry from the claim support case' };
  if (payout?.payoutTiming === 'after_closeout' && !payout.transferId) {
    if (!payout.payoutReleasedAt || payout.payoutHoldReason
      || !await (await import('./kitchen-payout-service')).releasedPayoutStillEligible(payout.bookingId, connection))
      return { ...baseResult, transferredCents: 0, reason: PAYOUT_DEFERRED_REASON };
  }
  // Storage holds every paid term until its own release engine commits a decision (WP-ST6).
  if (payout?.payoutTiming === 'storage_term') {
    if (!payout.payoutReleasedAt || payout.payoutHoldReason
      || !await (await import('./storage-payouts')).storageTermStillEligible(payout.bookingId, connection))
      return { ...baseResult, transferredCents: 0, reason: 'deferred: storage is paid out at the end of each paid term' };
  }

  // A captured adjustment is not an approved new schedule until inventory commit.
  // Reload durable source on every payment/charge.updated retry, never trust stale metadata.
  if (params.existingMetadata?.kitchenChangeId) {
    const [change] = await connection.select({ state: kitchenBookingChanges.state }).from(kitchenBookingChanges)
      .where(eq(kitchenBookingChanges.id, String(params.existingMetadata.kitchenChangeId))).limit(1);
    if (change?.state !== 'applied') return { ...baseResult, reason: 'Kitchen change needs schedule/payment recovery before manager transfer' };
  }

  if (!stripe) {
    return { ...baseResult, reason: 'Stripe not configured' };
  }
  if (params.chargeAmountCents <= 0) {
    return { ...baseResult, reason: 'Charge amount is zero' };
  }
  if (params.actualStripeFeeCents <= 0) {
    return { ...baseResult, reason: 'Actual Stripe fee not yet available (will retry on charge.updated)' };
  }
  if (!params.chargeId) {
    return { ...baseResult, reason: 'No charge ID provided (cannot link transfer to source)' };
  }
  // Read provider truth as well as the local ledger: refund success may have
  // preceded a failed local commit or an out-of-order fee-availability event.
  const capturedCharge = await stripe.charges.retrieve(params.chargeId);
  let managerRefundedCents = 0;
  // A Local Cooks-funded refund leaves less on the charge than the kitchen's unchanged share. A transfer tied to the charge
  // can't exceed what remains, so that payout comes from the platform balance (as claim compensation does).
  const chargeLeft = Number(capturedCharge.amount) - Number(capturedCharge.amount_refunded || 0);
  const chargeSource = (cents: number) => Number.isFinite(chargeLeft) && cents > chargeLeft ? {} : { source_transaction: params.chargeId };

  // Idempotency: if PT already has a transfer recorded, return it
  try {
    const [existing] = await connection
      .select({ transferId: paymentTransactions.transferId, refundAmount: paymentTransactions.refundAmount, metadata: paymentTransactions.metadata })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.paymentTransactionId))
      .limit(1);
    if (!existing) throw new Error('Payment source is missing; manager transfer cannot be verified.');
    if ((existing.metadata as any)?.refundRecovery && (existing.metadata as any).refundRecovery.status !== 'succeeded') return { ...baseResult, transferId: existing.transferId, transferredCents: 0, reason: 'Original refund/reversal requires recovery before new payout' };
    if ((existing.metadata as any)?.cancellationRefundOperation && (existing.metadata as any).cancellationRefundOperation.status !== 'succeeded')
      return { ...baseResult, transferId: existing.transferId, transferredCents: 0, reason: 'Source reserved for cancellation refund verification; no new payout' };
    if ((existing.metadata as any)?.capturedCancellationRace) return { ...baseResult, transferredCents: 0,
      reason: 'Captured cancellation race requires verified terms and ownership before manager payout' };
    if (capturedCharge.amount_refunded > 0 || Number(existing.refundAmount) > 0) {
      const receipts = (existing.metadata as any)?.refunds;
      if (!Array.isArray(receipts) || Number(existing.refundAmount) !== capturedCharge.amount_refunded)
        return { ...baseResult, transferId: existing.transferId, transferredCents: 0,
          reason: 'Provider/local refund history requires retained entitlement reconciliation before payout' };
      const seen = new Set<string>();
      let verifiedCustomerRefunds = 0;
      for (const receipt of receipts) {
        const id = receipt.refundId || receipt.id;
        if (!id || seen.has(id) || ![receipt.customerReceived, receipt.managerDebited, receipt.platformServiceFeeReturned]
          .every(value => Number.isSafeInteger(value) && value >= 0)
          || ![receipt.platformGoodwillCents ?? 0, receipt.platformProcessingCostCents ?? 0].every(value => Number.isSafeInteger(value) && value >= 0)
          || receipt.customerReceived !== receipt.managerDebited + receipt.platformServiceFeeReturned + (receipt.platformGoodwillCents || 0) + (receipt.platformProcessingCostCents || 0))
          return { ...baseResult, transferredCents: 0, reason: 'Refund source allocations require financial review before payout' };
        seen.add(id); verifiedCustomerRefunds += receipt.customerReceived; managerRefundedCents += receipt.managerDebited;
      }
      if (verifiedCustomerRefunds !== capturedCharge.amount_refunded)
        return { ...baseResult, transferredCents: 0, reason: 'Provider refund total differs from allocated receipts; payout requires reconciliation' };
    }
    if (existing?.transferId) {
      logger.info(
        `[StripeTransferService] PT ${params.paymentTransactionId} already has transfer ${existing.transferId}, reconciling`,
      );
      try {
        const existingTransfer = await stripe.transfers.retrieve(existing.transferId);
        const transferredCents = existingTransfer.amount - existingTransfer.amount_reversed;
        const platformCommissionRate = await fetchPlatformCommission(connection);
        const split = await resolveManagerGrossAndCommission({
          paymentTransactionId: params.paymentTransactionId,
          chargeAmountCents: params.chargeAmountCents,
          platformCommissionRate,
          existingMetadata: params.existingMetadata,
        }, connection);
        const expectedTransferCents = Math.max(0, split.managerGrossCents - params.actualStripeFeeCents - managerRefundedCents);

        // The correction may have reached Stripe before its replacement ID was
        // committed locally. A fully reversed old transfer is not the payout.
        if (existingTransfer.amount_reversed === existingTransfer.amount && expectedTransferCents > 0) {
          let replacement: Stripe.Transfer | undefined;
          for await (const candidate of stripe.transfers.list({ transfer_group: params.transferGroup, limit: 100 })) {
            if (candidate.metadata?.payment_intent_id !== params.paymentIntentId || candidate.metadata?.replaces_transfer_id !== existing.transferId) continue;
            if (replacement || candidate.amount - candidate.amount_reversed !== expectedTransferCents)
              throw new Error('Corrected manager transfer requires financial reconciliation.');
            replacement = candidate;
          }
          if (!replacement) return { ...baseResult, transferredCents: 0, transferId: existing.transferId,
            reason: 'Reversed payout correction needs provider reconciliation; no replacement transfer was created' };
          await saveTransfer(replacement.id);
          return { transferred: true, transferId: replacement.id, transferredCents: replacement.amount - replacement.amount_reversed,
            originalTransferAmountCents: replacement.amount, reversedCents: replacement.amount_reversed,
            originalManagerNetCents: split.managerGrossCents - params.actualStripeFeeCents,
            actualStripeFeeCents: params.actualStripeFeeCents, platformCommissionCents: split.platformCommissionCents,
            feeWithheldCents: split.platformCommissionCents + params.actualStripeFeeCents,
            reason: 'Recovered corrected provider payout; no new transfer created' };
        }

        // A previously-created underpayment cannot be edited in Stripe. Replace
        // it atomically (idempotent reversal + idempotent corrected transfer) so
        // the DB continues tracking one authoritative transfer for refunds.
        if (expectedTransferCents > transferredCents && existingTransfer.amount_reversed === 0) {
          const existingDestination = typeof existingTransfer.destination === 'string'
            ? existingTransfer.destination
            : existingTransfer.destination?.id;
          if (!existingDestination) {
            throw new Error(`Existing transfer ${existing.transferId} has no destination`);
          }
          await stripe.transfers.createReversal(
            existing.transferId,
            {
              amount: transferredCents,
              metadata: {
                reason: 'automatic_payout_reconciliation',
                corrected_transfer_amount_cents: String(expectedTransferCents),
              },
            },
            { idempotencyKey: `transfer-reconcile-reversal:${params.paymentIntentId}:${expectedTransferCents}` },
          );

          const correctedTransfer = await stripe.transfers.create(
            {
              amount: expectedTransferCents,
              currency: existingTransfer.currency,
              destination: existingDestination,
              ...chargeSource(expectedTransferCents),
              transfer_group: params.transferGroup,
              description: `Corrected manager payout for ${params.paymentIntentId}`,
              metadata: {
                payment_intent_id: params.paymentIntentId,
                payment_transaction_id: String(params.paymentTransactionId),
                replaces_transfer_id: existing.transferId,
                transferred_cents: String(expectedTransferCents),
              },
            },
            { idempotencyKey: `transfer-reconcile-create:${params.paymentIntentId}:${expectedTransferCents}` },
          );

          await saveTransfer(correctedTransfer.id);

          return {
            transferred: true,
            transferId: correctedTransfer.id,
            reason: `Replaced underpaid transfer ${existing.transferId}`,
            actualStripeFeeCents: params.actualStripeFeeCents,
            platformCommissionCents: split.platformCommissionCents,
            feeWithheldCents: params.chargeAmountCents - expectedTransferCents,
            transferredCents: expectedTransferCents,
            originalTransferAmountCents: expectedTransferCents, reversedCents: 0,
          };
        }
        // Intentional manager reversals are customer refunds, never new fees.
        const feeWithheldCents = split.platformCommissionCents + params.actualStripeFeeCents;
        return {
          transferred: true,
          transferId: existing.transferId,
          reason: 'Already transferred; reconciled existing transfer',
          actualStripeFeeCents: params.actualStripeFeeCents,
          platformCommissionCents: split.platformCommissionCents,
          feeWithheldCents,
          transferredCents,
          originalTransferAmountCents: existingTransfer.amount, reversedCents: existingTransfer.amount_reversed,
          originalManagerNetCents: managerRefundedCents > 0 ? split.managerGrossCents - params.actualStripeFeeCents : existingTransfer.amount,
        };
      } catch (retrieveErr) {
        logger.warn(`[StripeTransferService] Could not retrieve existing transfer ${existing.transferId}:`, retrieveErr as Error);
        return {
          ...baseResult,
          transferId: existing.transferId,
          reason: 'Already transferred; reconciliation pending',
        };
      }
    }
  } catch (err) {
    logger.warn(`[StripeTransferService] Could not check existing transfer for PT ${params.paymentTransactionId}:`, err as Error);
    throw err;
  }

  const managerConnectAccountId = await fetchManagerConnectAccount(params.paymentTransactionId, connection);
  if (!managerConnectAccountId) {
    return {
      ...baseResult,
      reason: 'Manager has no Stripe Connect account — funds remain on platform balance',
    };
  }

  const platformCommissionRate = await fetchPlatformCommission(connection);

  // Prefer capture-engine values (metadata / PT columns) over reverse-engineering.
  // Chef paid: subtotal + tax + serviceFee(on subtotal). Manager keeps (subtotal + tax) − Stripe fee.
  // Platform keeps serviceFee. Never reverse from charge/(1+rate) when we already stored the split.
  const { managerGrossCents, platformCommissionCents } = await resolveManagerGrossAndCommission({
    paymentTransactionId: params.paymentTransactionId,
    chargeAmountCents: params.chargeAmountCents,
    platformCommissionRate,
    existingMetadata: params.existingMetadata,
  }, connection);

  // The manager receives subtotal + tax minus the actual Stripe fee
  const originalManagerNetCents = managerGrossCents - params.actualStripeFeeCents;
  const transferredCents = originalManagerNetCents - managerRefundedCents;

  // The amount the platform keeps in its Stripe balance (service fee + stripe fee withheld from transfer)
  const feeWithheldCents = platformCommissionCents + params.actualStripeFeeCents;
  if (transferredCents <= 0) {
    return {
      ...baseResult,
      platformCommissionCents,
      feeWithheldCents,
      transferredCents: 0,
      reason: `Computed transfer amount (${transferredCents}¢) is non-positive — fees exceed charge`,
    };
  }

  try {
    // A provider success can outlive a failed local transfer-ID write. Discover
    // that same source before creating again, even after key retention ends.
    let recoveredTransfer: Stripe.Transfer | undefined;
    for await (const candidate of stripe.transfers.list({ transfer_group: params.transferGroup, limit: 100 })) {
      if (candidate.metadata?.payment_intent_id !== params.paymentIntentId) continue;
      if (recoveredTransfer) throw new Error('Multiple manager transfers require financial reconciliation.');
      recoveredTransfer = candidate;
    }
    if (recoveredTransfer) {
      await saveTransfer(recoveredTransfer.id);
      return { ...baseResult, transferred: true, transferId: recoveredTransfer.id, platformCommissionCents,
        originalTransferAmountCents: recoveredTransfer.amount, reversedCents: recoveredTransfer.amount_reversed,
        feeWithheldCents, transferredCents: recoveredTransfer.amount - recoveredTransfer.amount_reversed,
        originalManagerNetCents: recoveredTransfer.amount - recoveredTransfer.amount_reversed + managerRefundedCents,
        reason: 'Recovered existing provider transfer; no new transfer created' };
    }
    const transfer = await stripe.transfers.create(
      {
        amount: transferredCents,
        currency: 'cad',
        destination: managerConnectAccountId,
        // source_transaction ensures the transfer is paid from the funds collected by this charge,
        // not from arbitrary platform balance. Required when funds may not yet be available
        // (Stripe queues the transfer until the charge's funds are available).
        ...chargeSource(transferredCents),
        transfer_group: params.transferGroup,
        description: `Manager payout for ${params.paymentIntentId}`,
        metadata: {
          payment_intent_id: params.paymentIntentId,
          payment_transaction_id: String(params.paymentTransactionId),
          charge_id: params.chargeId,
          charge_amount_cents: String(params.chargeAmountCents),
          actual_stripe_fee_cents: String(params.actualStripeFeeCents),
          platform_commission_cents: String(platformCommissionCents),
          fee_withheld_cents: String(feeWithheldCents),
          transferred_cents: String(transferredCents),
        },
      },
      {
        // Idempotency: webhook retries should return the same transfer, not duplicate it.
        // A platform-funded payout is a different request than a charge-linked one (a refused charge-linked try may hold the key).
        idempotencyKey: `transfer:${params.paymentIntentId}${'source_transaction' in chargeSource(transferredCents) ? '' : ':platform'}`,
      },
    );

    // Persist transfer_id on payment_transactions (best-effort; webhook also updates)
    try {
      await saveTransfer(transfer.id);
    } catch (err) {
      logger.warn(
        `[StripeTransferService] Could not persist transfer_id ${transfer.id} on PT ${params.paymentTransactionId}:`,
        err as Error,
      );
    }

    logger.info(
      `[StripeTransferService] ✅ Transferred ${transferredCents}¢ to ${managerConnectAccountId} for ${params.paymentIntentId}:`,
      {
        transferId: transfer.id,
        chargeAmount: `$${(params.chargeAmountCents / 100).toFixed(2)}`,
        actualStripeFee: `$${(params.actualStripeFeeCents / 100).toFixed(2)}`,
        platformCommission: `$${(platformCommissionCents / 100).toFixed(2)}`,
        feeWithheld: `$${(feeWithheldCents / 100).toFixed(2)}`,
        transferred: `$${(transferredCents / 100).toFixed(2)}`,
      },
    );

    return {
      transferred: true,
      transferId: transfer.id,
      actualStripeFeeCents: params.actualStripeFeeCents,
      platformCommissionCents,
      feeWithheldCents,
      transferredCents,
      originalManagerNetCents,
      originalTransferAmountCents: transferredCents, reversedCents: 0,
    };
  } catch (err: any) {
    // Stripe returns the same transfer on idempotency replay — handle gracefully
    if (err?.code === 'idempotency_error' || err?.raw?.code === 'idempotency_error') {
      logger.warn(
        `[StripeTransferService] Idempotency conflict for ${params.paymentIntentId} — likely concurrent webhook retry`,
      );
    }
    logger.error(`[StripeTransferService] Error creating transfer for ${params.paymentIntentId}:`, err);
    throw err;
  }
}

import { computeManagerGrossAndCommission } from "./manager-payout-math";

export { computeManagerGrossAndCommission } from "./manager-payout-math";

/**
 * Resolve manager gross (subtotal + tax) and platform commission for a transfer.
 * Prefer capture metadata / PT columns; fall back to charge / (1 + rate).
 */
async function resolveManagerGrossAndCommission(params: {
  paymentTransactionId: number;
  chargeAmountCents: number;
  platformCommissionRate: number;
  existingMetadata?: Record<string, unknown> | null;
}, connection: Pick<typeof db, 'select'>): Promise<{ managerGrossCents: number; platformCommissionCents: number }> {
  const meta: Record<string, unknown> = { ...(params.existingMetadata || {}) };
  let storedBaseAmountCents = 0;
  let storedServiceFeeCents = 0;

  try {
    const [pt] = await connection
      .select({
        baseAmount: paymentTransactions.baseAmount,
        serviceFee: paymentTransactions.serviceFee,
        metadata: paymentTransactions.metadata,
      })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.paymentTransactionId))
      .limit(1);

    if (pt) {
      storedBaseAmountCents = parseInt(String(pt.baseAmount || "0"), 10) || 0;
      storedServiceFeeCents = parseInt(String(pt.serviceFee || "0"), 10) || 0;
      if (pt.metadata) {
        const parsed =
          typeof pt.metadata === "string" ? JSON.parse(pt.metadata) : pt.metadata;
        for (const [k, v] of Object.entries(parsed || {})) {
          if (meta[k] === undefined || meta[k] === null) meta[k] = v;
        }
      }
    }
  } catch (err) {
    logger.warn(
      `[StripeTransferService] Could not load PT ${params.paymentTransactionId} for fee split:`,
      err as Error,
    );
    throw new Error('Captured source components are unavailable; manager payout requires reconciliation.');
  }

  return computeManagerGrossAndCommission({
    chargeAmountCents: params.chargeAmountCents,
    platformCommissionRate: params.platformCommissionRate,
    approvedSubtotalCents: Number(meta.approvedSubtotal) || undefined,
    approvedTaxCents: Number(meta.approvedTax) || undefined,
    platformCommissionCents:
      Number(meta.platformCommission ?? meta.applicationFee) || undefined,
    capturedAmountCents: Number(meta.capturedAmount) || undefined,
    originalAuthorizedAmountCents: Number(meta.originalAuthorizedAmount) || undefined,
    storedBaseAmountCents,
    storedServiceFeeCents,
  });
}

/**
 * Reverse a previously-created transfer (or part of it) when a customer refund occurs.
 * Reclaims funds from the manager's Connect account back to the platform balance.
 *
 * Use this when issuing a customer refund so the manager doesn't keep money for a
 * cancelled/refunded booking.
 *
 * @param transferId - The Stripe Transfer ID (tr_...)
 * @param refundAmountCents - Customer refund amount (cents). The reversal amount is
 *   prorated against the original transfer using `(refundAmount / chargeAmount) * transferredAmount`.
 * @param chargeAmountCents - Original captured charge amount (used for proration)
 * @param transferredAmountCents - Amount of the original transfer (used for proration)
 * @returns The TransferReversal record from Stripe
 */
export async function reverseTransferForRefund(
  transferId: string,
  refundAmountCents: number,
  chargeAmountCents: number,
  transferredAmountCents: number,
): Promise<Stripe.TransferReversal | null> {
  await assertBookingMoneyWritable({ transferId });
  if (!stripe) {
    logger.warn('[StripeTransferService] Stripe not configured — cannot reverse transfer');
    return null;
  }
  if (refundAmountCents <= 0 || chargeAmountCents <= 0 || transferredAmountCents <= 0) {
    return null;
  }

  // Prorate the reversal: refund/charge × transferredAmount
  // E.g., 50% refund → reverse 50% of the transfer
  const reversalAmountCents = Math.min(
    transferredAmountCents,
    Math.round((refundAmountCents / chargeAmountCents) * transferredAmountCents),
  );

  if (reversalAmountCents <= 0) {
    return null;
  }

  try {
    const reversal = await stripe.transfers.createReversal(transferId, {
      amount: reversalAmountCents,
      metadata: {
        refund_amount_cents: String(refundAmountCents),
        charge_amount_cents: String(chargeAmountCents),
        original_transfer_amount_cents: String(transferredAmountCents),
      },
    });

    logger.info(
      `[StripeTransferService] ✅ Reversed ${reversalAmountCents}¢ from transfer ${transferId} (refund=$${(refundAmountCents / 100).toFixed(2)})`,
    );
    return reversal;
  } catch (err: any) {
    logger.error(`[StripeTransferService] Error reversing transfer ${transferId}:`, err);
    throw err;
  }
}
