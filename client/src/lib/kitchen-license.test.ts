import { describe, it, expect } from "vitest";
import {
  daysUntilExpiry,
  kitchenLicenseState,
  licenseAllowsBookings,
  licenseReminderStage,
  isReplacementUnderReview,
  licenseHasNoExpiryDate,
  parseLicenseDate,
  type KitchenLicenseFields,
} from "@shared/kitchen-license";

const approved = (expiry: string | null): KitchenLicenseFields => ({
  kitchenLicenseUrl: "https://cdn.example/license.pdf",
  kitchenLicenseStatus: "approved",
  kitchenLicenseExpiry: expiry,
});

describe("daysUntilExpiry", () => {
  it("counts whole calendar days, so the expiry day itself is 0 not -1", () => {
    expect(daysUntilExpiry("2026-03-03", new Date(2026, 2, 3))).toBe(0);
    expect(daysUntilExpiry("2026-03-03", new Date(2026, 2, 2))).toBe(1);
    expect(daysUntilExpiry("2026-03-03", new Date(2026, 2, 4))).toBe(-1);
  });

  it("does not shift the date across a UTC boundary", () => {
    // 2026-03-03 UTC midnight is 2026-03-02 20:30 in America/St_Johns. Parsing the
    // date-only string with `new Date()` reported this license as expiring a day
    // early, which is why the page showed "3/2/2026" for a March 3rd license.
    expect(daysUntilExpiry("2026-03-03", new Date(2026, 2, 3, 0, 30))).toBe(0);
    expect(daysUntilExpiry("2026-03-03", new Date(2026, 2, 3, 23, 59))).toBe(0);
  });

  it("returns null when there is no date", () => {
    expect(daysUntilExpiry(null)).toBeNull();
    expect(daysUntilExpiry(undefined)).toBeNull();
    expect(daysUntilExpiry("not-a-date")).toBeNull();
  });
});

describe("kitchenLicenseState", () => {
  it("reports not_uploaded when there is no document", () => {
    expect(kitchenLicenseState({ kitchenLicenseStatus: "pending" })).toBe("not_uploaded");
  });

  it("stays bookable through the last day of validity and expires the day after", () => {
    // The expiry day is inside the 30-day window, so the state is expiring_soon —
    // which still allows bookings. Only the day AFTER is expired.
    expect(kitchenLicenseState(approved("2026-03-03"), new Date(2026, 2, 3))).toBe("expiring_soon");
    expect(licenseAllowsBookings(approved("2026-03-03"), new Date(2026, 2, 3))).toBe(true);
    expect(kitchenLicenseState(approved("2026-03-03"), new Date(2026, 2, 4))).toBe("expired");
  });

  it("flags expiring_soon at exactly 30 days out and active at 31", () => {
    expect(kitchenLicenseState(approved("2026-04-03"), new Date(2026, 2, 3))).toBe("active");
    expect(kitchenLicenseState(approved("2026-04-02"), new Date(2026, 2, 3))).toBe("expiring_soon");
  });

  it("keeps an approved license with no expiry on record as active", () => {
    expect(kitchenLicenseState(approved(null))).toBe("active");
    expect(licenseHasNoExpiryDate(approved(null))).toBe(true);
  });

  it("reports under_review and rejected from status alone", () => {
    expect(
      kitchenLicenseState({ kitchenLicenseUrl: "u", kitchenLicenseStatus: "pending" }),
    ).toBe("under_review");
    expect(
      kitchenLicenseState({ kitchenLicenseUrl: "u", kitchenLicenseStatus: "rejected" }),
    ).toBe("rejected");
  });

  it("treats a pending_update as governed by the LIVE expiry", () => {
    const fields: KitchenLicenseFields = {
      kitchenLicenseUrl: "live.pdf",
      kitchenLicenseStatus: "pending_update",
      kitchenLicenseExpiry: "2027-01-01",
      kitchenLicensePendingUrl: "replacement.pdf",
      kitchenLicensePendingExpiry: "2029-01-01",
    };
    expect(kitchenLicenseState(fields, new Date(2026, 2, 3))).toBe("active");
    expect(isReplacementUnderReview(fields)).toBe(true);
  });
});

describe("licenseAllowsBookings", () => {
  it("blocks an expired license", () => {
    expect(licenseAllowsBookings(approved("2026-03-03"), new Date(2026, 2, 4))).toBe(false);
  });

  it("allows an expiring-soon license, because it is still valid", () => {
    expect(licenseAllowsBookings(approved("2026-03-10"), new Date(2026, 2, 3))).toBe(true);
  });

  it("blocks a license that was never approved", () => {
    expect(
      licenseAllowsBookings(
        { kitchenLicenseUrl: "u", kitchenLicenseStatus: "pending", kitchenLicenseExpiry: "2027-01-01" },
        new Date(2026, 2, 3),
      ),
    ).toBe(false);
  });

  it("keeps the listing live when a replacement is submitted before expiry", () => {
    // The whole point of the pending/live split: renewing early must not cost the
    // manager their bookings, or nobody renews until the last day.
    expect(
      licenseAllowsBookings(
        {
          kitchenLicenseUrl: "live.pdf",
          kitchenLicenseStatus: "pending_update",
          kitchenLicenseExpiry: "2026-03-20",
          kitchenLicensePendingUrl: "replacement.pdf",
          kitchenLicensePendingExpiry: "2029-01-01",
        },
        new Date(2026, 2, 3),
      ),
    ).toBe(true);
  });

  it("stays blocked when the replacement is submitted after expiry", () => {
    // The live document is what governs, and it has lapsed — a queued replacement
    // does not reopen the listing until it is approved.
    expect(
      licenseAllowsBookings(
        {
          kitchenLicenseUrl: "live.pdf",
          kitchenLicenseStatus: "pending_update",
          kitchenLicenseExpiry: "2026-03-01",
          kitchenLicensePendingUrl: "replacement.pdf",
          kitchenLicensePendingExpiry: "2029-01-01",
        },
        new Date(2026, 2, 3),
      ),
    ).toBe(false);
  });
});

describe("licenseReminderStage", () => {
  const now = new Date(2026, 2, 3);

  it("fires the 30-day reminder once inside the window", () => {
    expect(licenseReminderStage(approved("2026-03-30"), now)).toBe("30_day");
    expect(licenseReminderStage(approved("2026-04-03"), now)).toBeNull();
  });

  it("escalates to the 7-day reminder inside the final week", () => {
    expect(licenseReminderStage(approved("2026-03-10"), now)).toBe("7_day");
    expect(licenseReminderStage(approved("2026-03-03"), now)).toBe("7_day");
  });

  it("reports expired from the day after expiry", () => {
    expect(licenseReminderStage(approved("2026-03-02"), now)).toBe("expired");
  });

  it("stays silent for anything that was never approved", () => {
    expect(licenseReminderStage({ kitchenLicenseUrl: "u", kitchenLicenseStatus: "pending", kitchenLicenseExpiry: "2026-03-10" }, now)).toBeNull();
    expect(licenseReminderStage({}, now)).toBeNull();
  });
});
