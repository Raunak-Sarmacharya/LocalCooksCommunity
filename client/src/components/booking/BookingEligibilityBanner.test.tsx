import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider } from "react-i18next";
import enBooking from "@shared/i18n/locales/en-CA/booking.json";
import frBooking from "@shared/i18n/locales/fr-CA/booking.json";
import { BookingEligibilityBanner } from "./BookingEligibilityBanner";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));

async function mount(document: { key: string; label: string; expiry: string | null; reason?: "missing" | "rejected" | "pending" | "needs_expiry" }, lng = "en-CA") {
  const i18n = createInstance();
  await i18n.use(ICU).init({ lng, resources: { "en-CA": { booking: enBooking }, "fr-CA": { booking: frBooking } }, defaultNS: "booking", ns: ["booking"], interpolation: { escapeValue: false } });
  return render(<I18nextProvider i18n={i18n}>
    <BookingEligibilityBanner locationName="Harbour Kitchen" eligibility={{ canBook: false, status: "document_review_required", message: "", actionUrl: "/dashboard?view=kitchen-requests&renewLocation=47", document } as never} />
  </I18nextProvider>);
}

describe("BookingEligibilityBanner documents", () => {
  it("names the kitchen's own document and asks for it when it was never uploaded", async () => {
    await mount({ key: "custom:biz", label: "Business licence", expiry: null, reason: "missing" });
    expect(screen.getByText("Harbour Kitchen needs your Business licence before you can book. Upload it and you can book once Harbour Kitchen approves it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload your Business licence" })).toBeInTheDocument();
    expect(screen.queryByText(/Food Safety Certificate/)).not.toBeInTheDocument();
  });
  it("names every document still to upload, not only the first", async () => {
    await mount({ key: "custom:biz", label: "Business licence", expiry: null, reason: "missing", alsoMissing: ["Signed house rules"] } as never);
    expect(screen.getByText("Harbour Kitchen needs your Business licence and Signed house rules before you can book. Upload them and you can book once Harbour Kitchen approves them.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload your documents" })).toBeInTheDocument();
  });
  it("says a document is waiting for the kitchen instead of asking for a renewal", async () => {
    await mount({ key: "insurance", label: "Insurance", expiry: null, reason: "pending" });
    expect(screen.getByText("Your Insurance is waiting for approval from Harbour Kitchen. You can book once it is approved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See document status" })).toBeInTheDocument();
  });
  it("keeps the renewal wording for a dated document without a valid expiry, in French too", async () => {
    await mount({ key: "foodSafetyLicense", label: "Food Safety Certificate", expiry: null, reason: "needs_expiry" }, "fr-CA");
    expect(screen.getByText(/Permis de salubrité alimentaire/)).toBeInTheDocument();
  });
});
