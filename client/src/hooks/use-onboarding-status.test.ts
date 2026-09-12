import { describe, expect, it } from "vitest";
import { buildManagerSetupSteps } from "./use-onboarding-status";

describe("buildManagerSetupSteps", () => {
  it("returns only the five required manager setup steps with accurate progress", () => {
    const steps = buildManagerSetupSteps({
      hasUploadedLicense: true,
      hasKitchens: true,
      hasAvailability: false,
      hasRequirements: false,
      isStripeComplete: false,
    });

    expect(steps.map((step) => step.id)).toEqual([
      "license",
      "kitchen",
      "availability",
      "requirements",
      "payments",
    ]);
    expect(steps.filter((step) => step.complete)).toHaveLength(2);
    expect(steps.some((step) => step.labelKey.toLowerCase().includes("description"))).toBe(false);
  });
});
