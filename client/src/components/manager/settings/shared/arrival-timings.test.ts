import { describe, expect, it } from "vitest";

import { arrivalTimingsLocked } from "./ChecklistEditor";

/**
 * The arrival timings are shown on two pages (check-in/check-out and Booking
 * Policies) off the same query. If this predicate drifts, one page will let a
 * manager type into fields the other page locks — which is exactly the
 * inconsistency this guard exists to prevent.
 */
describe("arrivalTimingsLocked", () => {
  it("locks while check-in is off, because nothing consults them then", () => {
    expect(arrivalTimingsLocked({ checkinEnabled: false, checkoutEnabled: false })).toBe(true);
  });

  it("locks when only check-out is on", () => {
    // The check-in window gates the check-in button and the grace period feeds
    // the no-show sweeper. Check-out reads neither, so with check-in off these
    // fields do nothing — leaving them editable is the bug, not the feature.
    expect(arrivalTimingsLocked({ checkinEnabled: false, checkoutEnabled: true })).toBe(true);
  });

  it("unlocks when check-in is on, with or without check-out", () => {
    expect(arrivalTimingsLocked({ checkinEnabled: true, checkoutEnabled: false })).toBe(false);
    expect(arrivalTimingsLocked({ checkinEnabled: true, checkoutEnabled: true })).toBe(false);
  });

  it("does not lock before the settings have loaded", () => {
    // Locking on unknown state would flash a disabled field for a moment on
    // every page load.
    expect(arrivalTimingsLocked(undefined)).toBe(false);
    expect(arrivalTimingsLocked({})).toBe(false);
  });
});
