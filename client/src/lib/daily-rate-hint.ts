/**
 * What to tell a manager about their daily rate, given their hourly rate.
 *
 * The figure the industry publishes is the break-even — `Daily ÷ Hourly = Break-Even Hours` — so
 * that is what a manager can weigh against their own idea of a working day.
 *
 * There is a second case worth naming. A chef cannot book more than `dailyBookingLimit` hours
 * hourly, so if the day rate falls BELOW the cost of those hours, the day stops being a discount
 * and starts undercutting hourly: a chef who wants the ceiling takes the whole day for less money.
 *
 * Returns a description, not a string — the caller owns the wording and the locale.
 */
export type DailyRateHint =
  | { kind: "none" }
  | { kind: "break-even"; breakEvenHours: number }
  | {
      kind: "below-hourly-ceiling";
      breakEvenHours: number;
      /** The hourly booking ceiling, in hours. */
      ceilingHours: number;
      /** What that ceiling costs at the hourly rate, in cents. */
      ceilingCostCents: number;
    };

/** Parse a money input that may be empty, blank, or garbage. Returns 0 for all of those. */
function parseRate(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function describeDailyRate(input: {
  hourlyRate: string;
  dailyRate: string;
  dailyBookingLimit?: number | null;
}): DailyRateHint {
  const hourly = parseRate(input.hourlyRate);
  const daily = parseRate(input.dailyRate);

  // Without both rates there is no comparison to make — including the half-typed states a
  // manager passes through while editing, which must not flash a hint.
  if (hourly <= 0 || daily <= 0) return { kind: "none" };

  const breakEvenHours = daily / hourly;
  const ceilingHours =
    input.dailyBookingLimit && input.dailyBookingLimit > 0 ? input.dailyBookingLimit : null;

  if (ceilingHours !== null && daily < ceilingHours * hourly) {
    return {
      kind: "below-hourly-ceiling",
      breakEvenHours,
      ceilingHours,
      ceilingCostCents: Math.round(ceilingHours * hourly * 100),
    };
  }

  return { kind: "break-even", breakEvenHours };
}

/** Break-even hours as a label: whole numbers stay whole, fractions keep one decimal. */
export function formatBreakEvenHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}
