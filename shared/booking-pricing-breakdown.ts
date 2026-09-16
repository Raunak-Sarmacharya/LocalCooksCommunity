/**
 * Kitchen booking pricing breakdown — chef receipt vs kitchen payout statement.
 *
 * Money model (chef pays platform fee on top of kitchen subtotal + kitchen HST):
 *   chefTotal = kitchenSubtotal + kitchenHst + platformFee (+ platformHst when registered)
 *   platformFee = rate × kitchenSubtotal (excludes HST and refundable deposits)
 *   kitchenGross = kitchenSubtotal + kitchenHst
 *   kitchenNetPayout = kitchenGross − paymentProcessorFee (− platformFee when fee was
 *     withheld from the manager because the Stripe charge did not include fee-on-top)
 *
 * Local Cooks is not GST/HST-registered today — platformHst stays 0 until configured.
 */

export type BookingPricingBreakdownInput = {
  kitchenBaseSubtotalCents: number;
  kitchenHstRatePercent?: number | null;
  /** Stored tax charged for this booking; preferred over recalculating with today's rate */
  kitchenHstAmountCents?: number;
  platformFeeRate?: number | null;
  /** GST/HST on Local Cooks fee — 0 until LC registers */
  platformHstRatePercent?: number | null;
  paymentProcessorFeeCents?: number;
  refundAmountCents?: number;
  /** Stored platform fee (cents); calculated from subtotal when omitted */
  platformFeeAmountCents?: number;
  /**
   * Stripe Connect transfer amount (payment_transactions.manager_revenue).
   * Preferred when it reflects the post-transfer net (not a stale pre-capture gross).
   */
  kitchenNetPayoutCents?: number | null;
  /** payment_transactions.amount — chef charge (subtotal+tax[+fee]) */
  chargeAmountCents?: number | null;
  hourlyRateCents?: number;
  bookedHours?: number;
  /** Show Stripe/processor fee line (when kitchen contract passes it through) */
  showPaymentProcessorFee?: boolean;
  /** Processor fee is a pre-capture estimate from platform_settings */
  paymentProcessorFeeIsEstimate?: boolean;
  /** Always show the Local Cooks fee line (chef-paid or withheld) for manager transparency */
  showPlatformFeeLine?: boolean;
};

export type ChefBookingReceiptBreakdown = {
  kitchenBaseSubtotalCents: number;
  kitchenHstRegistered: boolean;
  kitchenHstRatePercent: number;
  kitchenHstAmountCents: number;
  platformFeeRate: number;
  platformFeeAmountCents: number;
  platformHstRatePercent: number;
  platformHstAmountCents: number;
  totalPaidCents: number;
  refundAmountCents: number;
  netPaidCents: number;
};

export type KitchenPayoutStatementBreakdown = {
  hourlyRateCents?: number;
  bookedHours?: number;
  kitchenBaseSubtotalCents: number;
  kitchenHstRegistered: boolean;
  kitchenHstRatePercent: number;
  kitchenHstAmountCents: number;
  kitchenGrossCollectedCents: number;
  platformFeeRate: number;
  platformFeeAmountCents: number;
  /** True when platform fee was taken from the manager transfer (not paid by chef on top). */
  platformFeeWithheldFromManager: boolean;
  /** Show platform fee on the statement even when chef paid it on top (transparency). */
  showPlatformFeeLine: boolean;
  platformHstRatePercent: number;
  platformHstAmountCents: number;
  paymentProcessorFeeCents: number;
  /** True when paymentProcessorFeeCents is a platform_settings estimate (pre-capture). */
  paymentProcessorFeeIsEstimate: boolean;
  refundAmountCents: number;
  kitchenNetPayoutCents: number;
};

/**
 * Resolve the manager-facing net payout.
 *
 * Prefer Stripe-synced manager_revenue when it is a real transfer net (strictly
 * below kitchen gross once fees exist). Otherwise reconstruct:
 *   kitchenGross − stripeFee − (platformFee if charge ≈ gross).
 */
export function resolveDisplayedKitchenNetPayoutCents(input: {
  kitchenNetPayoutCents?: number | null;
  kitchenBaseSubtotalCents: number;
  kitchenHstAmountCents: number;
  paymentProcessorFeeCents?: number | null;
  platformFeeAmountCents?: number | null;
  chargeAmountCents?: number | null;
}): {
  netPayoutCents: number;
  platformFeeWithheldFromManager: boolean;
  kitchenGrossCollectedCents: number;
} {
  const kitchenGrossCollectedCents =
    Math.max(0, Number(input.kitchenBaseSubtotalCents) || 0) +
    Math.max(0, Number(input.kitchenHstAmountCents) || 0);
  const stripeFee = Math.max(0, Number(input.paymentProcessorFeeCents) || 0);
  const platformFee = Math.max(0, Number(input.platformFeeAmountCents) || 0);
  const charge =
    input.chargeAmountCents != null && Number.isFinite(Number(input.chargeAmountCents))
      ? Math.max(0, Number(input.chargeAmountCents))
      : null;

  // Fee-on-top charge: amount ≈ gross + platform fee. Fee-from-manager: amount ≈ gross.
  const platformFeeWithheldFromManager =
    platformFee > 0 &&
    charge != null &&
    charge > 0 &&
    Math.abs(charge - kitchenGrossCollectedCents) <= 1;

  const synced = input.kitchenNetPayoutCents;
  const syncedCents =
    synced != null && Number.isFinite(Number(synced)) ? Math.round(Number(synced)) : null;

  // Stale pre-transfer rows keep manager_revenue == base_amount until the Connect
  // transfer lands. Treat that as "not yet synced" once we know fees to deduct.
  const syncedLooksLikeGross =
    syncedCents != null &&
    kitchenGrossCollectedCents > 0 &&
    Math.abs(syncedCents - kitchenGrossCollectedCents) <= 1;
  const feesKnown = stripeFee > 0 || platformFeeWithheldFromManager;
  const preferSynced =
    syncedCents != null &&
    syncedCents >= 0 &&
    !(syncedLooksLikeGross && feesKnown);

  if (preferSynced) {
    return {
      netPayoutCents: syncedCents,
      platformFeeWithheldFromManager,
      kitchenGrossCollectedCents,
    };
  }

  return {
    netPayoutCents: Math.max(
      0,
      kitchenGrossCollectedCents - stripeFee - (platformFeeWithheldFromManager ? platformFee : 0),
    ),
    platformFeeWithheldFromManager,
    kitchenGrossCollectedCents,
  };
}

export function isKitchenHstRegistered(taxRatePercent?: number | null): boolean {
  return Math.max(0, Number(taxRatePercent) || 0) > 0;
}

export function computeKitchenHstAmountCents(
  subtotalCents: number,
  taxRatePercent?: number | null
): number {
  const rate = Math.max(0, Number(taxRatePercent) || 0);
  if (rate <= 0) return 0;
  return Math.round((Math.max(0, subtotalCents) * rate) / 100);
}

export function computePlatformFeeAmountCents(
  kitchenBaseSubtotalCents: number,
  platformFeeRate?: number | null
): number {
  const rate = Math.max(0, Number(platformFeeRate) || 0);
  return Math.round(Math.max(0, kitchenBaseSubtotalCents) * rate);
}

/**
 * Display-only fee estimate (platform_settings rates).
 * Matches server calculateCheckoutFeesAsync — not the live Stripe balance_transaction fee.
 */
export function estimateManagerPayoutFeesCents(input: {
  subtotalCents: number;
  taxCents?: number | null;
  platformCommissionRate: number;
  stripePercentageFee: number;
  stripeFlatFeeCents: number;
  /** Prefer stored platform fee when already charged at checkout */
  platformFeeAmountCents?: number | null;
}): {
  platformCommissionCents: number;
  stripeProcessingFeeCents: number;
  totalChargeCents: number;
  managerReceivesCents: number;
} {
  const subtotalCents = Math.max(0, Math.round(Number(input.subtotalCents) || 0));
  const taxCents = Math.max(0, Math.round(Number(input.taxCents) || 0));
  const platformCommissionCents =
    input.platformFeeAmountCents != null && Number(input.platformFeeAmountCents) >= 0
      ? Math.round(Number(input.platformFeeAmountCents))
      : Math.round(subtotalCents * Math.max(0, Number(input.platformCommissionRate) || 0));
  const totalChargeCents = subtotalCents + taxCents + platformCommissionCents;
  const stripeProcessingFeeCents = Math.round(
    totalChargeCents * Math.max(0, Number(input.stripePercentageFee) || 0) +
      Math.max(0, Number(input.stripeFlatFeeCents) || 0),
  );
  return {
    platformCommissionCents,
    stripeProcessingFeeCents,
    totalChargeCents,
    managerReceivesCents: Math.max(0, subtotalCents + taxCents - stripeProcessingFeeCents),
  };
}

export function buildChefBookingReceiptBreakdown(
  input: BookingPricingBreakdownInput
): ChefBookingReceiptBreakdown {
  const kitchenBaseSubtotalCents = Math.max(0, Number(input.kitchenBaseSubtotalCents) || 0);
  const kitchenHstRatePercent = Math.max(0, Number(input.kitchenHstRatePercent) || 0);
  const platformFeeRate = Math.max(0, Number(input.platformFeeRate) || 0);
  const platformHstRatePercent = Math.max(0, Number(input.platformHstRatePercent) || 0);
  const storedKitchenHstAmountCents =
    input.kitchenHstAmountCents != null && input.kitchenHstAmountCents >= 0
      ? Math.round(input.kitchenHstAmountCents)
      : null;
  const kitchenHstRegistered =
    isKitchenHstRegistered(kitchenHstRatePercent) || (storedKitchenHstAmountCents ?? 0) > 0;
  const kitchenHstAmountCents =
    storedKitchenHstAmountCents != null
      ? storedKitchenHstAmountCents
      : kitchenHstRegistered
        ? computeKitchenHstAmountCents(kitchenBaseSubtotalCents, kitchenHstRatePercent)
        : 0;
  const platformFeeAmountCents =
    input.platformFeeAmountCents != null && input.platformFeeAmountCents >= 0
      ? Math.round(input.platformFeeAmountCents)
      : computePlatformFeeAmountCents(kitchenBaseSubtotalCents, platformFeeRate);
  const platformHstAmountCents =
    platformHstRatePercent > 0
      ? computeKitchenHstAmountCents(platformFeeAmountCents, platformHstRatePercent)
      : 0;

  const totalPaidCents =
    kitchenBaseSubtotalCents +
    kitchenHstAmountCents +
    platformFeeAmountCents +
    platformHstAmountCents;
  const refundAmountCents = Math.min(
    totalPaidCents,
    Math.max(0, Number(input.refundAmountCents) || 0),
  );

  return {
    kitchenBaseSubtotalCents,
    kitchenHstRegistered,
    kitchenHstRatePercent,
    kitchenHstAmountCents,
    platformFeeRate,
    platformFeeAmountCents,
    platformHstRatePercent,
    platformHstAmountCents,
    totalPaidCents,
    refundAmountCents,
    netPaidCents: totalPaidCents - refundAmountCents,
  };
}

export function buildKitchenPayoutStatementBreakdown(
  input: BookingPricingBreakdownInput
): KitchenPayoutStatementBreakdown {
  const receipt = buildChefBookingReceiptBreakdown(input);
  const paymentProcessorFeeCents = Math.max(0, Number(input.paymentProcessorFeeCents) || 0);
  const refundAmountCents = Math.max(0, Number(input.refundAmountCents) || 0);

  const resolved = resolveDisplayedKitchenNetPayoutCents({
    kitchenNetPayoutCents: input.kitchenNetPayoutCents,
    kitchenBaseSubtotalCents: receipt.kitchenBaseSubtotalCents,
    kitchenHstAmountCents: receipt.kitchenHstAmountCents,
    paymentProcessorFeeCents,
    platformFeeAmountCents: receipt.platformFeeAmountCents,
    chargeAmountCents: input.chargeAmountCents,
  });

  // The stored Stripe-synced payout is the original transfer amount. Refunds
  // can also contain the platform-owned service fee, so only subtract up to
  // the kitchen's original payout and never show a negative manager payout.
  const managerFundedRefundCents = Math.min(
    refundAmountCents,
    resolved.netPayoutCents
  );
  const kitchenNetPayoutCents = Math.max(
    0,
    resolved.netPayoutCents - managerFundedRefundCents
  );

  return {
    hourlyRateCents: input.hourlyRateCents,
    bookedHours: input.bookedHours,
    kitchenBaseSubtotalCents: receipt.kitchenBaseSubtotalCents,
    kitchenHstRegistered: receipt.kitchenHstRegistered,
    kitchenHstRatePercent: receipt.kitchenHstRatePercent,
    kitchenHstAmountCents: receipt.kitchenHstAmountCents,
    kitchenGrossCollectedCents: resolved.kitchenGrossCollectedCents,
    platformFeeRate: receipt.platformFeeRate,
    platformFeeAmountCents: receipt.platformFeeAmountCents,
    platformFeeWithheldFromManager: resolved.platformFeeWithheldFromManager,
    showPlatformFeeLine:
      input.showPlatformFeeLine === true ||
      resolved.platformFeeWithheldFromManager ||
      receipt.platformFeeAmountCents > 0,
    platformHstRatePercent: receipt.platformHstRatePercent,
    platformHstAmountCents: receipt.platformHstAmountCents,
    paymentProcessorFeeCents,
    paymentProcessorFeeIsEstimate: input.paymentProcessorFeeIsEstimate === true,
    refundAmountCents,
    kitchenNetPayoutCents,
  };
}

/** Aggregate dashboard totals for manager revenue overview */
export function aggregateKitchenPayoutTotals(
  rows: KitchenPayoutStatementBreakdown[]
): {
  rentalRevenueBeforeHstCents: number;
  hstCollectedCents: number;
  localCooksFeesCents: number;
  netPayoutCents: number;
} {
  return rows.reduce(
    (acc, row) => ({
      rentalRevenueBeforeHstCents:
        acc.rentalRevenueBeforeHstCents + row.kitchenBaseSubtotalCents,
      hstCollectedCents: acc.hstCollectedCents + row.kitchenHstAmountCents,
      localCooksFeesCents:
        acc.localCooksFeesCents +
        row.platformFeeAmountCents +
        row.platformHstAmountCents,
      netPayoutCents: acc.netPayoutCents + row.kitchenNetPayoutCents,
    }),
    {
      rentalRevenueBeforeHstCents: 0,
      hstCollectedCents: 0,
      localCooksFeesCents: 0,
      netPayoutCents: 0,
    }
  );
}
