import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/manager", () => ({ mt: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }));

import { listingProgress, sectionSummary, weeklyHoursLine } from "./kitchen-sections";
import { nextBookingLabel } from "@/components/manager/settings/KitchenCards";

const day = (dayOfWeek: number, startTime = "08:00", endTime = "18:00") => ({ dayOfWeek, startTime, endTime, isAvailable: true });
const review = (missing: string[], listed = false) => ({
  listingStatus: listed ? "active" : "draft",
  adminHidden: false,
  checklist: {
    requirements: ["description", "rate", "license", "availability", "coverPhoto", "stripe", "applicationRequirements", "visitSetup", "bookingRules"].map(id => ({ id, met: !missing.includes(id) })),
    recommendations: [], canPublish: !missing.length, missingRequirementIds: missing, openRecommendationIds: [],
  },
  details: { hourlyRateCents: 2500, dailyRateCents: 18000, coverPhotoUrl: "x", galleryImageCount: 0, cancellationPolicyHours: 24, minimumBookingHours: 1,
    visitSetup: { arrivalRequirementCount: 1, departureRequirementCount: 1 } },
}) as never;

describe("kitchen editor section summaries", () => {
  it("names the opening days the way people say them", () => {
    expect(weeklyHoursLine([0, 1, 2, 3, 4, 5, 6].map(d => day(d)), "en-CA")).toBe("ksEveryDay, 8 a.m.–6 p.m.");
    expect(weeklyHoursLine([1, 2, 3, 4, 5].map(d => day(d)), "en-CA")).toBe("Mon–Fri, 8 a.m.–6 p.m.");
    expect(weeklyHoursLine([day(6), day(0)], "en-CA")).toBe("Sat, Sun, 8 a.m.–6 p.m.");
    expect(weeklyHoursLine([day(1), day(2, "09:00")], "en-CA")).toBe('ksDaysOpen {"count":2}');
    expect(weeklyHoursLine([], "en-CA")).toBeNull();
  });

  it("marks what blocks listing from the same checklist the server enforces, and ticks only while a draft", () => {
    expect(sectionSummary("details", { review: review(["rate"]), locale: "en-CA" })).toEqual({ line: "ksAddPrice", mark: "required" });
    expect(sectionSummary("arrival-departure", { review: review(["visitSetup"]), locale: "en-CA" }).mark).toBe("required");
    expect(sectionSummary("arrival-departure", { review: review([]), locale: "en-CA" })).toEqual({ line: 'ksArrivalTasks {"count":2}', mark: "done" });
    expect(sectionSummary("details", { review: review([], true), locale: "en-CA" }).mark).toBeNull();
    expect(sectionSummary("storage", { review: review([]), extras: { storage: { total: 2, listed: 1 }, equipment: { total: 0, listed: 0 } }, locale: "en-CA" }).line)
      .toBe('ksListedOfTotal {"listed":1,"total":2}');
    // Switched on but not complete (e.g. no move-in instructions) is a draft, not listed.
    expect(sectionSummary("storage", { review: review([]), extras: { storage: { total: 1, listed: 0 }, equipment: { total: 0, listed: 0 } }, locale: "en-CA" }).line)
      .toBe('ksNotListedYet {"count":1}');
    expect(sectionSummary("tours", { review: review([], true), tours: { enabled: true, ready: true, scheduled: true }, locale: "en-CA" }).mark).toBe("live");
  });

  it("separates the location's own steps from the kitchen's", () => {
    expect(listingProgress(review(["stripe", "coverPhoto"]))).toEqual({ total: 9, done: 7, left: 2, locationMissing: ["stripe"] });
  });

  it("reads the next booking in the location's clock", () => {
    const now = new Date("2026-10-24T14:00:00Z"); // 11:30 a.m. in St. John's
    expect(nextBookingLabel("2026-10-24T15:00", "America/St_Johns", now, "en-CA")).toBe("today, 3 p.m.");
    expect(nextBookingLabel("2026-10-25T09:30", "America/St_Johns", now, "en-CA")).toBe("tomorrow, 9:30 a.m.");
    expect(nextBookingLabel("2026-10-28T09:00", "America/St_Johns", now, "en-CA")).toMatch(/^Wed, Oct 28, 9 a\.m\.$/);
  });
});
