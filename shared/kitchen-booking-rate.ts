export type KitchenBookingRateMode = "hourly" | "daily";

/**
 * Whether a value is a rate a chef could actually be charged.
 *
 * `> 0`, not "something was typed": the listing gate reads the rates through this same test, so a
 * kitchen saved at 0.00 has no rate as far as publishing and checkout are concerned. A form that
 * let a typed zero through would put the record back out of step with the gate that judges it.
 *
 * Deliberately unit-agnostic. The server hands in CENTS read off a DB row and the forms hand in
 * DOLLARS read out of a text field, and "is this a positive number" is the same question in both —
 * which is exactly why the rule belongs in one place rather than once per unit.
 */
export function isPositiveRate(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * Whether a kitchen offers a rate at all — the ONE rule behind the listing gate's "Hourly or daily
 * rate" requirement and every form that creates or edits a kitchen.
 *
 * Either rate on its own is a complete answer. `booking.service` refuses a booking in a mode the
 * kitchen does not offer, so a daily-only kitchen is fully bookable and the hourly is not a
 * prerequisite for it; the manager who charges by the day was previously locked out of every form
 * that demanded the hourly specifically.
 */
export function hasKitchenRate(hourlyRate: unknown, dailyRate: unknown): boolean {
  return isPositiveRate(hourlyRate) || isPositiveRate(dailyRate);
}

/**
 * Positive integer cents, or null. Used for the kitchen's extra-time rate field and the booking snapshot.
 */
export function positiveCentsOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Rate charged for extra time at a kitchen (1x, no multiplier).
 * Hourly kitchens use their hourly rate; daily-only kitchens use `extraTimeRateCents`.
 */
export function kitchenExtraTimeRateCents(kitchen: {
  hourlyRate?: unknown;
  extraTimeRateCents?: unknown;
}): number | null {
  return positiveCentsOrNull(kitchen.hourlyRate) ?? positiveCentsOrNull(kitchen.extraTimeRateCents);
}

/**
 * Snapshot saved on the booking at creation. Same rule as `kitchenExtraTimeRateCents`.
 * Later kitchen price edits must never change an existing booking's value.
 */
export function snapshotExtraTimeRateCents(kitchen: {
  hourlyRate?: unknown;
  extraTimeRateCents?: unknown;
}): number | null {
  return kitchenExtraTimeRateCents(kitchen);
}

/**
 * Whether a daily-only kitchen must supply an extra time rate (no positive hourly rate).
 */
export function requiresExtraTimeRate(hourlyRate: unknown, dailyRate: unknown): boolean {
  return !isPositiveRate(hourlyRate) && isPositiveRate(dailyRate);
}

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
  pricingMode?: KitchenBookingRateMode;
};

/** Resolve legacy bookings where `hourly_rate` stores an hourly or daily rate. */
export function resolveCapturedKitchenRate({
  appliedRateCents,
  durationHours,
  bookingSubtotalCents,
  addonSubtotalCents = 0,
  pricingMode,
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
  const mode: KitchenBookingRateMode = pricingMode || (
    hours > 1 &&
    Math.abs(capturedKitchenSubtotal - rate) < Math.abs(capturedKitchenSubtotal - hourlySubtotal)
      ? "daily"
      : "hourly"
  );

  return {
    mode,
    kitchenSubtotalCents:
      mode === "daily"
        ? rate
        : capturedKitchenSubtotal > 0
        ? capturedKitchenSubtotal
        : hourlySubtotal,
  };
}
