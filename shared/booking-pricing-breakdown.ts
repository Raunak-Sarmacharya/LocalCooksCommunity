/**
 * Kitchen booking pricing breakdown — chef receipt vs kitchen payout statement.
 *
 * Money model (chef pays platform fee on top of kitchen subtotal + kitchen HST):
 *   chefTotal = kitchenSubtotal + kitchenHst + platformFee (+ platformHst when registered)
 *   platformFee = rate × kitchenSubtotal (excludes HST and refundable deposits)
 *   kitchenGross = kitchenSubtotal + kitchenHst
 *   kitchenNetPayout ≈ kitchenGross − paymentProcessorFee − adjustments
 *   (platform fee is paid by the chef on top — show on the statement but do not deduct twice)
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
  /** Stripe-synced net transfer — preferred when present */
  kitchenNetPayoutCents?: number;
  hourlyRateCents?: number;
  bookedHours?: number;
  /** Show Stripe/processor fee line (when kitchen contract passes it through) */
  showPaymentProcessorFee?: boolean;
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
  platformHstRatePercent: number;
  platformHstAmountCents: number;
  paymentProcessorFeeCents: number;
  refundAmountCents: number;
  kitchenNetPayoutCents: number;
};

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

  return {
    kitchenBaseSubtotalCents,
    kitchenHstRegistered,
    kitchenHstRatePercent,
    kitchenHstAmountCents,
    platformFeeRate,
    platformFeeAmountCents,
    platformHstRatePercent,
    platformHstAmountCents,
    totalPaidCents:
      kitchenBaseSubtotalCents +
      kitchenHstAmountCents +
      platformFeeAmountCents +
      platformHstAmountCents,
  };
}

export function buildKitchenPayoutStatementBreakdown(
  input: BookingPricingBreakdownInput
): KitchenPayoutStatementBreakdown {
  const receipt = buildChefBookingReceiptBreakdown(input);
  const paymentProcessorFeeCents = Math.max(0, Number(input.paymentProcessorFeeCents) || 0);
  const refundAmountCents = Math.max(0, Number(input.refundAmountCents) || 0);
  const kitchenGrossCollectedCents =
    receipt.kitchenBaseSubtotalCents + receipt.kitchenHstAmountCents;

  const computedNet = Math.max(
    0,
    kitchenGrossCollectedCents - paymentProcessorFeeCents - refundAmountCents
  );

  const kitchenNetPayoutCents =
    input.kitchenNetPayoutCents != null && input.kitchenNetPayoutCents >= 0
      ? Math.round(input.kitchenNetPayoutCents)
      : computedNet;

  return {
    hourlyRateCents: input.hourlyRateCents,
    bookedHours: input.bookedHours,
    kitchenBaseSubtotalCents: receipt.kitchenBaseSubtotalCents,
    kitchenHstRegistered: receipt.kitchenHstRegistered,
    kitchenHstRatePercent: receipt.kitchenHstRatePercent,
    kitchenHstAmountCents: receipt.kitchenHstAmountCents,
    kitchenGrossCollectedCents,
    platformFeeRate: receipt.platformFeeRate,
    platformFeeAmountCents: receipt.platformFeeAmountCents,
    platformHstRatePercent: receipt.platformHstRatePercent,
    platformHstAmountCents: receipt.platformHstAmountCents,
    paymentProcessorFeeCents,
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
