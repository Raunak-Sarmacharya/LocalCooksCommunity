import { afterEach, describe, expect, it } from "vitest";
import { findPersistedBookingForKitchens } from "./persisted-booking-prefs";

describe("findPersistedBookingForKitchens", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns date-only preview selection without requiring slots", () => {
    const date = new Date(2026, 8, 15);
    date.setHours(0, 0, 0, 0);
    sessionStorage.setItem("kitchen_dates_42", JSON.stringify({ from: date }));

    expect(findPersistedBookingForKitchens([42])).toEqual({
      kitchenId: "42",
      dateIso: "2026-09-15",
      slots: [],
    });
  });

  it("includes slots when both date and prefs are stored", () => {
    const date = new Date(2026, 8, 15);
    date.setHours(0, 0, 0, 0);
    sessionStorage.setItem("kitchen_dates_7", JSON.stringify({ from: date }));
    sessionStorage.setItem(
      "kitchen_booking_prefs_7",
      JSON.stringify({ slots: ["09:00", "10:00"] })
    );

    expect(findPersistedBookingForKitchens([7])).toEqual({
      kitchenId: "7",
      dateIso: "2026-09-15",
      slots: ["09:00", "10:00"],
    });
  });

  it("returns every day picked on the kitchen page, first day as the date", () => {
    sessionStorage.setItem("kitchen_dates_9", JSON.stringify({ from: new Date(2026, 9, 26), dates: ["2026-10-28", "2026-10-26", "2026-10-30"] }));
    sessionStorage.setItem("kitchen_booking_prefs_9", JSON.stringify({ slots: ["09:00"] }));

    expect(findPersistedBookingForKitchens([9])).toEqual({
      kitchenId: "9",
      dateIso: "2026-10-26",
      slots: [],
      dates: ["2026-10-26", "2026-10-28", "2026-10-30"],
    });
  });

  it("ignores a malformed days list and falls back to the single date", () => {
    sessionStorage.setItem("kitchen_dates_8", JSON.stringify({ from: new Date(2026, 9, 26), dates: ["26/10/2026"] }));
    expect(findPersistedBookingForKitchens([8])).toEqual({ kitchenId: "8", dateIso: "2026-10-26", slots: [] });
  });

  it("returns null when no kitchen has a stored date", () => {
    expect(findPersistedBookingForKitchens([1, 2])).toBeNull();
  });
});
