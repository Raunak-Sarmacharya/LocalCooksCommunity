/**
 * Pure manager payout math — no DB / Stripe imports.
 *
 * Chef pays: subtotal + tax + serviceFee(on subtotal only)
 * Platform keeps: serviceFee
 * Manager keeps: tax; pays Stripe fee
 * Manager net: (subtotal + tax) − stripeFee
 */

export function computeManagerGrossAndCommission(input: {
  chargeAmountCents: number;
  platformCommissionRate: number;
  approvedSubtotalCents?: number;
  approvedTaxCents?: number;
  platformCommissionCents?: number;
  storedBaseAmountCents?: number;
  storedServiceFeeCents?: number;
}): { managerGrossCents: number; platformCommissionCents: number } {
  const charge = Math.max(0, input.chargeAmountCents);
  const approvedSubtotal = Math.max(0, Number(input.approvedSubtotalCents) || 0);
  const approvedTax = Math.max(0, Number(input.approvedTaxCents) || 0);
  const metaCommission = Math.max(0, Number(input.platformCommissionCents) || 0);
  const metaGross = approvedSubtotal + approvedTax;

  if (metaGross > 0 && metaCommission > 0 && Math.abs(metaGross + metaCommission - charge) <= 1) {
    return { managerGrossCents: metaGross, platformCommissionCents: metaCommission };
  }

  const storedBase = Math.max(0, Number(input.storedBaseAmountCents) || 0);
  const storedFee = Math.max(0, Number(input.storedServiceFeeCents) || 0);
  // base_amount is the kitchen-owned subtotal + tax. When an old/stale
  // service_fee disagrees with the actual Stripe charge, preserve kitchen gross
  // and reconcile commission as the remainder. Reverse-calculating the entire
  // charge at today's rate incorrectly consumes part of the kitchen's tax.
  if (storedBase > 0 && storedBase <= charge) {
    return {
      managerGrossCents: storedBase,
      platformCommissionCents: Math.max(0, charge - storedBase),
    };
  }

  // Fallback: use the stored service_fee directly if available.
  // Do NOT reverse-engineer via charge/(1+rate) — that formula assumes
  // charge = subtotal*(1+rate), but the actual charge is subtotal + tax + subtotal*rate,
  // so the division incorrectly absorbs tax into the commission.
  if (storedFee > 0 && storedFee < charge) {
    return {
      managerGrossCents: Math.max(0, charge - storedFee),
      platformCommissionCents: storedFee,
    };
  }

  const rate = Math.max(0, Number(input.platformCommissionRate) || 0);
  if (rate > 0 && charge > 0) {
    // Last resort: apply rate directly to charge. This overstates the commission
    // when the charge includes tax, but is better than the old charge/(1+rate)
    // which silently ate tax. This path should rarely be reached.
    // ponytail: upgrade by persisting subtotal in PT metadata at all creation sites.
    const commissionCents = Math.round(charge * rate / (1 + rate));
    return {
      managerGrossCents: Math.max(0, charge - commissionCents),
      platformCommissionCents: commissionCents,
    };
  }

  return { managerGrossCents: charge, platformCommissionCents: 0 };
}
