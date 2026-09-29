import type { ListingChecklist, ListingRecommendationId } from "@shared/kitchen-listing-readiness";

/**
 * The manager dashboard's Getting Started list — its OWN model, deliberately not the wizard's.
 *
 * WHY THIS IS NOT `use-onboarding-status`
 *
 * Getting Started used to be a second rendering of the onboarding wizard: `buildManagerSetupSteps`
 * produced one list, and BOTH the dashboard's setup banner and the sidebar checklist read it. Two
 * consequences followed, and both were wrong:
 *
 *   1. The checklist's rows WERE the wizard's chores (licence, availability, requirements), so it
 *      disappeared the moment the last one ticked — i.e. exactly when it stopped being about the
 *      wizard and could have started being about the business.
 *   2. Those rows are now HARD GATES inside the kitchen listing flow, which re-derives them
 *      server-side and refuses to publish until they pass. Listing them again here duplicated the
 *      gate and, worse, let the two drift.
 *
 * So this module answers a different question: **what does a new host do to reach their first real
 * outcome?** Not "which wizard steps are done".
 *
 * THE THREE STAGES
 *
 *   get-set-up  — the gateway. Shown while setup is unfinished, and while the phone is unverified,
 *                 because verifying it is available from the very first screen. Nothing else is
 *                 shown: with no location and no kitchen every other row would name work the host
 *                 cannot do yet. (This was a real bug — a host who left the wizard on its first step
 *                 was being told to "publish your kitchen" with nothing to publish.)
 *   get-live    — setup done. These two are what actually make the host live: Stripe so they can be
 *                 paid, and publishing so cooks can find them. Both are REQUIRED, which is why the
 *                 "good to have" rows are not in here.
 *   get-booked  — a kitchen is LIVE. The polish rows plus the outcome they lead to.
 *
 * The stage boundaries are the host's real stages, not the wizard's step names, and each reveal is
 * gated on a milestone the host EARNED — never on a row they might never complete. That distinction
 * matters: gating a reveal on "has verified their phone" would strand a host with a published
 * kitchen on the previous stage for ever.
 *
 * ROWS THAT DELIBERATELY DO NOT EXIST
 *
 *   - "Verify your email" — an unverified account cannot hold a session, so the row could never be
 *     open. It was in the old list and was permanently ticked.
 *   - "Add your name and photo" — there is no manager avatar upload anywhere (`PUT /api/manager/profile`
 *     accepts only `displayName` and `phone`), and `displayName` is captured at registration, so a
 *     name-only row would be ticked on arrival.
 *   - "Add a phone number" — it existed, and it was wrong twice over. The phone is REQUIRED at
 *     registration (`phone: phoneNumberSchema`, no `.optional()`), so there is nothing to add; the
 *     action is to VERIFY it. And the row it replaced ("Add a backup sign-in") TICKED ITSELF ON
 *     ARRIVAL, because `resolveAuthMethods` counts `email-link` for any account with an address — so
 *     a Google registration returned two methods and the row read as done before the host had done
 *     anything. Verifying a phone always starts unchecked, because nothing is proved at registration.
 *   - "Terms & conditions" — collected during onboarding, so normally already met.
 *   - The readiness REQUIREMENTS (description, rate, availability, cover photo, licence, application
 *     requirements, booking rules) — they block publishing, so they belong inside the publish row,
 *     where the host is already being shown them one at a time.
 *
 * This list is ACCOUNT-LEVEL and one-time. It never restarts for a second kitchen: by then the host
 * has learned the pattern, and kitchen #2's polish is covered, per-kitchen, by the listing review.
 */
export type GettingStartedPhaseId = "get-set-up" | "get-live" | "get-booked";

export type GettingStartedItemId =
  | "finish-setup"
  | "phone"
  | "stripe"
  | "publish-kitchen"
  | "photos"
  | "tours"
  | "equipment"
  | "storage"
  | "first-booking";

export interface GettingStartedItem {
  id: GettingStartedItemId;
  phase: GettingStartedPhaseId;
  /** Label key in the `manager` i18n namespace. */
  labelKey: string;
  /** One-line reason, same namespace. `null` when the row needs no explanation. */
  descriptionKey: string | null;
  /**
   * `task` rows are actionable and render as buttons. `milestone` rows happen TO the host and have
   * no control to offer — rendering one as a button would be the "to-do the product refuses to
   * assist with" anti-pattern, so a milestone is deliberately inert.
   */
  kind: "task" | "milestone";
  complete: boolean;
}

/** Render order: the three real stages of a host's life, not an arbitrary grouping. */
export const GETTING_STARTED_PHASES: GettingStartedPhaseId[] = [
  "get-set-up",
  "get-live",
  "get-booked",
];

export const GETTING_STARTED_PHASE_LABEL_KEYS: Record<GettingStartedPhaseId, string> = {
  "get-set-up": "gettingStartedPhaseGetSetUp",
  "get-live": "gettingStartedPhaseGetLive",
  "get-booked": "gettingStartedPhaseGetBooked",
};

/** What the host's account looks like right now — the boundaries the reveal turns on. */
export interface GettingStartedStage {
  /** Setup is behind them: the wizard's own verdict, so this list and the banner cannot disagree. */
  isSetupComplete: boolean;
  /** A phone number has been PROVED, which is the only thing that makes it usable as a sign-in. */
  phoneVerified: boolean;
  /** At least one kitchen is live to cooks (`listing_status === 'active'`). */
  isLive: boolean;
}

/**
 * Whether a ROW is shown at all.
 *
 * Visibility is a property of the row, not of its group. Grouping is presentation; a row's relevance
 * is its own, and the two only coincided while every row in a phase happened to share one rule.
 * Making it per-row is what lets the gateway retire while the phone row beside it stays — and it is
 * what stops the reveal from being gated on a row the host might never finish.
 *
 * The rules, and why each is what it is:
 *
 * - `finish-setup` — a GATEWAY, not a task. Once setup is behind them there is nothing to tick and
 *   nothing to do, so it goes rather than lingering as a permanent "✓" nobody can act on.
 * - `phone` — always shown. It is account-level, available from the very first screen, and it must
 *   not vanish with the gateway row beside it.
 * - `stripe` / `publish-kitchen` — shown once setup is done. These two are what actually make the
 *   host live, which is why nothing optional sits in their group.
 * - the polish rows and the outcome — shown once a kitchen is LIVE. They are all about a listing
 *   cooks can actually see, and "take your first booking" is unreachable before that.
 *
 * NOTE what the `get-booked` rule does NOT depend on: the phone. Gating it on "all of the live rows
 * done" would strand a host whose kitchen is published but whose phone is unproved — they would never
 * see the stage that follows. Every reveal is gated on a milestone the host EARNED, never on a row
 * they might never complete.
 */
export function isItemVisible(id: GettingStartedItemId, stage: GettingStartedStage): boolean {
  switch (id) {
    case "finish-setup":
      return !stage.isSetupComplete;
    case "phone":
      return true;
    case "stripe":
    case "publish-kitchen":
      return stage.isSetupComplete;
    case "photos":
    case "tours":
    case "equipment":
    case "storage":
    case "first-booking":
      return stage.isSetupComplete && stage.isLive;
  }
}

export function visibleGettingStartedItems(
  items: GettingStartedItem[],
  stage: GettingStartedStage,
): GettingStartedItem[] {
  return items.filter((item) => isItemVisible(item.id, stage));
}

export interface GettingStartedInput {
  /** Setup is behind them — the wizard's verdict, passed in rather than derived here. */
  isSetupComplete: boolean;
  /**
   * A phone number has been PROVED, which is the only thing that makes it a usable sign-in method.
   *
   * A number merely stored on the profile is not proof — and the number itself is guaranteed,
   * because registration requires one.
   */
  phoneVerified: boolean;
  /** Stripe charges AND payouts enabled — the account can actually be paid, not merely submitted. */
  stripeConnected: boolean;
  /** At least one kitchen is live to cooks (`listing_status === 'active'`). */
  hasPublishedKitchen: boolean;
  /**
   * The PRIMARY kitchen's listing readiness, or `null` when there is no kitchen to judge yet.
   *
   * Read from `buildKitchenReadiness`'s payload — the same object the listing review renders — so a
   * row here and a row there can never tell a host different things about their own kitchen.
   */
  readiness: ListingChecklist | null;
  /** At least one booking has been confirmed. */
  hasConfirmedBooking: boolean;
}

/**
 * Whether one of the readiness RECOMMENDATIONS is satisfied.
 *
 * Recommendations never block publishing (see `@shared/kitchen-listing-readiness`), which is exactly
 * why they are the ones that belong here: they are improvements, not gates.
 *
 * `null` readiness means "there is no kitchen yet", which must read as NOT met — an unloaded or
 * absent answer is not a satisfied one.
 */
function recommendationMet(
  readiness: ListingChecklist | null,
  id: ListingRecommendationId,
): boolean {
  if (!readiness) return false;
  return readiness.recommendations.some((entry) => entry.id === id && entry.met);
}

export function buildGettingStartedItems(input: GettingStartedInput): GettingStartedItem[] {
  return [
    {
      id: "finish-setup",
      phase: "get-set-up",
      labelKey: "gettingStartedFinishSetup",
      descriptionKey: "gettingStartedFinishSetupDesc",
      kind: "task",
      complete: input.isSetupComplete,
    },
    {
      id: "phone",
      phase: "get-set-up",
      labelKey: "gettingStartedPhone",
      descriptionKey: "gettingStartedPhoneDesc",
      kind: "task",
      // A PROVED number, not a stored one. The number itself is guaranteed — registration requires
      // it — so the only open state is "not yet verified", which is why this row can never arrive
      // already ticked.
      complete: input.phoneVerified,
    },
    {
      id: "stripe",
      phase: "get-live",
      labelKey: "gettingStartedStripe",
      descriptionKey: "gettingStartedStripeDesc",
      kind: "task",
      complete: input.stripeConnected,
    },
    {
      id: "publish-kitchen",
      phase: "get-live",
      labelKey: "gettingStartedPublish",
      descriptionKey: "gettingStartedPublishDesc",
      kind: "task",
      complete: input.hasPublishedKitchen,
    },
    {
      id: "photos",
      phase: "get-booked",
      labelKey: "gettingStartedPhotos",
      descriptionKey: "gettingStartedPhotosDesc",
      kind: "task",
      complete: recommendationMet(input.readiness, "gallery"),
    },
    {
      id: "tours",
      phase: "get-booked",
      labelKey: "gettingStartedTours",
      descriptionKey: "gettingStartedToursDesc",
      kind: "task",
      complete: recommendationMet(input.readiness, "tours"),
    },
    {
      // Equipment and storage are SEPARATE rows on purpose. They are separate features with separate
      // pages and separate reasons to say yes, and one row for both left a host who offered only one
      // of them reading a combined label that named the other.
      id: "equipment",
      phase: "get-booked",
      labelKey: "gettingStartedEquipment",
      descriptionKey: "gettingStartedEquipmentDesc",
      kind: "task",
      complete: recommendationMet(input.readiness, "equipment"),
    },
    {
      id: "storage",
      phase: "get-booked",
      labelKey: "gettingStartedStorage",
      descriptionKey: "gettingStartedStorageDesc",
      kind: "task",
      complete: recommendationMet(input.readiness, "storage"),
    },
    {
      id: "first-booking",
      phase: "get-booked",
      labelKey: "gettingStartedFirstBooking",
      descriptionKey: "gettingStartedFirstBookingDesc",
      // A MILESTONE, not a task: no control exists that makes a cook book, so offering a button
      // would be a promise the row cannot keep.
      kind: "milestone",
      complete: input.hasConfirmedBooking,
    },
  ];
}

export interface GettingStartedSummary {
  items: GettingStartedItem[];
  completed: number;
  total: number;
  /** The first open row — what a launcher points at. `null` when everything shown is done. */
  nextItem: GettingStartedItem | null;
  /** Every VISIBLE row is done, so the checklist retires. */
  isComplete: boolean;
}

export function summarizeGettingStarted(items: GettingStartedItem[]): GettingStartedSummary {
  const completed = items.filter((item) => item.complete).length;
  return {
    items,
    completed,
    total: items.length,
    nextItem: items.find((item) => !item.complete) ?? null,
    // `total === 0` is NOT "complete" — an empty list is a failure to load, and treating it as done
    // would silently hide the checklist instead of surfacing a broken state.
    isComplete: items.length > 0 && completed === items.length,
  };
}
