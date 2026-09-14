import { describe, expect, it } from "vitest";
import { buildManagerSetupSteps } from "./use-onboarding-status";

describe("buildManagerSetupSteps", () => {
  it("includes non-blocking profile completion with the five manager setup steps", () => {
    const steps = buildManagerSetupSteps({
      isProfileComplete: false,
      hasUploadedLicense: true,
      hasKitchens: true,
      hasAvailability: false,
      hasRequirements: false,
      isStripeComplete: false,
    });

    expect(steps.map((step) => step.id)).toEqual([
      "profile",
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
