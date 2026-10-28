import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@/i18n";
import { KitchenAccessTracker } from "./KitchenAccessTracker";
import type { ApplicationDocument } from "./MyDocuments";

afterEach(cleanup);
const doc = (extra: Partial<ApplicationDocument>): ApplicationDocument => ({ key: "custom:biz", label: "Business licence", mode: "required", hasExpiry: true, waived: false, uploaded: true,
  status: "approved", expiry: "2027-10-27", daysLeft: 365, stage: null, renewalPending: false, sentAt: "2026-10-13T15:00:00Z", checkedAt: "2026-10-13T16:00:00Z", ...extra });
const app = (documents: ApplicationDocument[], canBook: boolean, status = canBook ? "approved" : "document_review_required") => ({
  status: "approved", current_tier: 3, createdAt: "2026-10-01T12:00:00Z", tier1_completed_at: "2026-10-11T12:00:00Z", tier2_completed_at: "2026-10-12T12:00:00Z",
  reviewedAt: "2026-10-13T12:00:00Z", updatedAt: "2026-10-13T12:00:00Z", documentsWaivedAt: null, tier_data: {}, documents, bookingEligibility: { canBook, status, message: "" } }) as any;
const steps = () => within(screen.getByTestId("kitchen-access-tracker")).getAllByRole("listitem").map(item => item.textContent);

describe("tracker, booking requirements step (mocks c1–c6)", () => {
  it("c1: counts the documents to send and says Book is paused", () => {
    render(<KitchenAccessTracker app={app([doc({ uploaded: false, status: null }), doc({ key: "custom:rules", uploaded: false, status: null })], false)} stacked />);
    expect(steps()).toEqual(["Request to applyApproved Oct 11", "Booking requirements2 documents to send", "BookPaused"]);
  });
  it("c2: with the kitchen since the day they were sent", () => {
    render(<KitchenAccessTracker app={app([doc({ status: "pending", sentAt: "2026-10-27T15:00:00Z" })], false)} />);
    expect(steps()[1]).toBe("Booking requirementsWith the kitchen since Oct 27");
  });
  it("c3 and c5: new copy needed; expired names the document", () => {
    render(<KitchenAccessTracker app={app([doc({ status: "rejected" })], false)} />);
    expect(steps()[1]).toBe("Booking requirementsNew copy needed");
    cleanup();
    render(<KitchenAccessTracker app={app([doc({ label: "Food safety certificate", key: "custom:fsc", stage: "expired", daysLeft: -7 })], false, "document_expired")} />);
    expect(steps()[1]).toBe("Booking requirementsFood safety certificate expired");
  });
  it("c4: up to date shows when documents were last checked, not the first approval", () => {
    render(<KitchenAccessTracker app={app([doc({ checkedAt: "2026-10-27T16:00:00Z" }), doc({ key: "custom:rules", checkedAt: "2026-10-13T16:00:00Z" })], true)} />);
    expect(steps().slice(1)).toEqual(["Booking requirementsUp to date · checked Oct 27", "BookReady to book"]);
  });
  it("c6: a renewal with the kitchen while booking stays open", () => {
    render(<KitchenAccessTracker app={app([doc({ renewalPending: true, stage: "14_day" })], true)} />);
    expect(steps().slice(1)).toEqual(["Booking requirementsNew copy with the kitchen", "BookReady to book"]);
  });
});
