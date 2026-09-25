import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildTourConfirmationPdf, tourReference } from "./tour-confirmation-pdf";

describe("tour confirmation PDF", () => {
  it("generates a readable document with a stable reference and Unicode chef details", async () => {
    expect(tourReference(42)).toBe("TOUR-42");
    const bytes = await buildTourConfirmationPdf({
      id: 42,
      chefName: "Олена Кухар",
      chefEmail: "chef@example.com",
      locationName: "Harbour Kitchen",
      kitchenName: "Main kitchen",
      locationAddress: "123 Harbour Road",
      managerName: "Morgan Manager",
      managerEmail: "kitchen@example.com",
      managerPhone: "+1 709 555 0100",
      scheduledAt: new Date("2026-10-05T14:30:00Z"),
      durationMinutes: 30,
      submittedAt: new Date("2026-09-25T12:00:00Z"),
      timezone: "America/St_Johns",
      chefNotes: "Потрібна холодильна камера",
      intakeData: { intendedUse: "Meal prep", hasLicense: true },
      managerNotes: "Use the front entrance",
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
