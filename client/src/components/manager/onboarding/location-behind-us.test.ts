import { describe, expect, it } from "vitest";
import { isLocationStepBehindUs } from "./step-completion";

/**
 * The contract this file holds: "is the Business & licence step behind us?" has ONE answer.
 *
 * It had two, and the second one was wrong. The durable-record fallback was guarded by
 * `dbCompletedSteps['location']` ALONE, so it fired for a manager who genuinely has NO location —
 * any stale `location` key in `managerOnboardingStepsCompleted` made the step read complete for
 * ever. The wizard's resume then skipped past Business straight to `create-kitchen`, so a host who
 * had never typed a business detail was shown the kitchen-listing step with Business ticked behind
 * them. Reported 2026-09-28.
 *
 * The fix is `isLoadingLocations`: the flag may stand in only while the list is still loading, which
 * is the race its own comment always claimed to be about. Once loaded, an empty list IS the answer.
 */
const base = {
  isLoadingLocations: false,
  selectedLocationId: 14 as number | null,
  locations: [] as Array<{ id: number; kitchenLicenseUrl?: string | null }>,
  dbCompletedSteps: {} as Record<string, boolean>,
  isAddingLocation: false,
};

describe("isLocationStepBehindUs", () => {
  it("is false for a manager who has nothing and has been nowhere", () => {
    expect(isLocationStepBehindUs({ ...base, selectedLocationId: null })).toBe(false);
  });

  it("is false when a STALE durable flag exists and the locations have loaded", () => {
    // THE REGRESSION. The list is loaded and empty, so there is no location — the step cannot be
    // behind a manager who never entered one, whatever the durable record claims.
    expect(
      isLocationStepBehindUs({
        ...base,
        isLoadingLocations: false,
        locations: [],
        dbCompletedSteps: { location: true },
      }),
    ).toBe(false);
  });

  it("trusts the durable flag only WHILE the list is still loading", () => {
    // The race the fallback exists for: the flag is known before the locations arrive, and reading
    // it here is what stops the step flickering to "incomplete" mid-load.
    expect(
      isLocationStepBehindUs({
        ...base,
        isLoadingLocations: true,
        selectedLocationId: null,
        dbCompletedSteps: { location: true },
      }),
    ).toBe(true);
  });

  it("does not trust the flag while loading if it was never set", () => {
    expect(
      isLocationStepBehindUs({
        ...base,
        isLoadingLocations: true,
        selectedLocationId: null,
        dbCompletedSteps: {},
      }),
    ).toBe(false);
  });

  it("is true when the selected location carries a licence", () => {
    expect(
      isLocationStepBehindUs({
        ...base,
        locations: [{ id: 14, kitchenLicenseUrl: "https://example.test/licence.pdf" }],
      }),
    ).toBe(true);
  });

  it("reads the snake_case licence column too", () => {
    // The DTO and the raw row disagree on casing, and both reach this function.
    expect(
      isLocationStepBehindUs({
        ...base,
        locations: [{ id: 14, kitchen_license_url: "https://example.test/licence.pdf" }],
      }),
    ).toBe(true);
  });

  it("is false when the selected location has no licence and no flag", () => {
    expect(isLocationStepBehindUs({ ...base, locations: [{ id: 14 }] })).toBe(false);
  });

  it("accepts the durable flag for a location that EXISTS — the save race", () => {
    expect(
      isLocationStepBehindUs({
        ...base,
        locations: [{ id: 14 }],
        dbCompletedSteps: { location: true },
      }),
    ).toBe(true);
  });

  it("ignores a location that is not the SELECTED one", () => {
    // A licence on a sibling location says nothing about the one being worked on.
    expect(
      isLocationStepBehindUs({
        ...base,
        selectedLocationId: 99,
        locations: [{ id: 14, kitchenLicenseUrl: "https://example.test/licence.pdf" }],
      }),
    ).toBe(false);
  });

  it("ignores OTHER steps' durable records", () => {
    expect(
      isLocationStepBehindUs({
        ...base,
        isLoadingLocations: true,
        selectedLocationId: null,
        dbCompletedSteps: { "create-kitchen": true, "payment-setup": true },
      }),
    ).toBe(false);
  });

  it("does not let a PREVIOUS location's completion count for a new one", () => {
    // [MULTI-LOCATION] While adding a location the flag is excluded entirely, even mid-load.
    expect(
      isLocationStepBehindUs({
        ...base,
        isLoadingLocations: true,
        selectedLocationId: null,
        dbCompletedSteps: { location: true },
        isAddingLocation: true,
      }),
    ).toBe(false);
  });

  it("does not treat an explicitly-false durable record as done", () => {
    expect(
      isLocationStepBehindUs({
        ...base,
        isLoadingLocations: true,
        selectedLocationId: null,
        dbCompletedSteps: { location: false },
      }),
    ).toBe(false);
  });
});
