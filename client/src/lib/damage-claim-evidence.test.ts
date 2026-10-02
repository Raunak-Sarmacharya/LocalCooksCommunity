import { describe, expect, it } from "vitest";
import {
  damageClaimEvidenceGaps,
  describeMissingDamageClaimEvidence,
  hasRequiredDamageClaimEvidence,
} from "@shared/damage-claim-evidence";

const ev = (...types: string[]) => types.map((evidenceType) => ({ evidenceType }));

describe("damageClaimEvidenceGaps", () => {
  it("reports every category missing for a claim with no evidence", () => {
    expect(damageClaimEvidenceGaps([])).toEqual({
      beforePhoto: true,
      afterPhoto: true,
      costDocument: true,
    });
  });

  it("does not treat two photos as enough without a cost document", () => {
    // The money case: before + after prove the damage, but nothing proves the price.
    expect(hasRequiredDamageClaimEvidence(ev("photo_before", "photo_after"))).toBe(false);
    expect(damageClaimEvidenceGaps(ev("photo_before", "photo_after")).costDocument).toBe(true);
  });

  it("does not let a second after photo stand in for a before photo", () => {
    // Slots are distinct, so this is not a "two pieces of evidence" count.
    expect(hasRequiredDamageClaimEvidence(ev("photo_after", "photo_after", "receipt"))).toBe(false);
  });

  it("accepts a before photo, an after photo and a receipt", () => {
    expect(hasRequiredDamageClaimEvidence(ev("photo_before", "photo_after", "receipt"))).toBe(true);
  });

  it("accepts an invoice as the cost document", () => {
    // The evidence picker labels `invoice` as "Invoice / Quote", so it covers estimates too.
    expect(hasRequiredDamageClaimEvidence(ev("photo_before", "photo_after", "invoice"))).toBe(true);
  });

  it("ignores unrelated evidence types", () => {
    expect(hasRequiredDamageClaimEvidence(ev("video", "document", "third_party_report"))).toBe(false);
  });

  it("handles null and undefined evidence without throwing", () => {
    expect(hasRequiredDamageClaimEvidence(null)).toBe(false);
    expect(hasRequiredDamageClaimEvidence(undefined)).toBe(false);
  });
});

describe("describeMissingDamageClaimEvidence", () => {
  it("names only what is actually missing", () => {
    expect(describeMissingDamageClaimEvidence(ev("photo_before"))).toEqual([
      "an after photo",
      "a receipt or invoice/quote",
    ]);
  });

  it("returns nothing when the claim is ready to submit", () => {
    expect(describeMissingDamageClaimEvidence(ev("photo_before", "photo_after", "receipt"))).toEqual([]);
  });
});
