import type { TFunction } from "i18next";
import type { StatusVariant } from "@/components/chef/dashboard/types";

export type StatusTone = "neutral" | "progress" | "success" | "warning" | "danger";

export type KitchenActionKind = "book" | "complete-step" | "discover" | "wait";

/**
 * Translator contract: pass i18next's `t` bound to the "chef" namespace.
 */
export type StatusTranslator = TFunction<"chef", undefined>;

export interface KitchenDisplayStatus {
  label: string;
  tone: StatusTone;
  step: number;
  stepCaption: string;
  actionLabel: string | null;
  actionKind: KitchenActionKind;
  /**
   * The only thing between this chef and a booking is that the manager has taken the listing down.
   *
   * Set only where `actionKind` would otherwise have been `"book"`, so a surface can style this state
   * differently without re-deriving WHY it is in it.
   */
  listingPaused?: boolean;
}

export interface KitchenStatusInput {
  status: string;
  current_tier?: number | null;
  currentTier?: number | null;
  tier2_completed_at?: string | Date | null;
  tier_data?: unknown;
  /**
   * From the chef's application payload. `undefined` means the server did not say — an older payload,
   * or a read that failed — and must behave exactly as it did before the field existed. Test
   * `=== false`, never falsiness.
   */
  locationListed?: boolean | null;
}

const TONE_TO_BADGE: Record<StatusTone, StatusVariant> = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  progress: "outline",
  neutral: "outline",
};

export function toneToBadgeVariant(tone: StatusTone): StatusVariant {
  return TONE_TO_BADGE[tone];
}

export function applicationStatusVariant(status: string): StatusVariant {
  switch (status.toLowerCase().replace(/\s+/g, "")) {
    case "approved":
      return "success";
    case "pending":
    case "inreview":
    case "new":
      return "warning";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function kitchenLocationId(value: {
  locationId?: number | string | null;
  location_id?: number | string | null;
  location?: { id?: number | string | null } | null;
} | null | undefined): number | null {
  if (!value) return null;
  const raw = value.locationId ?? value.location_id ?? value.location?.id;
  const id = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function isActiveKitchenApplication(app: { status?: string | null } | null | undefined): boolean {
  const status = (app?.status || "").toLowerCase().replace(/\s+/g, "");
  return status === "inreview" || status === "approved" || status === "pending";
}

export function applicationTier(app: KitchenStatusInput): number {
  return app.current_tier ?? app.currentTier ?? 1;
}

export function hasStep2BeenSubmitted(app: KitchenStatusInput): boolean {
  if (applicationTier(app) < 2) return false;
  if (app.tier2_completed_at) return true;
  return Boolean(
    app.tier_data &&
      typeof app.tier_data === "object" &&
      "tier2_submitted_at" in app.tier_data &&
      Boolean((app.tier_data as { tier2_submitted_at?: unknown }).tier2_submitted_at)
  );
}

/**
 * What this chef may do at this kitchen, in one place.
 *
 * Seven surfaces render an application — `MyKitchensTabContent`, `OverviewTabContent` (twice),
 * `KitchenApplicationCard`, `SellerApplicationTabContent`, `KitchenDiscovery` and
 * `KitchenPreviewPage` — and each used to decide for itself whether to offer a Book action. That is
 * how the chef dashboard kept offering "book" for a kitchen whose manager had taken the listing down:
 * this state machine knew nothing about listings, and exactly one surface had been taught to look.
 * So the listing is folded in HERE, once, and nowhere else.
 *
 * It is applied as a POST-STEP deliberately. The manager's listing flag is orthogonal to the chef's
 * progress: a delisted kitchen changes exactly one thing — the chef cannot book — and must not disturb
 * Step 2, "Continue", or any in-review state. Someone mid-application has to be able to finish it and
 * meet the wall only at the point of booking, which is the whole reason the application gate and the
 * booking gate are separate.
 *
 * `app.locationListed === false` is tested explicitly, never for falsiness: `undefined` means the
 * server did not say (an older payload, or a failed read) and must behave exactly as before.
 */
export function getKitchenDisplayStatus(
  app: KitchenStatusInput,
  t?: StatusTranslator
): KitchenDisplayStatus {
  const display = resolveApplicationDisplay(app, t);

  if (display.actionKind !== "book" || app.locationListed !== false) {
    return display;
  }

  const label = t
    ? t("apptabKitchenPausedChip", { defaultValue: "Not taking bookings" })
    : "Not taking bookings";

  return {
    ...display,
    label,
    tone: "warning",
    actionLabel: label,
    actionKind: "wait",
    listingPaused: true,
  };
}

/**
 * The application's own state, with no knowledge of listings.
 *
 * Private on purpose: `getKitchenDisplayStatus` is the single entry point, so a caller cannot pick
 * the half of the answer that forgets the listing.
 */
function resolveApplicationDisplay(
  app: KitchenStatusInput,
  t?: StatusTranslator
): KitchenDisplayStatus {
  const tr = (key: string, fallback: string, options?: Record<string, unknown>): string =>
    t ? t(key, { defaultValue: fallback, ...options }) : fallback;

  const tier = applicationTier(app);
  const step2Submitted = hasStep2BeenSubmitted(app);
  const status = (app.status || "").toLowerCase().replace(/\s+/g, "");

  if (status === "rejected") {
    return {
      label: tr("kdRejected", "Rejected"),
      tone: "danger",
      step: Math.min(tier, 3),
      stepCaption: tr("kdNotApproved", "Not approved"),
      actionLabel: tr("kdApplyAgain", "Apply again"),
      actionKind: "discover",
    };
  }

  if (status === "cancelled") {
    return {
      label: tr("kdCancelled", "Cancelled"),
      tone: "neutral",
      step: 0,
      stepCaption: tr("kdCancelled", "Cancelled"),
      actionLabel: tr("kdApplyAgain", "Apply again"),
      actionKind: "discover",
    };
  }

  if (status === "inreview" || status === "pending") {
    // Legacy/buggy path: admin approval used to leave status=inReview while bumping tier ≥ 2.
    // Treat that as Step 2 unlocked so chefs aren't stuck behind a "waiting" screen.
    if (tier >= 2 && !step2Submitted) {
      return {
        label: tr("ksActionNeeded", "Action needed"),
        tone: "warning",
        step: 2,
        stepCaption: tr("kdCompleteStep2", "Complete Step 2 of 3"),
        actionLabel: tr("kdContinue", "Continue"),
        actionKind: "complete-step",
      };
    }

    return {
      label: tr("kdInReview", "In review"),
      tone: "progress",
      step: 1,
      stepCaption: tr("kdStep1Of3", "Request to apply"),
      actionLabel: tr("kdApplicationInProgress", "Application in progress"),
      actionKind: "wait",
    };
  }

  if (status === "approved" && tier >= 3) {
    return {
      label: tr("kdReadyToBook", "Book Now"),
      tone: "success",
      step: 3,
      stepCaption: tr("ovReady", "Book Now"),
      actionLabel: tr("kdBook", "Book"),
      actionKind: "book",
    };
  }

  if (status === "approved" && step2Submitted) {
    return {
      label: tr("kdInReview", "In review"),
      tone: "progress",
      step: 2,
      stepCaption: tr("kdStep2Of3Submitted", "Step 2 of 3 · submitted"),
      actionLabel: tr("kdApplicationInProgress", "Application in progress"),
      actionKind: "wait",
    };
  }

  if (status === "approved" && (tier === 2 || tier === 1) && !step2Submitted) {
    return {
      label: tr("ksActionNeeded", "Action needed"),
      tone: "warning",
      step: 2,
      stepCaption: tr("kdCompleteStep2", "Complete Step 2 of 3"),
      actionLabel: tr("kdContinue", "Continue"),
      actionKind: "complete-step",
    };
  }

  if (status === "approved") {
    return {
      label: tr("kdStep1Approved", "Request to apply approved"),
      tone: "progress",
      step: 1,
      stepCaption: tr("kdContinueToStep2", "Continue"),
      actionLabel: tr("kdContinue", "Continue"),
      actionKind: "complete-step",
    };
  }

  return {
    label: tr("kdUnknown", "Unknown"),
    tone: "neutral",
    step: 0,
    stepCaption: "",
    actionLabel: tr("kdApplicationInProgress", "Application in progress"),
    actionKind: "wait",
  };
}

export function documentToneFromLabel(label: string): StatusTone {
  const value = label.toLowerCase();
  if (value.includes("verified") || value === "approved") return "success";
  if (value.includes("rejected")) return "danger";
  if (
    value.includes("needed") ||
    value.includes("required") ||
    value.includes("no documents") ||
    value.includes("not uploaded")
  ) {
    return "warning";
  }
  if (value.includes("pending") || value.includes("review") || value.includes("uploaded")) {
    return "progress";
  }
  return "neutral";
}
