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

  it("returns null when no kitchen has a stored date", () => {
    expect(findPersistedBookingForKitchens([1, 2])).toBeNull();
  });
});
