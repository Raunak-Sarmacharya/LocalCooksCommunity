/**
 * The Location page (sidebar "Location"): one place for location-level settings, in the My Kitchens section-tab
 * layout. Older views and links (Kitchen License, Facility documents, the hidden Settings page, Profile › Location)
 * open the matching section here.
 */
export type LocationSection = "details" | "license" | "booking" | "documents" | "payments";
export const LOCATION_SECTIONS: LocationSection[] = ["details", "license", "booking", "documents", "payments"];

export const isLocationSection = (value: string | null | undefined): value is LocationSection =>
  !!value && (LOCATION_SECTIONS as string[]).includes(value);

/** The Location section an older view/tab means, or null when it isn't a location setting. */
export function legacyLocationSection(view: string | null | undefined, tab?: string | null): LocationSection | null {
  if (view === "settings-license") return "license";
  if (view === "settings-facility-docs") return "documents";
  if (view === "settings-location" || view === "my-locations") return "details";
  if (view === "profile" && tab === "location") return "details";
  // The old Settings page's tabs; its "Requirements" tab is the Requests › Application requirements page.
  if (view === "settings") return tab === "booking" ? "booking" : tab === "documents" ? "documents" : tab === "requirements" ? null : "details";
  return null;
}
