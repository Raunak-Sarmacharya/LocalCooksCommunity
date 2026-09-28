import { describe, expect, it } from "vitest";
import { tourAvailableDate } from "./tour-available-date";

describe("tourAvailableDate", () => {
  it("uses the manager's active days and excludes blackouts and dates without slots", () => {
    const today = new Date(2026, 8, 28);
    const metadata = {
      settings: { maxAdvanceBookingDays: 21 },
      availability: [{ dayOfWeek: 2, isAvailable: true }],
      blackouts: [{ startDate: "2026-09-29T00:00:00", endDate: "2026-09-29T23:59:59" }],
      fullyBookedDates: ["2026-10-06"],
    };
    expect(tourAvailableDate(new Date(2026, 8, 29), metadata, today)).toBe(false);
    expect(tourAvailableDate(new Date(2026, 9, 6), metadata, today)).toBe(false);
    expect(tourAvailableDate(new Date(2026, 9, 13), metadata, today)).toBe(true);
    expect(tourAvailableDate(new Date(2026, 9, 14), metadata, today)).toBe(false);
  });
});
