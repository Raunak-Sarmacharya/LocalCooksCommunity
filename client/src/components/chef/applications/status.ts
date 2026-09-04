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
}

export interface KitchenStatusInput {
  status: string;
  current_tier?: number | null;
  currentTier?: number | null;
  tier2_completed_at?: string | Date | null;
  tier_data?: unknown;
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

export function getKitchenDisplayStatus(
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
      label: tr("kdReadyToBook", "Approved"),
      tone: "success",
      step: 3,
      stepCaption: tr("ovReady", "Approved"),
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
      stepCaption: tr("kdContinueToStep2", "Continue to Step 2"),
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
