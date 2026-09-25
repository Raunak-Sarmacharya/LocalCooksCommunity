/** Stable across the verification redirect's transient query parameters and tabs. */
export function kitchenJourneyEmailKey(pathname: string, search: string): string {
  const kitchenId = new URLSearchParams(search).get("kitchenId");
  return `kitchen_journey_email_${pathname}${kitchenId ? `?kitchenId=${encodeURIComponent(kitchenId)}` : ""}`;
}
