export type KitchenBookingRateMode = "hourly" | "daily";

export function calculateKitchenBasePrice(
  mode: KitchenBookingRateMode,
  hourlyRateCents: number,
  dailyRateCents: number,
  durationHours: number,
): number {
  return mode === "daily"
    ? Math.round(dailyRateCents)
    : Math.round(hourlyRateCents * durationHours);
}

type CapturedKitchenRateInput = {
  appliedRateCents: number;
  durationHours: number;
  bookingSubtotalCents: number;
  addonSubtotalCents?: number;
};

/** Resolve legacy bookings where `hourly_rate` stores an hourly or daily rate. */
export function resolveCapturedKitchenRate({
  appliedRateCents,
  durationHours,
  bookingSubtotalCents,
  addonSubtotalCents = 0,
}: CapturedKitchenRateInput): {
  mode: KitchenBookingRateMode;
  kitchenSubtotalCents: number;
} {
  const rate = Math.max(0, Math.round(Number(appliedRateCents) || 0));
  const hours = Math.max(0, Number(durationHours) || 0);
  const capturedKitchenSubtotal = Math.max(
    0,
    Math.round((Number(bookingSubtotalCents) || 0) - (Number(addonSubtotalCents) || 0)),
  );

  if (rate <= 0) {
    return { mode: "hourly", kitchenSubtotalCents: capturedKitchenSubtotal };
  }

  const hourlySubtotal = Math.round(rate * hours);
  const mode: KitchenBookingRateMode =
    hours > 1 &&
    Math.abs(capturedKitchenSubtotal - rate) < Math.abs(capturedKitchenSubtotal - hourlySubtotal)
      ? "daily"
      : "hourly";

  return {
    mode,
    kitchenSubtotalCents:
      capturedKitchenSubtotal > 0
        ? capturedKitchenSubtotal
        : mode === "daily"
          ? rate
          : hourlySubtotal,
  };
}
