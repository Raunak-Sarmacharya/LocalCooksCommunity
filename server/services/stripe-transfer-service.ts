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
import { logger } from '../logger';
import { db } from '../db';
import { eq, ne, and } from 'drizzle-orm';
import { users, paymentTransactions, kitchenBookingChanges } from '@shared/schema';

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
}

// ============================================================================
// Internal helpers
// ============================================================================

async function fetchManagerConnectAccount(paymentTransactionId: number): Promise<string | null> {
  try {
    const [row] = await db
      .select({
        managerId: paymentTransactions.managerId,
      })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, paymentTransactionId))
      .limit(1);

    if (!row?.managerId) {
      return null;
    }

    const [manager] = await db
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

async function fetchPlatformCommission(): Promise<number> {
  try {
    const { getFeeConfig } = await import('./stripe-checkout-fee-service');
    const config = await getFeeConfig();
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
  return db.transaction(async tx => {
    await tx.select({ id: paymentTransactions.id }).from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.paymentTransactionId)).limit(1).for('update');
    return transferLockedSource(params, tx);
  });
}

async function transferLockedSource(params: TransferToManagerParams, connection: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<TransferResult> {
  const baseResult: TransferResult = {
    transferred: false,
    transferId: null,
    actualStripeFeeCents: params.actualStripeFeeCents,
    platformCommissionCents: 0,
    feeWithheldCents: params.actualStripeFeeCents,
    transferredCents: Math.max(0, params.chargeAmountCents - params.actualStripeFeeCents),
  };

  // A captured adjustment is not an approved new schedule until inventory commit.
  // Reload durable source on every payment/charge.updated retry, never trust stale metadata.
  if (params.existingMetadata?.kitchenChangeId) {
    const [change] = await db.select({ state: kitchenBookingChanges.state }).from(kitchenBookingChanges)
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
          || receipt.customerReceived !== receipt.managerDebited + receipt.platformServiceFeeReturned)
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
        const platformCommissionRate = await fetchPlatformCommission();
        const split = await resolveManagerGrossAndCommission({
          paymentTransactionId: params.paymentTransactionId,
          chargeAmountCents: params.chargeAmountCents,
          platformCommissionRate,
          existingMetadata: params.existingMetadata,
        });
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
          await connection.update(paymentTransactions).set({ transferId: replacement.id, updatedAt: new Date() })
            .where(eq(paymentTransactions.id, params.paymentTransactionId));
          return { transferred: true, transferId: replacement.id, transferredCents: replacement.amount - replacement.amount_reversed,
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
              source_transaction: params.chargeId,
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

          await connection
            .update(paymentTransactions)
            .set({ transferId: correctedTransfer.id, updatedAt: new Date() })
            .where(eq(paymentTransactions.id, params.paymentTransactionId));

          return {
            transferred: true,
            transferId: correctedTransfer.id,
            reason: `Replaced underpaid transfer ${existing.transferId}`,
            actualStripeFeeCents: params.actualStripeFeeCents,
            platformCommissionCents: split.platformCommissionCents,
            feeWithheldCents: params.chargeAmountCents - expectedTransferCents,
            transferredCents: expectedTransferCents,
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

  const managerConnectAccountId = await fetchManagerConnectAccount(params.paymentTransactionId);
  if (!managerConnectAccountId) {
    return {
      ...baseResult,
      reason: 'Manager has no Stripe Connect account — funds remain on platform balance',
    };
  }

  const platformCommissionRate = await fetchPlatformCommission();

  // Prefer capture-engine values (metadata / PT columns) over reverse-engineering.
  // Chef paid: subtotal + tax + serviceFee(on subtotal). Manager keeps (subtotal + tax) − Stripe fee.
  // Platform keeps serviceFee. Never reverse from charge/(1+rate) when we already stored the split.
  const { managerGrossCents, platformCommissionCents } = await resolveManagerGrossAndCommission({
    paymentTransactionId: params.paymentTransactionId,
    chargeAmountCents: params.chargeAmountCents,
    platformCommissionRate,
    existingMetadata: params.existingMetadata,
  });

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
      await connection.update(paymentTransactions).set({ transferId: recoveredTransfer.id, updatedAt: new Date() })
        .where(eq(paymentTransactions.id, params.paymentTransactionId));
      return { ...baseResult, transferred: true, transferId: recoveredTransfer.id, platformCommissionCents,
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
        source_transaction: params.chargeId,
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
        idempotencyKey: `transfer:${params.paymentIntentId}`,
      },
    );

    // Persist transfer_id on payment_transactions (best-effort; webhook also updates)
    try {
      await connection
        .update(paymentTransactions)
        .set({ transferId: transfer.id, updatedAt: new Date() })
        .where(eq(paymentTransactions.id, params.paymentTransactionId));
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
}): Promise<{ managerGrossCents: number; platformCommissionCents: number }> {
  const meta: Record<string, unknown> = { ...(params.existingMetadata || {}) };
  let storedBaseAmountCents = 0;
  let storedServiceFeeCents = 0;

  try {
    const [pt] = await db
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
