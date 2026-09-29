import { describe, expect, it } from "vitest";
import { calculateKitchenBasePrice, hasKitchenRate, isPositiveRate, resolveCapturedKitchenRate } from "@shared/kitchen-booking-rate";

describe("isPositiveRate", () => {
  it("accepts a positive number in either unit", () => {
    // Cents off a DB row, and dollars out of a form field — the same question.
    expect(isPositiveRate(2500)).toBe(true);
    expect(isPositiveRate("25.00")).toBe(true);
  });

  it("rejects everything a rate cannot be", () => {
    // 0 is the one that matters: the gate reads a saved 0.00 as "no rate", so a form that
    // treated it as set would let through a kitchen the gate then calls unconfigured.
    expect(isPositiveRate(0)).toBe(false);
    expect(isPositiveRate("0.00")).toBe(false);
    // The old form's own failure mode: `Number.parseFloat("abc") > 0` is false, but a naive
    // truthiness check would have accepted it and serialised it to null.
    expect(isPositiveRate("abc")).toBe(false);
    expect(isPositiveRate("")).toBe(false);
    expect(isPositiveRate(null)).toBe(false);
    expect(isPositiveRate(undefined)).toBe(false);
  });
});

describe("hasKitchenRate", () => {
  it("accepts an hourly rate on its own", () => {
    expect(hasKitchenRate("25.00", "")).toBe(true);
    expect(hasKitchenRate(2500, null)).toBe(true);
  });

  /*
   * The regression this pins. Every form used to demand the hourly SPECIFICALLY, so a manager who
   * charges by the day could not create or leave a kitchen at all — even though `listingReq_rate` is
   * literally "Hourly or daily rate" and the gate would have published it. If this ever goes back to
   * reading only the hourly, this is the test that fails.
   */
  it("accepts a daily rate on its own — the reported bug", () => {
    expect(hasKitchenRate("", "150.00")).toBe(true);
    expect(hasKitchenRate(null, 15000)).toBe(true);
  });

  it("rejects a kitchen with neither rate", () => {
    expect(hasKitchenRate("", "")).toBe(false);
    expect(hasKitchenRate(undefined, undefined)).toBe(false);
    expect(hasKitchenRate("0.00", "0.00")).toBe(false);
  });

  it("accepts both", () => {
    expect(hasKitchenRate("25.00", "150.00")).toBe(true);
  });
});

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

  it("uses one daily rate even when a legacy subtotal was multiplied by hours", () => {
    expect(resolveCapturedKitchenRate({
      appliedRateCents: 24000,
      durationHours: 8,
      bookingSubtotalCents: 192000,
      pricingMode: "daily",
    })).toEqual({ mode: "daily", kitchenSubtotalCents: 24000 });
  });
});
