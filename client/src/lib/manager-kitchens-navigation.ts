import type { QueryClient } from "@tanstack/react-query";

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

/**
 * Views the kitchens page — and the listing-review flow it hosts — can send a manager to.
 *
 * A subset of the shell's own `ViewType`. It lives in this module rather than beside one of the
 * components because three of them share it: `KitchensManagement` (the owner), the listing-status
 * banner and the publish-review page. Typing the two leaf components with this union instead of
 * `string` is what turns a misspelled destination into a compile error, and it satisfies the
 * shell's wider `ViewType` handler contravariantly.
 */
export type KitchensNavigationTarget =
  | "availability"
  | "settings-license"
  | "payments"
  | "application-requirements"
  | "tour-availability"
  | "settings-booking-rules"
  // The listing-status card sends the manager to the publish review, which is a view of its own.
  | "listing-review"
  // Rows on the review page that are edited on this tab point back here.
  | "kitchens"
  | "my-locations";

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

/**
 * What a navigation request actually opens.
 *
 * A destination can name a Kitchens TAB two ways, and both have to end up as the one shape
 * `KitchensManagement` reads — `?view=kitchens&section=<section>`:
 *
 *   - an explicit `section`, which is what the publish review passes, because a row there is talking
 *     about a tab OF A KITCHEN;
 *   - a legacy view alias (`pricing`, `equipment-listings`, `storage-listings`), which old URLs and
 *     the command menu still use.
 *
 * A request that names only `"kitchens"` resolves to NO section — it opens whatever tab the URL
 * already happened to hold. That is exactly how the review page's Equipment, Storage, gallery and
 * cover-photo rows shipped pointing at the wrong tab, so this function exists as one definition
 * shared by the shell and its harness rather than as an inline expression the test would have to
 * copy.
 */
export function resolveDestination(
  view: string,
  section?: KitchenSection,
): { view: string; section: KitchenSection | null } {
  return { view, section: section ?? legacyKitchenSection(view) };
}

/**
 * The readiness query key, WITH the kitchen it is about.
 *
 * Exported because two components read this checklist from different places — the status banner, which
 * sits above the tabs on the Kitchens view, and the full-page publish review — and a fix that stales
 * one without the other is the bug this key exists to prevent.
 */
export const kitchenListingReadinessKey = (kitchenId: number) =>
  ["kitchen-listing-readiness", kitchenId] as const;

/**
 * Refresh every cache that reflects a kitchen's publish state.
 *
 * One function rather than four `invalidateQueries` calls at each mutation site, because the CALLERS
 * are what went wrong: the checklist queries are keyed by kitchen while the kitchen list is keyed by
 * location, and the two live in different components. A task page that invalidated only the list it
 * happened to be editing left the readiness banner showing the previous answer — and because the app
 * defaults to `staleTime: Infinity` and no focus refetch (see `lib/queryClient.ts`), it never
 * corrected itself. That is why completing a Review & list item appeared to need a manual refresh.
 *
 * The banner stays mounted on the Kitchens view, so invalidating from there reaches the review page too:
 * a query with no cached data fetches on mount whatever its `staleTime`.
 *
 * Call this AFTER the write lands, never before — an invalidation that races the request just re-reads
 * the old row.
 */
export function invalidateKitchenListingState(
  queryClient: QueryClient,
  kitchenId: number,
  locationId?: number,
): void {
  void queryClient.invalidateQueries({ queryKey: kitchenListingReadinessKey(kitchenId) });
  if (locationId != null) {
    void queryClient.invalidateQueries({ queryKey: ["managerKitchens", locationId] });
  }
  // The kitchen pickers and lists that are built from these two.
  void queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
}
