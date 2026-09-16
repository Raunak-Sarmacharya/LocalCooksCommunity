import { describe, expect, it } from "vitest";
import { DEFAULT_KITCHEN_SECTION, kitchenSectionFromParams, legacyKitchenSection } from "./manager-kitchens-navigation";

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
