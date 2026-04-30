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
import { users, paymentTransactions } from '@shared/schema';

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
  const baseResult: TransferResult = {
    transferred: false,
    transferId: null,
    actualStripeFeeCents: params.actualStripeFeeCents,
    platformCommissionCents: 0,
    feeWithheldCents: params.actualStripeFeeCents,
    transferredCents: Math.max(0, params.chargeAmountCents - params.actualStripeFeeCents),
  };

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

  // Idempotency: if PT already has a transfer recorded, return it
  try {
    const [existing] = await db
      .select({ transferId: paymentTransactions.transferId })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, params.paymentTransactionId))
      .limit(1);
    if (existing?.transferId) {
      logger.info(
        `[StripeTransferService] PT ${params.paymentTransactionId} already has transfer ${existing.transferId}, skipping`,
      );
      return {
        ...baseResult,
        transferred: false,
        transferId: existing.transferId,
        reason: 'Already transferred (idempotency)',
      };
    }
  } catch (err) {
    logger.warn(`[StripeTransferService] Could not check existing transfer for PT ${params.paymentTransactionId}:`, err as Error);
  }

  const managerConnectAccountId = await fetchManagerConnectAccount(params.paymentTransactionId);
  if (!managerConnectAccountId) {
    return {
      ...baseResult,
      reason: 'Manager has no Stripe Connect account — funds remain on platform balance',
    };
  }

  const platformCommissionRate = await fetchPlatformCommission();
  const platformCommissionCents = Math.round(params.chargeAmountCents * platformCommissionRate);
  const feeWithheldCents = params.actualStripeFeeCents + platformCommissionCents;
  const transferredCents = params.chargeAmountCents - feeWithheldCents;

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
      await db
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
