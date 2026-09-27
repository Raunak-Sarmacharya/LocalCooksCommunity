/**
 * The listing gate's "does the chef's application ask for anything?" rule.
 *
 * Lives under `client/src/` because vitest's `include` is `client/**` only, and the
 * `@shared` alias resolves here — a probe placed next to the module it tests
 * (`shared/**`) silently matches no test files and "passes" by not running.
 *
 * The bug these cases exist to catch (reported 2026-09-26): the ask list used to carry
 * the thirteen tier-1 APPLICANT fields alongside the manager's four document switches.
 * Those thirteen are admin-owned, default to `true`, and have no switch in the manager's
 * wizard — so a manager could turn all four of their own switches off and the rule still
 * returned `true`. The gate read "Set" and could never block, which is the same
 * "measuring a person against fields they do not own" mistake as the requirements review.
 *
 * Every case below is written from the MANAGER's side of the table.
 */
import { describe, expect, it } from "vitest";

import {
  REQUIREMENT_ASK_FIELDS,
  hasAnyApplicationRequirement,
} from "@shared/kitchen-listing-readiness";

/** The four switches `RequirementsStepTwo` actually renders. */
const ALL_FOUR_OFF = {
  requireFoodHandlerCert: false,
  tier2_food_establishment_cert_required: false,
  tier2_insurance_document_required: false,
  tier2_kitchen_experience_required: false,
};

describe("hasAnyApplicationRequirement", () => {
  it("counts only the four switches the manager owns", () => {
    // A guard on the LIST, not the function: adding an admin-owned field back here is
    // exactly how the gate became unfalsifiable, and this fails loudly if it happens.
    expect([...REQUIREMENT_ASK_FIELDS]).toEqual([
      "requireFoodHandlerCert",
      "tier2_food_establishment_cert_required",
      "tier2_insurance_document_required",
      "tier2_kitchen_experience_required",
    ]);
  });

  it("blocks when the manager switched all four off", () => {
    expect(hasAnyApplicationRequirement({ ...ALL_FOUR_OFF, tier2_custom_fields: [] })).toBe(false);
  });

  it("still blocks when all four are off AND the applicant fields are on", () => {
    // THE REGRESSION. These applicant fields are `true` on every real row; if any of them
    // is read here the gate passes and can never block again.
    expect(
      hasAnyApplicationRequirement({
        ...ALL_FOUR_OFF,
        requireFirstName: true,
        requireLastName: true,
        requireEmail: true,
        requirePhone: true,
        requireBusinessName: true,
        requireBusinessType: true,
        requireExperience: true,
        requireUsageFrequency: true,
        requireSessionDuration: true,
        requireTermsAgree: true,
        requireAccuracyAgree: true,
      }),
    ).toBe(false);
  });

  it.each([...REQUIREMENT_ASK_FIELDS])("passes when %s alone is on", (field) => {
    expect(hasAnyApplicationRequirement({ ...ALL_FOUR_OFF, [field]: true })).toBe(true);
  });

  it("passes when all four are off but the manager added a custom question", () => {
    expect(
      hasAnyApplicationRequirement({
        ...ALL_FOUR_OFF,
        tier2_custom_fields: [{ id: "a", label: "Business registration", required: true }],
      }),
    ).toBe(true);
  });

  it("does not count the expiry companions as separate asks", () => {
    // Both travel with their certificate switch, so neither may appear in the list.
    expect(REQUIREMENT_ASK_FIELDS).not.toContain("requireFoodHandlerExpiry");
    expect(REQUIREMENT_ASK_FIELDS).not.toContain("tier2_food_establishment_expiry_required");
  });

  it("treats a missing row as configured, not as empty", () => {
    // `getLocationRequirementsWithDefaults` fills the platform defaults in when nothing is
    // saved, and two of the four default ON — so an untouched kitchen passes. Only the
    // caller's fetch FAILURE produces `null`, which cannot pass.
    const defaults = {
      requireFoodHandlerCert: true,
      tier2_food_establishment_cert_required: true,
      tier2_insurance_document_required: false,
      tier2_kitchen_experience_required: false,
    };
    expect(hasAnyApplicationRequirement(defaults)).toBe(true);
    expect(hasAnyApplicationRequirement(null)).toBe(false);
    expect(hasAnyApplicationRequirement(undefined)).toBe(false);
  });

  it("only accepts a literal true, so a partial or odd payload cannot pass by accident", () => {
    for (const bad of [{}, { requireFoodHandlerCert: "true" }, { requireFoodHandlerCert: 1 }]) {
      expect(hasAnyApplicationRequirement(bad as never)).toBe(false);
    }
  });

  it("survives a custom-fields column that is not an array", () => {
    // The column is jsonb; an un-migrated row or a hand-edited value must not throw here,
    // because this function is the last thing between a configured kitchen and its listing.
    for (const odd of [null, undefined, "x", 3, {}, { length: 1 }]) {
      expect(
        hasAnyApplicationRequirement({ ...ALL_FOUR_OFF, tier2_custom_fields: odd }),
      ).toBe(false);
    }
  });
});
