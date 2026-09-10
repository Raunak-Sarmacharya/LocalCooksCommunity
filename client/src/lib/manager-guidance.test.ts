import { describe, expect, it } from "vitest";
import { getManagerImprovementDestination } from "./manager-guidance";

describe("manager improvement destinations", () => {
  it("keeps kitchen improvements on the consolidated Kitchens page", () => {
    expect(getManagerImprovementDestination("Describe every kitchen")).toEqual({ view: "kitchens" });
  });
});
