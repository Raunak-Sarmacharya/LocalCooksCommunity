import { beforeEach, describe, expect, it } from "vitest";
import { formatPreferredSchedule, preferredScheduleForRequest, readPreferredSchedule, writePreferredSchedule } from "./preferred-schedule";

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe("preferred schedule", () => {
  it("is saved where the booking flow reads it, in both stores (a verification tab keeps it), and sent with the request", () => {
    writePreferredSchedule("54", { days: ["2026-11-01", "2026-10-30"].sort(), pricingMode: "hourly", times: ["09:00", "10:00", "11:00"] });
    expect(JSON.parse(sessionStorage.getItem("kitchen_dates_54")!)).toEqual({ from: "2026-10-30T00:00:00", dates: ["2026-10-30", "2026-11-01"] });
    sessionStorage.clear();
    expect(readPreferredSchedule("54")).toEqual({ days: ["2026-10-30", "2026-11-01"], pricingMode: "hourly", times: ["09:00", "10:00", "11:00"] });
    expect(preferredScheduleForRequest("54")?.days).toHaveLength(2);
    writePreferredSchedule("54", { days: [], pricingMode: "hourly", times: [] });
    expect(preferredScheduleForRequest("54")).toBeNull();
  });
  it("reads an older single-date save and ignores junk", () => {
    sessionStorage.setItem("kitchen_dates_7", JSON.stringify({ from: "2026-10-30T00:00:00.000Z" }));
    sessionStorage.setItem("kitchen_booking_prefs_7", JSON.stringify({ slots: ["09:00", "bad"] }));
    expect(readPreferredSchedule("7")).toEqual({ days: ["2026-10-30"], pricingMode: "hourly", times: ["09:00"] });
  });
  it("reads as days and an hour range, or full day", () => {
    expect(formatPreferredSchedule({ days: ["2026-10-30", "2026-11-01"], pricingMode: "hourly", times: ["09:00", "10:00", "11:00", "12:00"] }, "en-CA", "Full day"))
      .toMatch(/^Fri, Oct 30 · Sun, Nov 1 · 9:00\s?a\.m\.–1:00\s?p\.m\.$/);
    expect(formatPreferredSchedule({ days: ["2026-10-30"], pricingMode: "daily", times: [] }, "en-CA", "Full day")).toBe("Fri, Oct 30 · Full day");
    expect(formatPreferredSchedule(null, "en-CA", "Full day")).toBeNull();
  });
});
