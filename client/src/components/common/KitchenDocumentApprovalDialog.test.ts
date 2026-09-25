import { describe, expect, it } from "vitest";
import { getKitchenDocumentApprovalPlan } from "./KitchenDocumentApprovalDialog";

const requirements = { requireFoodHandlerCert: true, tier2_food_establishment_cert_required: true };

describe("kitchen document approval plan", () => {
  it("offers combined verification only for uploaded documents awaiting review", () => {
    const plan = getKitchenDocumentApprovalPlan({
      foodSafetyLicenseUrl: "/safety.pdf",
      foodSafetyLicenseExpiry: "2099-12-31",
      foodSafetyLicenseStatus: "pending",
      foodEstablishmentCertUrl: "/establishment.pdf",
      foodEstablishmentCertStatus: "approved",
    }, requirements);
    expect(plan.issues).toEqual([]);
    expect(plan.toVerify).toEqual([{ field: "foodSafetyLicenseStatus", label: "Food Safety Certificate" }]);
  });

  it("blocks combined approval for a missing or expired required document", () => {
    const plan = getKitchenDocumentApprovalPlan({
      foodSafetyLicenseUrl: "/safety.pdf",
      foodSafetyLicenseExpiry: "2020-01-01",
      foodSafetyLicenseStatus: "pending",
    }, requirements);
    expect(plan.toVerify).toEqual([]);
    expect(plan.issues).toEqual([
      "Food Safety Certificate: the document has expired; ask the chef for a replacement.",
      "Food Establishment Licence: ask the chef to upload the document.",
    ]);
  });

  it("never silently re-verifies a rejected document", () => {
    const plan = getKitchenDocumentApprovalPlan({
      foodSafetyLicenseUrl: "/safety.pdf",
      foodSafetyLicenseExpiry: "2099-12-31",
      foodSafetyLicenseStatus: "rejected",
    }, { requireFoodHandlerCert: true });
    expect(plan.toVerify).toEqual([]);
    expect(plan.issues).toContain("Food Safety Certificate: a replacement is needed before approval.");
  });
});
