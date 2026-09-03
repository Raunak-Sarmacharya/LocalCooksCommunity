/** Resolve which kitchen(s) a location tour can target from the discover list. */

export type TourKitchenOption = { id: number; name: string };

type KitchenLike = {
  id: number;
  name: string;
  locationId: number;
};

/** Kitchens at a location that can be offered as a tour target. */
export function kitchensForTourAtLocation(
  kitchens: KitchenLike[],
  locationId: number
): TourKitchenOption[] {
  return kitchens
    .filter((k) => k.locationId === locationId)
    .map((k) => ({ id: k.id, name: k.name }));
}

/**
 * Ask which kitchen to tour only when the location tour schedule is on
 * and 2+ kitchens share that location. One kitchen (or no schedule) → no picker.
 */
export function shouldPromptTourKitchenSelect(
  options: TourKitchenOption[],
  locationTourScheduleActive: boolean
): boolean {
  return locationTourScheduleActive && options.length > 1;
}

export function resolveTourKitchenTarget(
  options: TourKitchenOption[],
  locationTourScheduleActive: boolean
):
  | { mode: "auto"; kitchen: TourKitchenOption | null }
  | { mode: "select"; kitchens: TourKitchenOption[] } {
  if (shouldPromptTourKitchenSelect(options, locationTourScheduleActive)) {
    return { mode: "select", kitchens: options };
  }
  return { mode: "auto", kitchen: options.length === 1 ? options[0] : null };
}
