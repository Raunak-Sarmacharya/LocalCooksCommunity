import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KITCHEN_SECTION,
  invalidateKitchenListingState,
  kitchenListingReadinessKey,
  kitchenSectionFromParams,
  legacyKitchenSection,
} from "./manager-kitchens-navigation";

describe("manager Kitchens navigation", () => {
  it("keeps legacy inventory URLs on the matching Kitchens tab", () => {
    expect(kitchenSectionFromParams(new URLSearchParams("view=equipment-listings"))).toBe("equipment");
    expect(kitchenSectionFromParams(new URLSearchParams("view=storage-listings"))).toBe("storage");
    expect(legacyKitchenSection("equipment-listings")).toBe("equipment");
    expect(legacyKitchenSection("storage-listings")).toBe("storage");
    expect(legacyKitchenSection("pricing")).toBe("details");
    expect(kitchenSectionFromParams(new URLSearchParams("view=kitchens&section=photos"))).toBe("photos");
    expect(kitchenSectionFromParams(new URLSearchParams("view=kitchens"))).toBe(DEFAULT_KITCHEN_SECTION);
    expect(DEFAULT_KITCHEN_SECTION).toBe("details");
  });
});

/**
 * The refresh that completing a Review & list item depends on.
 *
 * The bug this guards: the checklist is keyed by KITCHEN while the kitchen lists are keyed by LOCATION,
 * and they live in different components — so a task page that refreshed only what it was editing left
 * the status banner reporting the previous answer, with no focus refetch to rescue it.
 */
describe("invalidateKitchenListingState", () => {
  const fakeClient = () => ({ invalidateQueries: vi.fn() });

  it("refreshes the kitchen's checklist, which is keyed by kitchen", () => {
    const client = fakeClient();
    invalidateKitchenListingState(client as never, 42, 7);

    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: kitchenListingReadinessKey(42),
    });
  });

  it("refreshes the location's kitchen list and the pickers built from it", () => {
    const client = fakeClient();
    invalidateKitchenListingState(client as never, 42, 7);

    const keys = client.invalidateQueries.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(["managerKitchens", 7]));
    expect(keys).toContain(JSON.stringify(["/api/manager/all-kitchens"]));
    expect(keys).toContain(JSON.stringify(["/api/manager/locations"]));
  });

  it("still refreshes the checklist when the location is unknown", () => {
    const client = fakeClient();
    invalidateKitchenListingState(client as never, 42);

    const keys = client.invalidateQueries.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(kitchenListingReadinessKey(42)));
    // Not merely absent by accident — a location-scoped key must not be invented from a missing id.
    expect(keys.some((key) => key.includes("managerKitchens"))).toBe(false);
  });

  it("keys the checklist by kitchen, so two kitchens cannot share one entry", () => {
    expect(kitchenListingReadinessKey(1)).not.toEqual(kitchenListingReadinessKey(2));
  });
});
