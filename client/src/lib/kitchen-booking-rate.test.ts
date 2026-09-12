import { describe, expect, it } from "vitest";
import { calculateKitchenBasePrice, resolveCapturedKitchenRate } from "@shared/kitchen-booking-rate";

describe("calculateKitchenBasePrice", () => {
  it("keeps hourly and daily rates independent", () => {
    expect(calculateKitchenBasePrice("hourly", 2500, 12000, 3)).toBe(7500);
    expect(calculateKitchenBasePrice("daily", 2500, 12000, 8)).toBe(12000);
  });
});

describe("resolveCapturedKitchenRate", () => {
  it("recognizes a captured flat day in the legacy rate field", () => {
    expect(resolveCapturedKitchenRate({
      appliedRateCents: 24000,
      durationHours: 8,
      bookingSubtotalCents: 28000,
      addonSubtotalCents: 4000,
    })).toEqual({ mode: "daily", kitchenSubtotalCents: 24000 });
  });

  it("preserves captured hourly pricing", () => {
    expect(resolveCapturedKitchenRate({
      appliedRateCents: 2000,
      durationHours: 8,
      bookingSubtotalCents: 20000,
      addonSubtotalCents: 4000,
    })).toEqual({ mode: "hourly", kitchenSubtotalCents: 16000 });
  });
});
