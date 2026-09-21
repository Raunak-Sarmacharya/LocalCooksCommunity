import { describe, expect, it } from "vitest";

import { resumeBlockedBy, type ResumeGateInput } from "./resume-gate";

/** Everything the gate reads, all present. Each case below removes one thing. */
const READY: ResumeGateInput = {
  isLoadingLocations: false,
  isAddingLocation: false,
  locationCount: 1,
  selectedLocationId: 7,
  kitchensLoaded: true,
  requirementsLoaded: true,
  availabilityLoaded: true,
  kitchenCount: 1,
};

describe("resumeBlockedBy", () => {
  /**
   * THE assertion for the bug this module exists for.
   *
   * A first-time manager has no location AND nothing downstream of one has loaded — every flag here
   * is in its "not loaded" state, because none of those fetches even run without a location. The
   * gate must still allow the decision, because `location` is the first required step and the wizard
   * has to be able to advance off a COMPLETED `welcome` step. Blocking this is what parked a new
   * manager on the welcome screen after they had already dismissed the standalone welcome screen.
   */
  it("may decide when a brand-new manager has no location at all", () => {
    expect(
      resumeBlockedBy({
        isLoadingLocations: false,
        isAddingLocation: false,
        locationCount: 0,
        selectedLocationId: null,
        kitchensLoaded: false,
        requirementsLoaded: false,
        availabilityLoaded: false,
        kitchenCount: 0,
      }),
    ).toBeNull();
  });

  it("waits while the locations are still loading", () => {
    expect(resumeBlockedBy({ ...READY, isLoadingLocations: true })).toMatch(/loading/);
  });

  it("waits while a new location is being added", () => {
    expect(resumeBlockedBy({ ...READY, isAddingLocation: true })).toMatch(/adding/);
  });

  it("waits until a location is selected", () => {
    expect(resumeBlockedBy({ ...READY, selectedLocationId: null })).toMatch(/selected/);
  });

  it("waits for the kitchens", () => {
    expect(resumeBlockedBy({ ...READY, kitchensLoaded: false })).toMatch(/kitchens/);
  });

  it("waits for the requirements", () => {
    expect(resumeBlockedBy({ ...READY, requirementsLoaded: false })).toMatch(/requirements/);
  });

  it("waits for availability only when there is a kitchen to check", () => {
    expect(resumeBlockedBy({ ...READY, availabilityLoaded: false })).toMatch(/availability/);
    // No kitchens means availability is not checkable, and `hasAvailability` is correctly false.
    expect(
      resumeBlockedBy({ ...READY, availabilityLoaded: false, kitchenCount: 0 }),
    ).toBeNull();
  });

  it("may decide once everything it reads is here", () => {
    expect(resumeBlockedBy(READY)).toBeNull();
  });
});
