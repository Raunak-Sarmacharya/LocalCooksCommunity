/**
 * The Location page (sidebar "Location"): one place for location-level settings, in the My Kitchens section-tab
 * layout. Older views and links (Kitchen License, Facility documents, the hidden Settings page, Profile › Location)
 * open the matching section here.
 */
// Payments moved to Revenue › Payouts (owner, Oct 24): one Stripe account per manager, so one home for it.
// Booking requirements moved in from Access requests (owner, Oct 24): a location-wide setting needed before listing.
export type LocationSection = "details" | "license" | "booking" | "requirements" | "documents";
export const LOCATION_SECTIONS: LocationSection[] = ["details", "license", "booking", "requirements", "documents"];

export const isLocationSection = (value: string | null | undefined): value is LocationSection =>
  !!value && (LOCATION_SECTIONS as string[]).includes(value);

/** The Location section an older view/tab means, or null when it isn't a location setting. */
export function legacyLocationSection(view: string | null | undefined, tab?: string | null): LocationSection | null {
  if (view === "settings-license") return "license";
  if (view === "settings-facility-docs") return "documents";
  if (view === "settings-location" || view === "my-locations") return "details";
  if (view === "profile" && tab === "location") return "details";
  if (view === "application-requirements") return "requirements";
  // The old Settings page's tabs.
  if (view === "settings") return tab === "booking" ? "booking" : tab === "documents" ? "documents" : tab === "requirements" ? "requirements" : "details";
  return null;
}
