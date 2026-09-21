import { describe, expect, it } from "vitest";
import { describeDailyRate, formatBreakEvenHours } from "./daily-rate-hint";

describe("describeDailyRate", () => {
  it("says nothing until both rates are usable", () => {
    expect(describeDailyRate({ hourlyRate: "", dailyRate: "80" })).toEqual({ kind: "none" });
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "" })).toEqual({ kind: "none" });
    expect(describeDailyRate({ hourlyRate: "0", dailyRate: "80" })).toEqual({ kind: "none" });
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "0" })).toEqual({ kind: "none" });
    expect(describeDailyRate({ hourlyRate: "abc", dailyRate: "80" })).toEqual({ kind: "none" });
    expect(describeDailyRate({ hourlyRate: "  ", dailyRate: "80" })).toEqual({ kind: "none" });
  });

  it("reports the break-even when the day rate is a real discount", () => {
    // $50/hr and a $120 day rate: the day is worth 2.4 hours, and the hourly ceiling of
    // 2 hours costs $100 — so the day is genuinely more expensive than the ceiling. Fine.
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "120", dailyBookingLimit: 2 })).toEqual({
      kind: "break-even",
      breakEvenHours: 2.4,
    });
  });

  it("flags a day rate that undercuts the longest hourly booking", () => {
    // $50/hr with a 2-hour ceiling costs $100, but the day is $80 — a chef wanting 2 hours
    // takes the whole day for less.
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "80", dailyBookingLimit: 2 })).toEqual({
      kind: "below-hourly-ceiling",
      breakEvenHours: 1.6,
      ceilingHours: 2,
      ceilingCostCents: 10000,
    });
  });

  it("treats a day rate exactly equal to the ceiling as acceptable", () => {
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "100", dailyBookingLimit: 2 })).toEqual({
      kind: "break-even",
      breakEvenHours: 2,
    });
  });

  it("falls back to the break-even when the ceiling is unknown", () => {
    const expected = { kind: "break-even", breakEvenHours: 1.6 };
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "80" })).toEqual(expected);
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "80", dailyBookingLimit: null })).toEqual(expected);
    expect(describeDailyRate({ hourlyRate: "50", dailyRate: "80", dailyBookingLimit: 0 })).toEqual(expected);
  });

  it("handles decimal rates", () => {
    // $12.50/hr, $95 day rate, 4-hour ceiling ($50) → day is well above it.
    expect(describeDailyRate({ hourlyRate: "12.50", dailyRate: "95", dailyBookingLimit: 4 })).toEqual({
      kind: "break-even",
      breakEvenHours: 7.6,
    });
    // $12.50/hr, $40 day rate, 4-hour ceiling ($50) → under it.
    expect(describeDailyRate({ hourlyRate: "12.50", dailyRate: "40", dailyBookingLimit: 4 })).toEqual({
      kind: "below-hourly-ceiling",
      breakEvenHours: 3.2,
      ceilingHours: 4,
      ceilingCostCents: 5000,
    });
  });
});

describe("formatBreakEvenHours", () => {
  it("keeps whole hours whole and rounds fractions to one decimal", () => {
    expect(formatBreakEvenHours(2)).toBe("2");
    expect(formatBreakEvenHours(2.4)).toBe("2.4");
    expect(formatBreakEvenHours(1.6)).toBe("1.6");
    expect(formatBreakEvenHours(1 / 3)).toBe("0.3");
  });
});
