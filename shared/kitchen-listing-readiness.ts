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
  /**
   * Whether the chef's application asks for AT LEAST ONE thing.
   *
   * Deliberately NOT "a requirements row exists". A kitchen with no saved row is not
   * under-configured: the server resolves its requirements with
   * `getLocationRequirementsWithDefaults`, and the platform defaults turn several asks ON
   * (`requireEmail`, `requireFoodHandlerCert`, `tier2_food_establishment_cert_required`, …), so
   * a chef applying there is asked for exactly as much as the platform requires of everyone.
   *
   * What IS broken is a saved row with everything switched off: the chef is asked for nothing,
   * so the manager has nothing to assess them on and the listing is not worth publishing. That
   * is the one case this blocks.
   *
   * Reading the row's EXISTENCE instead blocked every kitchen whose manager accepted the
   * pre-filled defaults without touching a switch — leaving publishing impossible for a
   * requirement that was already satisfied (2026-09-26).
   */
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

/**
 * The ask fields a MANAGER owns — the four document switches `RequirementsStepTwo` renders.
 *
 * This is what "the application asks for at least one thing" is measured against. A flag that
 * is ON means the chef must supply that document.
 *
 * **Why only four, and why that is the whole point.** This list used to carry the thirteen
 * tier-1 applicant fields as well (`requireFirstName`, `requireEmail`, `requireUsageFrequency`,
 * …). Those are the PLATFORM's questions: they are set by an admin in
 * `PlatformRequirementsSection` (which writes `platform_settings`, not this row), they have no
 * switch anywhere in the manager's wizard, and they default to `true`. Including them made the
 * test unfalsifiable — a manager could switch off all four of the switches they actually own and
 * the predicate still returned `true` on the strength of eleven fields they cannot see or
 * change, so the row read "Set" and the gate could never block. Reported 2026-09-26: "I turned
 * both off and it still says set."
 *
 * It is the same mistake as reading the admin's field list in the requirements review: a test
 * built from fields the reader does not own reports a decision they never made. **A gate must be
 * measured against what the person being gated can actually control.**
 *
 * `requireFoodHandlerExpiry` is deliberately absent: it is not an independent ask. The wizard
 * writes it together with `requireFoodHandlerCert` (one switch, both columns), so counting it
 * would let a single switch register as two asks.
 *
 * `tier2_food_establishment_expiry_required` is absent for the same reason — it travels with
 * `tier2_food_establishment_cert_required`.
 */
export const REQUIREMENT_ASK_FIELDS = [
  "requireFoodHandlerCert",
  "tier2_food_establishment_cert_required",
  "tier2_insurance_document_required",
  "tier2_kitchen_experience_required",
] as const;

export type RequirementAskField = (typeof REQUIREMENT_ASK_FIELDS)[number];

/**
 * Whether the chef's application asks for at least one thing — the rule the listing review
 * blocks on.
 *
 * Four cases, three of which pass:
 *
 *   no row saved               -> the platform DEFAULTS apply, and two of the four switches
 *                                 (`requireFoodHandlerCert`, `tier2_food_establishment_cert_required`)
 *                                 default ON -> true
 *   row saved, >= 1 switch ON  -> the chef is asked for something                   -> true
 *   row saved, 0 switches ON, but >= 1 CUSTOM field defined -> true
 *   row saved, 0 switches ON, 0 custom fields -> the chef is asked for NOTHING      -> false
 *
 * The last case is the only failure, and it is the case the manager can actually create: they
 * switched all four of their own switches off and added no custom questions, so their listing
 * collects no information at all. Everything else is a requirements sheet the manager has
 * effectively accepted.
 *
 * `row` is deliberately loose: the caller may hand it a DB row, a partial, or the default
 * object, and a missing/undefined column is treated as OFF so a partial object cannot pass by
 * accident.
 */
export function hasAnyApplicationRequirement(
  row: Partial<Record<RequirementAskField, unknown>> | null | undefined,
): boolean {
  if (REQUIREMENT_ASK_FIELDS.some((field) => row?.[field] === true)) return true;

  /*
   * The manager's own questions count too.
   *
   * `tier2_custom_fields` is the list the "add a requirement" builder writes — a manager who
   * asks for a business registration number in place of the four built-ins has configured
   * something real, and a gate that ignored it would block a kitchen that asks for plenty.
   * Read defensively: an un-migrated row, `null`, or a JSON scalar must not throw here, because
   * this function is the last thing between a configured kitchen and its listing.
   */
  const custom = (row as { tier2_custom_fields?: unknown } | null | undefined)?.tier2_custom_fields;
  return Array.isArray(custom) && custom.length > 0;
}

/**
 * The subset of `location_requirements` this module reads, declared here rather than imported
 * from `@shared/schema` on purpose: this module is reachable from the CLIENT bundle, and the
 * schema drags Drizzle and the whole table graph in with it. It is a subset, not a copy — the
 * guard below is what keeps it honest.
 *
 * Only the four manager-owned switches need to be here now. The tier-1 applicant columns are
 * still declared because `getLocationRequirementsWithDefaults` hands the whole row in and a
 * future reader may legitimately test them — but they are NOT in `REQUIREMENT_ASK_FIELDS`, and
 * the guard below only enforces the ask fields against this shape.
 */
export interface LocationRequirementsAskShape {
  requireFoodHandlerCert?: boolean;
  tier2_food_establishment_cert_required?: boolean;
  tier2_insurance_document_required?: boolean;
  tier2_kitchen_experience_required?: boolean;
  /** The manager's own questions; an array, so not a boolean like the rest. */
  tier2_custom_fields?: unknown;
}

/**
 * Compile-time guard: every ask field must be a real column name on the shape the server hands in.
 *
 * `hasAnyApplicationRequirement` reads its fields off a LOOSE object, so a name that does not
 * exist on the row reads back `undefined` — which this rule treats as OFF. A typo here would
 * therefore not crash: it would silently drop that field from the "is anything on?" test and
 * block a kitchen that is in fact configured. Failing at compile time instead is the whole point.
 *
 * The test is a FUNCTION because the parameter type is what does the work: `RequirementAskField`
 * must be assignable to the shape's keys, and a stray string in the list widens
 * `RequirementAskField` past `keyof LocationRequirementsAskShape`, so the call below stops
 * compiling and the error names the offender. A bare `const x: Mismatch[] = []` would NOT do
 * this — an empty array is assignable to any array type, so it asserts nothing.
 */
type AskFieldIsReal = RequirementAskField extends keyof LocationRequirementsAskShape ? true : never;
const _ASK_FIELDS_ARE_REAL: AskFieldIsReal = true;
void _ASK_FIELDS_ARE_REAL;

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
