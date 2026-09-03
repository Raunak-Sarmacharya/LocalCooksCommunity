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
}): { taxCents: number; totalPriceCents: number } {
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
    return { taxCents: 0, totalPriceCents: ptAmount };
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

  return { taxCents, totalPriceCents };
}
