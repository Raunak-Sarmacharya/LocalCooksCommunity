import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSellerJourneyDraft,
  getSellerJourneyDraft,
  saveSellerJourneyDraft,
  sellerJourneyPayload,
} from "./seller-journey";

describe("seller journey draft", () => {
  beforeEach(() => window.localStorage.clear());

  it("survives the authentication handoff", () => {
    saveSellerJourneyDraft({
      fullName: "Ada Cook",
      email: "ADA@example.com",
      phone: "+1 (709) 555-0123",
      kitchenPreference: "home",
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    });
    expect(getSellerJourneyDraft()).toMatchObject({ fullName: "Ada Cook", kitchenPreference: "home" });
    clearSellerJourneyDraft();
    expect(getSellerJourneyDraft()).toBeNull();
  });

  it("builds a seller application with certifications deferred", () => {
    const payload = sellerJourneyPayload({
      fullName: " Ada Cook ",
      email: "ADA@example.com",
      phone: "+1 (709) 555-0123",
      kitchenPreference: "commercial",
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
      savedAt: Date.now(),
    });
    expect(payload).toMatchObject({
      fullName: "Ada Cook",
      email: "ada@example.com",
      kitchenPreference: "commercial",
      foodSafetyLicense: "no",
      foodEstablishmentCert: "no",
    });
    expect(payload).not.toHaveProperty("feedback");
  });
});
