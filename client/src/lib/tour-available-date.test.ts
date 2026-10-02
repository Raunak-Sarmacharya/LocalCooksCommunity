import { describe, expect, it } from "vitest";
import { tourAvailableDate, tourToday } from "./tour-available-date";

describe("tourAvailableDate", () => {
  it('uses Newfoundland today and blackout dates even across UTC/browser midnight', () => {
    const today = tourToday(new Date('2026-10-08T01:00:00Z'));
    expect([today.getFullYear(), today.getMonth(), today.getDate()]).toEqual([2026, 9, 7]);
    const metadata = { settings: { maxAdvanceBookingDays: 21 },
      availability: [{ dayOfWeek: 3, isAvailable: true }, { dayOfWeek: 4, isAvailable: true }],
      blackouts: [{ startDate: '2026-10-07T02:30:00Z', endDate: '2026-10-08T02:29:59.999Z' }] };
    expect(tourAvailableDate(new Date(2026, 9, 7), metadata, today)).toBe(false);
    expect(tourAvailableDate(new Date(2026, 9, 8), metadata, today)).toBe(true);
  });
  it("uses the manager's active days and excludes blackouts and dates without slots", () => {
    const today = new Date(2026, 8, 28);
    const metadata = {
      settings: { maxAdvanceBookingDays: 21 },
      availability: [{ dayOfWeek: 2, isAvailable: true }],
      blackouts: [{ startDate: "2026-09-29T00:00:00", endDate: "2026-09-29T23:59:59" }],
      fullyBookedDates: ["2026-09-29", "2026-10-06", "2026-10-14"],
    };
    expect(tourAvailableDate(new Date(2026, 8, 29), metadata, today)).toBe(false);
    expect(tourAvailableDate(new Date(2026, 9, 6), metadata, today)).toBe(false);
    expect(tourAvailableDate(new Date(2026, 9, 13), metadata, today)).toBe(true);
    expect(tourAvailableDate(new Date(2026, 9, 14), metadata, today)).toBe(false);
  });
  it('honours server-calculated overnight tails and partial blackout availability', () => {
    const metadata = { settings: { maxAdvanceBookingDays: 21 }, availability: [{ dayOfWeek: 6, isAvailable: true }],
      blackouts: [{ startDate: '2026-10-04T12:00:00Z', endDate: '2026-10-04T13:00:00Z' }], fullyBookedDates: [] };
    expect(tourAvailableDate(new Date(2026, 9, 4), metadata, new Date(2026, 9, 1))).toBe(true);
  });
});
