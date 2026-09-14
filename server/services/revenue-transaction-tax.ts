import { computeManagerGrossAndCommission } from "./manager-payout-math";

/**
 * Resolve manager-facing tax + subtotal for a kitchen revenue transaction row.
 * Prefer stored payment_transactions.tax_amount (invoice/booking details source of truth).
 * Never tax a chef-charge figure that already includes tax + platform fee.
 */
export function resolveKitchenTransactionTaxAndSubtotal(input: {
  isDamageClaim: boolean;
  ptAmount: number;
  ptBaseAmount: number;
  ptTaxAmount: number;
  approvedTaxCents: number;
  kbTotalPrice: number;
  taxRatePercent: number;
  ptServiceFee?: number;
  metadata?: Record<string, unknown> | null;
}): { taxCents: number; totalPriceCents: number; serviceFeeCents: number } {
  const {
    isDamageClaim,
    ptAmount,
    ptBaseAmount,
    ptTaxAmount,
    approvedTaxCents,
    kbTotalPrice,
    taxRatePercent,
  } = input;

  if (isDamageClaim) {
    return { taxCents: 0, totalPriceCents: ptAmount, serviceFeeCents: 0 };
  }

  const metadata = input.metadata || {};
  if (ptAmount > 0) {
    const metadataRate = Number(metadata.taxRatePercent ?? metadata.tax_rate_percent);
    const effectiveTaxRate = Number.isFinite(metadataRate) ? metadataRate : taxRatePercent;
    const split = computeManagerGrossAndCommission({
      chargeAmountCents: ptAmount,
      platformCommissionRate: kbTotalPrice > 0
        ? Math.max(0, Number(input.ptServiceFee || 0)) / kbTotalPrice
        : 0,
      approvedSubtotalCents: Number(metadata.approvedSubtotal) || undefined,
      approvedTaxCents: Number(metadata.approvedTax) || undefined,
      platformCommissionCents: Number(metadata.platformCommission ?? metadata.applicationFee) || undefined,
      capturedAmountCents: Number(metadata.capturedAmount) || undefined,
      originalAuthorizedAmountCents: Number(metadata.originalAuthorizedAmount) || undefined,
      storedBaseAmountCents: ptBaseAmount,
      storedServiceFeeCents: input.ptServiceFee,
    });
    const managerGross = split.managerGrossCents;
    const bookingTax = managerGross > kbTotalPrice && kbTotalPrice > 0
      ? managerGross - kbTotalPrice
      : -1;
    const bookingTaxMatchesRate = bookingTax >= 0 && (
      effectiveTaxRate <= 0
        ? bookingTax === 0
        : Math.abs(bookingTax - Math.round(kbTotalPrice * effectiveTaxRate / 100)) <= 1
    );
    const storedTaxFitsGross = ptTaxAmount > 0 && ptTaxAmount < managerGross;
    const reconciledTax = storedTaxFitsGross
      ? ptTaxAmount
      : bookingTaxMatchesRate
        ? bookingTax
        : effectiveTaxRate > 0
          ? Math.round(managerGross * effectiveTaxRate / (100 + effectiveTaxRate))
          : 0;

    return {
      taxCents: reconciledTax,
      totalPriceCents: Math.max(0, managerGross - reconciledTax),
      serviceFeeCents: split.platformCommissionCents,
    };
  }

  let taxCents: number;
  if (ptTaxAmount > 0) {
    taxCents = ptTaxAmount;
  } else if (approvedTaxCents > 0) {
    taxCents = approvedTaxCents;
  } else if (ptBaseAmount > 0 && taxRatePercent > 0) {
    taxCents = Math.round((ptBaseAmount * taxRatePercent) / (100 + taxRatePercent));
  } else {
    taxCents = taxRatePercent > 0 ? Math.round((kbTotalPrice * taxRatePercent) / 100) : 0;
  }

  let totalPriceCents: number;
  if (taxCents > 0 && ptBaseAmount > taxCents) {
    totalPriceCents = ptBaseAmount - taxCents;
  } else if (kbTotalPrice > 0 && kbTotalPrice !== ptAmount) {
    totalPriceCents = kbTotalPrice;
  } else if (ptBaseAmount > 0 && taxRatePercent > 0) {
    totalPriceCents = Math.round(ptBaseAmount / (1 + taxRatePercent / 100));
  } else {
    totalPriceCents = kbTotalPrice > 0 ? kbTotalPrice : ptAmount;
  }

  return { taxCents, totalPriceCents, serviceFeeCents: Math.max(0, Number(input.ptServiceFee) || 0) };
}
