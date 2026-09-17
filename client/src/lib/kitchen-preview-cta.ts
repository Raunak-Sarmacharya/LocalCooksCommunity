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

export function resolvePreviewApplicationRoute(
  locationId: string | number | undefined,
  display: KitchenDisplayStatus | null,
): string | null {
  if (!locationId) return null;
  if (display?.actionKind === "discover") return `/apply-kitchen/${locationId}`;
  if (display?.actionKind === "complete-step") return `/kitchen-requirements/${locationId}`;
  return null;
}

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

  // The location itself is not taking bookings — its kitchen licence is no longer valid.
  // This MUST be checked before `canBook`: an approved chef's `canBook` is derived purely
  // from their own application row (status "approved" + tier >= 3) and knows nothing about
  // the location, so it stays true after the licence lapses. This used to `return null`,
  // which removed the CTA from the page entirely — leaving the availability calendar on
  // screen with no way to act on it and no explanation why. A disabled "Coming Soon"
  // button matches the discover-card chip and the preview header chip, so all three
  // surfaces agree.
  if (!canAcceptApplications) {
    return {
      label: t("applyFlowComingSoonBadge", "Coming Soon"),
      kind: "closed",
      requireDates: false,
      variant: "outline",
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

  return {
    label: t("requestToApply", "Request to apply"),
    kind: "request",
    requireDates: true,
    variant: "default",
  };
}
