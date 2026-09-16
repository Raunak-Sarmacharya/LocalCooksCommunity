export type KitchenSection =
  | "photos"
  | "details"
  | "equipment"
  | "storage";

export type ManagerBreadcrumb = {
  label: string;
  onClick?: () => void;
  navId?: string;
};

/** Default section when the URL names none — must match the first tab in KitchensManagement. */
export const DEFAULT_KITCHEN_SECTION: KitchenSection = "details";

export function kitchenSectionFromParams(params: URLSearchParams): KitchenSection {
  const section = params.get("section");
  const view = params.get("view");
  if (section === "photos") return "photos";
  if (section === "pricing" || view === "pricing") return "details";
  if (section === "equipment" || view === "equipment-listings") return "equipment";
  if (section === "storage" || view === "storage-listings") return "storage";
  return DEFAULT_KITCHEN_SECTION;
}

export function legacyKitchenSection(view: string | null): KitchenSection | null {
  if (view === "pricing") return "details";
  if (view === "equipment-listings") return "equipment";
  if (view === "storage-listings") return "storage";
  return null;
}
