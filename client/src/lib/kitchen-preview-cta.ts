import type {
  KitchenActionKind,
  KitchenDisplayStatus,
} from "@/components/chef/applications/status";

export type PreviewPrimaryCta = {
  label: string;
  kind: KitchenActionKind | "request" | "pending" | "loading" | "closed";
  /** Calendar proceed needs dates only when starting a new request. */
  requireDates: boolean;
  variant: "default" | "outline";
};

/**
 * Resolves the selected kitchen's CTA using only selected-kitchen application
 * state. Seller marketplace applications are deliberately not an input.
 */
export function resolvePreviewPrimaryCta(args: {
  t: (key: string, fallback?: string) => string;
  applicationLoading: boolean;
  canBook: boolean;
  alreadyApplied: boolean;
  canAcceptApplications: boolean;
  display: KitchenDisplayStatus | null;
}): PreviewPrimaryCta | null {
  const {
    t,
    applicationLoading,
    canBook,
    alreadyApplied,
    canAcceptApplications,
    display,
  } = args;

  if (applicationLoading) {
    return {
      label: t("checkingApplication", "Checking your application…"),
      kind: "loading",
      requireDates: false,
      variant: "default",
    };
  }

  if (canBook || display?.actionKind === "book") {
    return {
      label: t("bookThisKitchen", "Book"),
      kind: "book",
      requireDates: false,
      variant: "default",
    };
  }

  if (display?.actionKind === "complete-step") {
    return {
      label: t("continueApplication", "Continue"),
      kind: "complete-step",
      requireDates: false,
      variant: "default",
    };
  }

  if (alreadyApplied && display?.actionKind !== "discover") {
    return {
      label: t("applicationInProgress", "Application in progress"),
      kind: "wait",
      requireDates: false,
      variant: "outline",
    };
  }

  if (display?.actionKind === "discover" && canAcceptApplications) {
    return {
      label: t("applyAgain", "Apply again"),
      kind: "discover",
      requireDates: true,
      variant: "default",
    };
  }

  if (!canAcceptApplications) return null;

  return {
    label: t("requestToApply", "Request to apply"),
    kind: "request",
    requireDates: true,
    variant: "default",
  };
}
