/**
 * What a kitchen needs before a chef should be able to find it.
 *
 * Two lists, deliberately different:
 *
 * - **requirements** block publishing. Each one makes the listing unbookable or broken if it is
 *   missing — a kitchen with no rate prices at $0, one with no availability has no slots to pick.
 * - **recommendations** never block. They are things a chef will look for and won't find, so the
 *   manager should know before going live, not after.
 *
 * The split is the point: a bare list of "things to do" gets ignored, and a list that blocks on
 * everything is a wall. Peerspace separates them the same way — its go-live requirements are one
 * document, its "tips to improve" another.
 *
 * Returns IDS, not sentences. The caller owns the wording, the reason and the locale, because the
 * reason is what makes a recommendation worth acting on ("3x more likely to book" beats "add
 * photos"). Nothing here is i18n-aware on purpose.
 */
export type ListingRequirementId =
  | "description"
  | "rate"
  | "license"
  | "availability"
  | "coverPhoto"
  | "stripe"
  | "applicationRequirements"
  /**
   * Booking rules cannot be UNSET — the columns are NOT NULL with defaults — so this never blocks in
   * practice. It is a requirement anyway because the values are what a chef is agreeing to, and a
   * manager should see and confirm them before the listing goes in front of anyone. A requirement
   * that is always satisfied still belongs in the "before you list" list; it does not belong in a
   * suggestions list that only exists to nudge.
   */
  | "bookingRules";

/**
 * A LOCATION is deliberately not a requirement.
 *
 * `kitchens.locationId` is NOT NULL and its foreign key has no `onDelete`, so a location cannot be
 * deleted while a kitchen points at it. A kitchen therefore always has one, and a "Location" row
 * could never be anything but satisfied — a row that can only ever show a tick teaches a manager to
 * skim the list. The location is CONTEXT instead: it belongs in the heading that says which kitchen
 * and where, not in a checklist of things to do.
 */
export type ListingRecommendationId =
  | "gallery"
  | "equipment"
  | "storage"
  | "tours"
  | "terms";

export interface ListingReadinessInput {
  hasDescription: boolean;
  /** An hourly OR a daily rate. Without either, checkout prices the booking at zero. */
  hasRate: boolean;
  /** The location's licence is approved and unexpired — the admin-reviewed gate. */
  licenseApproved: boolean;
  /** At least one day of opening hours, otherwise there is nothing to book. */
  hasAvailability: boolean;
  /** The cover image, which is what the chef's discovery card renders. */
  hasCoverPhoto: boolean;
  stripeConnected: boolean;
  hasApplicationRequirements: boolean;

  hasGalleryImages: boolean;
  hasTerms: boolean;
  toursEnabled: boolean;
  hasBookingRules: boolean;
  /**
   * Add-ons a chef can buy alongside the kitchen.
   *
   * Suggestions rather than requirements: a kitchen with neither is perfectly bookable. But Peerspace
   * lists creating add-ons under Booking Conversion tips ("offer food, beverage, service, or
   * equipment packages"), so they are worth pointing at rather than leaving the manager to discover.
   */
  hasEquipment: boolean;
  hasStorage: boolean;
}

export interface ListingChecklist {
  requirements: Array<{ id: ListingRequirementId; met: boolean }>;
  recommendations: Array<{ id: ListingRecommendationId; met: boolean }>;
  /** True only when every requirement is met. Recommendations never affect this. */
  canPublish: boolean;
  missingRequirementIds: ListingRequirementId[];
  openRecommendationIds: ListingRecommendationId[];
}

/**
 * Every requirement, in the order the manager should fix them: the blocking-and-structural ones
 * first, the paperwork last, and booking rules at the end because they are a confirmation rather
 * than a gap.
 */
const REQUIREMENT_ORDER: ListingRequirementId[] = [
  "description",
  "rate",
  "availability",
  "coverPhoto",
  "stripe",
  "applicationRequirements",
  "license",
  "bookingRules",
];

const RECOMMENDATION_ORDER: ListingRecommendationId[] = [
  "gallery",
  "equipment",
  "storage",
  "tours",
  "terms",
];

export function buildListingChecklist(input: ListingReadinessInput): ListingChecklist {
  const requirementMet: Record<ListingRequirementId, boolean> = {
    description: input.hasDescription,
    rate: input.hasRate,
    license: input.licenseApproved,
    availability: input.hasAvailability,
    coverPhoto: input.hasCoverPhoto,
    stripe: input.stripeConnected,
    applicationRequirements: input.hasApplicationRequirements,
    bookingRules: input.hasBookingRules,
  };

  const recommendationMet: Record<ListingRecommendationId, boolean> = {
    gallery: input.hasGalleryImages,
    equipment: input.hasEquipment,
    storage: input.hasStorage,
    tours: input.toursEnabled,
    terms: input.hasTerms,
  };

  const requirements = REQUIREMENT_ORDER.map((id) => ({ id, met: requirementMet[id] }));
  const recommendations = RECOMMENDATION_ORDER.map((id) => ({ id, met: recommendationMet[id] }));

  const missingRequirementIds = requirements.filter((r) => !r.met).map((r) => r.id);

  return {
    requirements,
    recommendations,
    canPublish: missingRequirementIds.length === 0,
    missingRequirementIds,
    openRecommendationIds: recommendations.filter((r) => !r.met).map((r) => r.id),
  };
}
