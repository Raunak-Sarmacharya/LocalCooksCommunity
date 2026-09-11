/**
 * Chef-facing kitchen booking price estimate (cents).
 * Matches checkout: tax on subtotal; platform commission on subtotal only (not tax).
 */
export type BookingPriceEstimateInput = {
  hourlyRateCents: number;
  hours: number;
  minimumBookingHours?: number;
  taxRatePercent?: number | null;
  /** Fraction, e.g. 0.07 for 7%. */
  platformCommissionRate?: number | null;
};

export type BookingPriceEstimate = {
  durationHours: number;
  basePriceCents: number;
  taxCents: number;
  serviceFeeCents: number;
  taxesAndFeesCents: number;
  totalCents: number;
  taxRatePercent: number;
  platformCommissionRate: number;
};

/**
 * Rate used to LABEL a booking's service fee, e.g. "service fee (7%)".
 *
 * Always prefer the admin-configured rate. Dividing the stored fee by the
 * displayed subtotal rounds to the wrong percentage whenever an add-on was
 * voided after checkout, because the fee was charged on the original subtotal.
 */
export function resolveServiceFeeDisplayRate(input: {
  adminRate?: number | null;
  serviceFeeCents?: number | null;
  subtotalCents?: number | null;
}): number {
  const adminRate = Number(input.adminRate);
  if (Number.isFinite(adminRate) && adminRate > 0) return adminRate;

  const serviceFeeCents = Math.max(0, Number(input.serviceFeeCents) || 0);
  const subtotalCents = Math.max(0, Number(input.subtotalCents) || 0);
  if (serviceFeeCents > 0 && subtotalCents > 0) return serviceFeeCents / subtotalCents;
  return 0;
}

/** Tax + platform commission on a booking subtotal (kitchen + add-ons). Matches checkout. */
export function estimateBookingCheckoutTotal(input: {
  subtotalCents: number;
  taxRatePercent?: number | null;
  platformCommissionRate?: number | null;
}): {
  subtotalCents: number;
  taxCents: number;
  serviceFeeCents: number;
  taxesAndFeesCents: number;
  totalCents: number;
  taxRatePercent: number;
  platformCommissionRate: number;
} {
  const taxRatePercent = Math.max(0, Number(input.taxRatePercent) || 0);
  const platformCommissionRate = Math.max(0, Number(input.platformCommissionRate) || 0);
  const subtotalCents = Math.max(0, Number(input.subtotalCents) || 0);
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
  const serviceFeeCents = Math.round(subtotalCents * platformCommissionRate);
  return {
    subtotalCents,
    taxCents,
    serviceFeeCents,
    taxesAndFeesCents: taxCents + serviceFeeCents,
    totalCents: subtotalCents + taxCents + serviceFeeCents,
    taxRatePercent,
    platformCommissionRate,
  };
}

export function estimateKitchenBookingPrice(
  input: BookingPriceEstimateInput
): BookingPriceEstimate {
  const taxRatePercent = Math.max(0, Number(input.taxRatePercent) || 0);
  const platformCommissionRate = Math.max(0, Number(input.platformCommissionRate) || 0);
  const durationHours = Math.max(
    Math.max(0, Number(input.hours) || 0),
    Math.max(0, Number(input.minimumBookingHours) || 0)
  );
  const hourly = Math.max(0, Number(input.hourlyRateCents) || 0);
  const basePriceCents = Math.round(hourly * durationHours);
  const taxCents = Math.round((basePriceCents * taxRatePercent) / 100);
  const serviceFeeCents = Math.round(basePriceCents * platformCommissionRate);
  return {
    durationHours,
    basePriceCents,
    taxCents,
    serviceFeeCents,
    taxesAndFeesCents: taxCents + serviceFeeCents,
    totalCents: basePriceCents + taxCents + serviceFeeCents,
    taxRatePercent,
    platformCommissionRate,
  };
}
