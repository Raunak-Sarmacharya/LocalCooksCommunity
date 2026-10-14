export const kitchenChecklistSections = {
  arrivalInstructions: ['checkinInstructions'],
  departureInstructions: ['checkoutInstructions'],
  arrivalTasks: ['checkinItems', 'checkinPhotoRequirements'],
  departureTasks: ['checkoutItems', 'checkoutPhotoRequirements'],
} as const;
export type KitchenChecklistSection = keyof typeof kitchenChecklistSections;
export const kitchenChecklistFields = Object.values(kitchenChecklistSections).flat();
export type KitchenChecklistOverride = Partial<Record<typeof kitchenChecklistFields[number], unknown>>;

/** NULL inherits independently; empty text/arrays deliberately remove a default. */
export function resolveKitchenChecklist<T extends Record<string, unknown>>(kitchenRow: KitchenChecklistOverride | null | undefined,
  locationRow: T | null | undefined): T | null {
  if (!kitchenRow) return locationRow ?? null;
  if (!locationRow && !kitchenChecklistFields.some(field => kitchenRow[field] != null)) return null;
  const result = { ...locationRow } as T;
  for (const field of kitchenChecklistFields) {
    if (kitchenRow[field] != null) Object.assign(result, { [field]: kitchenRow[field] });
  }
  return result;
}
