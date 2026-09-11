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
