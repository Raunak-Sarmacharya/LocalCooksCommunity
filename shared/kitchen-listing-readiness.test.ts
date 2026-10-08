import { describe, expect, it } from "vitest";
import {
  buildListingChecklist,
  type ListingReadinessInput,
} from "./kitchen-listing-readiness";

/** Everything done. Each test knocks out exactly one thing. */
const READY: ListingReadinessInput = {
  hasDescription: true,
  hasRate: true,
  licenseApproved: true,
  hasAvailability: true,
  hasCoverPhoto: true,
  stripeConnected: true,
  hasApplicationRequirements: true,
  hasVisitSetup: true,
  hasGalleryImages: true,
  hasTerms: true,
  toursEnabled: true,
  hasBookingRules: true,
  hasEquipment: true,
  hasStorage: true,
  hasStorageVisitSetup: true,
};

describe("buildListingChecklist", () => {
  it("publishes when every requirement is met", () => {
    const checklist = buildListingChecklist(READY);
    expect(checklist.canPublish).toBe(true);
    expect(checklist.missingRequirementIds).toEqual([]);
    expect(checklist.openRecommendationIds).toEqual([]);
    expect(checklist.requirements.every((r) => r.met)).toBe(true);
  });

  it("names every requirement that is missing", () => {
    const checklist = buildListingChecklist({
      ...READY,
      hasDescription: false,
      hasRate: false,
      hasCoverPhoto: false,
    });
    expect(checklist.canPublish).toBe(false);
    // Ordered as the manager should fix them, not as they were passed in.
    expect(checklist.missingRequirementIds).toEqual(["description", "rate", "coverPhoto"]);
  });

  it("blocks on a missing rate, because checkout would price the booking at zero", () => {
    const checklist = buildListingChecklist({ ...READY, hasRate: false });
    expect(checklist.canPublish).toBe(false);
    expect(checklist.missingRequirementIds).toEqual(["rate"]);
  });

  it('allows publishing with Kitchen Tours off while retaining it as a recommendation', () => {
    const checklist = buildListingChecklist({ ...READY, toursEnabled: false });
    expect(checklist.canPublish).toBe(true);
    expect(checklist.missingRequirementIds).toEqual([]);
    expect(checklist.openRecommendationIds).toEqual(['tours']);
    expect(checklist.requirements.some(row => String(row.id) === 'tours')).toBe(false);
  });

  it("requires visit setup independently of optional listing recommendations", () => {
    const checklist = buildListingChecklist({ ...READY, hasVisitSetup: false });
    expect(checklist.canPublish).toBe(false);
    expect(checklist.missingRequirementIds).toEqual(["visitSetup"]);
    expect(checklist.openRecommendationIds).not.toContain("visitSetup");
  });

  it("blocks on a missing licence — the one gate an admin reviews", () => {
    const checklist = buildListingChecklist({ ...READY, licenseApproved: false });
    expect(checklist.canPublish).toBe(false);
    expect(checklist.missingRequirementIds).toEqual(["license"]);
  });

  it("never blocks on a recommendation", () => {
    const checklist = buildListingChecklist({
      ...READY,
      hasGalleryImages: false,
      hasTerms: false,
      toursEnabled: false,
      hasEquipment: false,
      hasStorage: false,
    });

    // The whole point of the split: five open suggestions, and it still publishes.
    expect(checklist.canPublish).toBe(true);
    expect(checklist.missingRequirementIds).toEqual([]);
    expect(checklist.openRecommendationIds).toEqual(["gallery", "equipment", "storage", "tours", "terms"]);
  });

  it("treats booking rules as a requirement even though they cannot be unset", () => {
    // `hasBookingRules` is always true in practice — the columns are NOT NULL with defaults — but it
    // is a requirement so it appears in the "before you list" review rather than as a suggestion.
    const checklist = buildListingChecklist({ ...READY, hasBookingRules: false });
    expect(checklist.missingRequirementIds).toEqual(["bookingRules"]);
    expect(checklist.openRecommendationIds).not.toContain("bookingRules");
  });

  it("separates the two lists even when both are empty of successes", () => {
    const checklist = buildListingChecklist({
      hasDescription: false,
      hasRate: false,
      licenseApproved: false,
      hasAvailability: false,
      hasCoverPhoto: false,
      stripeConnected: false,
      hasApplicationRequirements: false,
      hasVisitSetup: false,
      hasGalleryImages: false,
      hasTerms: false,
      toursEnabled: false,
      hasBookingRules: false,
      hasEquipment: false,
      hasStorage: false,
    });
    expect(checklist.canPublish).toBe(false);
    expect(checklist.missingRequirementIds).toHaveLength(9);
    expect(checklist.openRecommendationIds).toHaveLength(5);
    // Recommendations are reported on their own list, never folded into the blockers.
    expect(checklist.missingRequirementIds).not.toContain("gallery");
    expect(checklist.missingRequirementIds).not.toContain("terms");
  });

  it("always reports the full checklist, so the review screen can show what is already done", () => {
    const checklist = buildListingChecklist({ ...READY, hasTerms: false });
    expect(checklist.requirements).toHaveLength(10);
    expect(checklist.recommendations).toHaveLength(5);
  });
});

it('requires storage setup only for kitchens with storage listings', () => {
  const withStorage = buildListingChecklist({ ...READY, hasStorageVisitSetup: false });
  expect(withStorage.missingRequirementIds).toEqual(['storageVisitSetup']);
  expect(withStorage.canPublish).toBe(false);
  const noStorage = buildListingChecklist({ ...READY, hasStorage: false, hasStorageVisitSetup: false });
  expect(noStorage.requirements.some(row => row.id === 'storageVisitSetup')).toBe(false);
  expect(noStorage.canPublish).toBe(true);
});
