import { describe, expect, it } from "vitest";
import {
  chefTourRowHasDetails,
  formatTourWhen,
  normalizeChefTourRow,
  viewingStatusBadge,
} from "./chef-viewing-display";

describe("viewingStatusBadge", () => {
  it("maps pending to warning and confirmed to success", () => {
    expect(viewingStatusBadge("pending").variant).toBe("warning");
    expect(viewingStatusBadge("confirmed").variant).toBe("success");
  });

  it("reserves destructive for cancel / no-show only", () => {
    expect(viewingStatusBadge("cancelled").variant).toBe("destructive");
    expect(viewingStatusBadge("no_show").variant).toBe("destructive");
    expect(viewingStatusBadge("completed").variant).not.toBe("destructive");
  });
});

describe("formatTourWhen", () => {
  it("appends end time when duration is set", () => {
    const label = formatTourWhen("2026-08-31T12:25:00.000Z", 30, "America/St_Johns");
    expect(label).toContain("–");
    expect(label.length).toBeGreaterThan(12);
  });

  it("omits end when duration missing", () => {
    const label = formatTourWhen("2026-08-31T12:25:00.000Z", null, "America/St_Johns");
    expect(label).not.toContain("–");
  });
});

describe("normalizeChefTourRow", () => {
  it("flattens nested API rows and drops empty intake", () => {
    const row = normalizeChefTourRow({
      locationName: "Satya Test",
      locationAddress: "14 Water St",
      managerName: "Alex",
      viewing: {
        id: 7,
        locationId: 3,
        status: "pending",
        scheduledAt: "2026-08-31T12:25:00.000Z",
        durationMinutes: 30,
        chefNotes: "Need cold storage",
        intakeData: { intendedUse: "meal prep", skip: "" },
      },
    });
    expect(row?.locationName).toBe("Satya Test");
    expect(row?.chefNotes).toBe("Need cold storage");
    expect(row?.intakeEntries).toEqual([["intendedUse", "meal prep"]]);
    expect(chefTourRowHasDetails(row!)).toBe(true);
  });

  it("returns null for incomplete payloads", () => {
    expect(normalizeChefTourRow({})).toBeNull();
    expect(normalizeChefTourRow(null)).toBeNull();
  });
});
