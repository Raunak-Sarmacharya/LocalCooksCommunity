import { describe, expect, it } from "vitest";
import { calculateKitchenBasePrice } from "@shared/kitchen-booking-rate";

describe("calculateKitchenBasePrice", () => {
  it("keeps hourly and daily rates independent", () => {
    expect(calculateKitchenBasePrice("hourly", 2500, 12000, 3)).toBe(7500);
    expect(calculateKitchenBasePrice("daily", 2500, 12000, 8)).toBe(12000);
  });
});
