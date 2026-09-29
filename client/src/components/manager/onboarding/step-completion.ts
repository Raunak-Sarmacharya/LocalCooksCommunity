/**
 * Manager onboarding step completion — the single owner of "is this step behind the manager?".
 *
 * ## Why this file exists
 *
 * The wizard and the dashboard each decided this for themselves, over the same stored record
 * (`users.manager_onboarding_steps_completed`), and normalised it DIFFERENTLY:
 *
 * - the wizard decoded legacy `step_3` keys and stripped `_location_<id>` suffixes;
 * - `use-onboarding-status` regexed the RAW map, decoded nothing, and OR'd a different set of
 *   data flags in.
 *
 * Same record, two answers. The wizard's rail could tick a step while the dashboard's banner still
 * asked for it, and vice versa — and a legacy key was silently ignored by one reader and honoured
 * by the other. The predicates below were already written and exported for exactly this reason (see
 * their individual notes); the dashboard hook was simply the reader that never called them.
 *
 * So: the rules AND the normaliser they depend on live here, and both readers import them. Neither
 * can drift from the other now, because there is only one of each.
 *
 * ## The two things this file deliberately does NOT do
 *
 * - It does not read `managerOnboardingCompleted`. That flag means "onboarding is over", not "this
 *   step is done", and short-circuiting every row on it is how the dashboard came to claim
 *   everything was complete while the wizard still showed gaps. Callers that need it apply it at
 *   their own boundary, where the distinction is theirs to make.
 * - It does not treat "a row exists" as "the step is done". `hasRequirements` and
 *   `dbCompletedSteps` are different facts — see `isRequirementsStepBehindUs`.
 */

// Step ID mapping for backwards compatibility with legacy numeric format in database
// MUST match the order in onboarding-steps.ts
//
// 5 and 6 are deliberately MISSING. They were 'equipment-listings' and 'storage-listings'
// until those merged into 'create-kitchen' (2026-09-19). The numbers are not reused:
// rows written before the merge are keyed `step_5` / `step_6`, and handing those numbers
// to payment-setup / completion-summary would decode a manager's stored progress as two
// steps they never took. A number with no entry here is DROPPED by the normaliser below,
// which is the right outcome — those two only ever recorded "the manager has seen this
// optional step", and the step no longer exists to be seen.
export const STEP_ID_MAP: Record<string, number> = {
  'welcome': 0,
  'location': 1,
  'create-kitchen': 2,
  'availability': 3,
  'application-requirements': 4,
  'payment-setup': 7,
  'completion-summary': 8
};

export const NUMERIC_TO_STRING_MAP: Record<number, string> = Object.entries(STEP_ID_MAP)
  .reduce((acc, [str, num]) => ({ ...acc, [num]: str }), {});

/** The location fields this rule reads, kept loose so a DB row or a DTO both fit. */
export interface LocationLike {
  id: number;
  kitchenLicenseUrl?: string | null;
  kitchen_license_url?: string | null;
}

/**
 * The stored step record, normalised to plain step ids.
 *
 * Returns `null` when there is nothing to normalise, and that is not a detail: the caller keeps
 * whatever it already had. Returning `{}` instead would CLEAR a loaded record the moment the
 * profile query briefly reported nothing, unticking every step the manager had finished.
 *
 * Two normalisations, both of which the dashboard hook used to skip:
 *
 * 1. **Legacy numeric keys** — `step_3`, `step_3_location_28`. Decoded through
 *    `NUMERIC_TO_STRING_MAP`. A number with no entry (5 and 6) is dropped, deliberately.
 * 2. **The location suffix** — `create-kitchen_location_28` also sets the generic
 *    `create-kitchen`. `saveAndExit` writes the suffixed form, and every reader asks for the
 *    generic one; without this the key is written and never read.
 */
export function normalizeCompletedSteps(
  raw: Record<string, boolean> | null | undefined,
): Record<string, boolean> | null {
  if (!raw) return null;

  const normalized: Record<string, boolean> = {};

  for (const [key, value] of Object.entries(raw)) {
    const legacy = key.match(/^step_(\d+)(?:_location_\d+)?$/);
    if (legacy) {
      const stringId = NUMERIC_TO_STRING_MAP[parseInt(legacy[1], 10)];
      if (stringId && !normalized[stringId]) {
        normalized[stringId] = Boolean(value);
      }
      continue;
    }

    normalized[key] = Boolean(value);

    const suffixed = key.match(/^(.+)_location_\d+$/);
    if (suffixed && !normalized[suffixed[1]]) {
      normalized[suffixed[1]] = Boolean(value);
    }
  }

  return normalized;
}

/**
 * Whether the Business & licence step is BEHIND the manager.
 *
 * Exported and pure for the same reason `isAvailabilityStepBehindUs` is: it has ONE answer and every
 * surface must read the same one, and a pure function is the only shape a test can pin without
 * rendering the whole provider.
 *
 * The bug it now closes (2026-09-28): the durable-record fallback was guarded by
 * `dbCompletedSteps['location']` ALONE, so it fired for a manager who genuinely has NO location —
 * any stale `location` key in `managerOnboardingStepsCompleted` made the step read complete for
 * ever. The wizard's resume then skipped past Business straight to `create-kitchen`, and a host who
 * had never typed a single business detail was shown the kitchen-listing step with Business ticked
 * behind them.
 *
 * `isLoadingLocations` is what makes that fallback a RACE fix rather than a permanent override —
 * which is what its own comment always claimed it was. Once the list has loaded, an EMPTY LIST IS
 * THE ANSWER: no location, so the step is not done.
 */
export function isLocationStepBehindUs(input: {
  isLoadingLocations: boolean;
  selectedLocationId: number | null | undefined;
  locations: LocationLike[];
  dbCompletedSteps: Record<string, boolean>;
  isAddingLocation: boolean;
}): boolean {
  if (input.selectedLocationId && input.locations.length > 0) {
    const selected = input.locations.find((loc) => loc.id === input.selectedLocationId);
    // Primary: the licence is on the record. Secondary: the durable flag, which covers the race
    // during a save. Both are about a location that EXISTS.
    const hasLicense = selected?.kitchenLicenseUrl || selected?.kitchen_license_url;
    return Boolean(hasLicense || input.dbCompletedSteps['location']);
  }

  // Only while the list is still loading may the flag stand in for the data. `isAddingLocation` is
  // excluded so a previous location's completion cannot count for the new one being created.
  return (
    input.isLoadingLocations &&
    Boolean(input.dbCompletedSteps['location']) &&
    !input.isAddingLocation
  );
}

/**
 * Whether the Availability step is behind the manager.
 *
 * Three ways in, one meaning out — a saved schedule, the review being reached this session, or the
 * durable record. The durable record is the one that survives a reload, which is why the wizard
 * cannot rely on its own React state alone: `availabilityStepCompleted` is reset by a remount and
 * the step, and which is what made the rail tick vanish while the manager was mid-wizard.
 *
 * This is for ONBOARDING progress, not bookability. A kitchen with no opening hours still
 * cannot be listed (`listingReq_availability` is "Opening hours"), and that gate reads the
 * data flag, not this.
 *
 * Exported and pure because this rule was spelled out in three separate readers and one of
 * them drifted: the setup summary kept the `hasAvailability`-only version, so a manager who
 * skipped the schedule saw the rail tick, then a summary and a dashboard banner both saying
 * availability was still missing (2026-09-26).
 */
export function isAvailabilityStepBehindUs(input: {
  hasAvailability?: boolean;
  availabilityStepCompleted?: boolean;
  dbCompletedSteps?: Record<string, boolean>;
}): boolean {
  return Boolean(
    input.hasAvailability ||
      input.availabilityStepCompleted ||
      input.dbCompletedSteps?.['availability'],
  );
}

/**
 * Whether the Requirements step is behind the manager.
 *
 * Two ways in, one meaning out. A saved `location_requirements` row is the obvious one; the
 * other is that the manager reached the step's REVIEW and accepted what it showed them.
 *
 * The review IS the decision. This pane ships with the platform defaults already filled in,
 * so the common case is a manager who reads them, changes nothing, and moves on — and for
 * them no row is ever written. `hasRequirements` means "a row exists" (`id > 0`), which is
 * why reading it alone left the sidebar unticked and the dashboard banner still asking for a
 * step that had been completed, the same loop `isAvailabilityStepBehindUs` above was written
 * to end.
 *
 * What it does NOT mean: that the manager has customised anything. Nothing downstream reads
 * this as a claim about the requirements' CONTENT; the chef-facing application reads the
 * saved row (or the defaults) directly.
 */
export function isRequirementsStepBehindUs(input: {
  hasRequirements?: boolean;
  dbCompletedSteps?: Record<string, boolean>;
}): boolean {
  return Boolean(
    input.hasRequirements || input.dbCompletedSteps?.['application-requirements'],
  );
}

/**
 * The two Stripe facts, derived in ONE place from the status endpoint's payload.
 *
 * They answer different questions and must never be collapsed into one flag:
 *
 * - `connected` — the account can take and send money (`charges` AND `payouts` enabled).
 *   This is the strict fact. The dashboard's Getting Started checklist, and the gates on
 *   listing or booking a kitchen, read this and nothing else.
 * - `initiated` — the manager has finished THEIR part: they submitted Stripe's onboarding
 *   form and the account is now with Stripe. This is what the wizard gates on.
 *
 * Why they are separate: full verification takes Stripe days to a week, and it is not ours
 * to make. Gating "finish setup" on it left a manager stuck on the last onboarding step
 * until a bank check cleared. Gating nothing on it is the opposite mistake — a manager would
 * be told they can be paid when they cannot. So: setup completes on `initiated`, and every
 * money-facing surface still reads `connected`.
 *
 * `detailsSubmitted` is Stripe's own signal (the status endpoint copies it off the account
 * object, and the server flips `status` to "pending" at that same moment). An account that
 * was created but whose form was abandoned is `detailsSubmitted: false` — correctly still
 * "not done", because there is nothing for Stripe to review yet.
 *
 * `connected` implies `detailsSubmitted`, so a fully verified account satisfies both.
 */
export function resolveStripeState(
  status: { status?: string; chargesEnabled?: boolean; payoutsEnabled?: boolean; detailsSubmitted?: boolean } | null | undefined,
): { connected: boolean; initiated: boolean } {
  const connected =
    status?.status === "complete" && status?.chargesEnabled === true && status?.payoutsEnabled === true;
  const initiated = connected || status?.detailsSubmitted === true;
  return { connected, initiated };
}
