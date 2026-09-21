import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { StatusButton } from "@/components/ui/status-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle, EyeOff, Loader2 } from "@/components/ui/manager-icons";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import { mt } from "@/i18n/manager";
import type {
  ListingRecommendationId,
  ListingRequirementId,
} from "@shared/kitchen-listing-readiness";

interface ReadinessResponse {
  checklist: {
    requirements: Array<{ id: ListingRequirementId; met: boolean }>;
    recommendations: Array<{ id: ListingRecommendationId; met: boolean }>;
    canPublish: boolean;
    missingRequirementIds: ListingRequirementId[];
    openRecommendationIds: ListingRecommendationId[];
  };
  listingStatus: "draft" | "active";
  adminHidden: boolean;
  /**
   * The same payload the review page reads. Only `kitchenName` is used here: the take-down
   * confirmation has to name the kitchen it is about, because a dialog is read on its own and the
   * header's switcher is not in view behind it.
   */
  details: { kitchenName: string };
}

interface KitchenListingStatusProps {
  kitchenId: number;
  /**
   * Named on the card because the card is about ONE kitchen and a location can hold several.
   *
   * Two kitchens can share a state and an open-item count while blocking on completely different
   * things, which reads as a card that never updates. Naming the kitchen removes the ambiguity.
   */
  kitchenName?: string;
  /**
   * The kitchen switcher, rendered as the banner IDENTITY.
   *
   * A slot rather than a callback: the card must not know how a kitchen is chosen, and the page that
   * owns the dropdown already has the state. Passing the control in also means the banner can carry
   * the identity and the state together, which is the whole point of moving it above the tabs.
   */
  selector?: ReactNode;
  /**
   * The shell owns routing; this names the destination and, for a task that belongs to one kitchen,
   * which kitchen. Passed explicitly rather than looked up from the URL, which differs per
   * environment.
   */
  onNavigate?: (view: KitchensNavigationTarget, kitchenId?: number) => void;
}

/**
 * How each state is dressed.
 *
 * The tone is carried by the ICON alone, and the label beside it stays in the normal text colour.
 * Colouring the label too made "Not listed" read as a hyperlink — blue text next to a control is a
 * link to every reader — while the icon was already saying the same thing. A tinted badge chip is
 * deliberately not used either: in a header it becomes one more label to skim past.
 */
const TONES = {
  live: { label: "text-emerald-700 dark:text-emerald-400", icon: CheckCircle },
  blocked: { label: "text-amber-700 dark:text-amber-400", icon: AlertTriangle },
  ready: { label: "text-sky-700 dark:text-sky-400", icon: CheckCircle },
  hidden: { label: "text-amber-700 dark:text-amber-400", icon: EyeOff },
} as const;

/**
 * The kitchen's ENTITY HEADER: which kitchen, whether it is live, and the one action that follows.
 *
 * It is the header of the tabbed section below it, not a notice about the page — which is why it
 * carries no card and no alert tint. It is deliberately a SUMMARY: the reading and the deciding
 * happen on the review page, so this stays one state, one sentence and one action rather than growing
 * a checklist of its own.
 */
export function KitchenListingStatus({
  kitchenId,
  kitchenName,
  selector,
  onNavigate,
}: KitchenListingStatusProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  /**
   * Taking a kitchen off the listing is a one-click change to what chefs can book, from a button
   * that sits in a page header. It is confirmed first, and the confirmation names the consequence
   * rather than asking "are you sure" — the manager has to be able to tell what they are agreeing
   * to without remembering the page behind the dialog.
   */
  const [confirmTakeDown, setConfirmTakeDown] = useState(false);

  const { data, isLoading } = useQuery<ReadinessResponse>({
    queryKey: ["kitchen-listing-readiness", kitchenId],
    queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/listing-readiness`),
    enabled: Number.isFinite(kitchenId) && kitchenId > 0,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["kitchen-listing-readiness", kitchenId] });

  const takeDown = async () => {
    try {
      await apiPost(`/manager/kitchens/${kitchenId}/listing-status`, { status: "draft" });
      await refresh();
      // The chef-facing lists are built from `listing_status`, so they are stale now.
      queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      toast({
        title: mt("listingStatusTakenDown"),
        description: mt("listingStatusTakenDownDesc"),
      });
    } catch (error) {
      toast({
        title: mt("listingStatusPublishFailed"),
        description: error instanceof Error ? error.message : mt("listingStatusPublishFailedDesc"),
        variant: "destructive",
      });
      throw error;
    }
  };

  const takeDownAction = useStatusButton(takeDown);

  /*
   * The identity zone is built BEFORE the loading branch on purpose. The switcher is this page's only
   * route to "Add Kitchen", so unmounting it while the readiness request is in flight would make the
   * one control a manager needs disappear and then reappear, taking the header's height with it.
   */
  const identity = (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {mt("kitchen")}
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        {selector ??
          (kitchenName ? (
            // The identity VALUE, under its caption — so it carries the weight, not the muted tone
            // it wore when it sat inline beside the state.
            <span className="truncate text-sm font-medium">{kitchenName}</span>
          ) : null)}
      </div>
    </div>
  );

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3 pb-4">
        {identity}
        <p className="text-sm text-muted-foreground">{mt("listingStatusLoading")}</p>
      </div>
    );
  }

  const { checklist, listingStatus, adminHidden } = data;
  const isListed = listingStatus === "active";
  const blockerCount = checklist.missingRequirementIds.length;
  const suggestionCount = checklist.openRecommendationIds.length;

  const tone = adminHidden
    ? TONES.hidden
    : isListed
      ? TONES.live
      : blockerCount > 0
        ? TONES.blocked
        : TONES.ready;

  const stateLabel = adminHidden
    ? mt("listingStatusHiddenLabel")
    : isListed
      ? mt("listingStatusLiveLabel")
      : mt("listingStatusDraftLabel");

  /*
   * One state, one sentence. The suggestion count is a SUFFIX and never says "below" — this card has
   * nothing below it, unlike the review page, which is where that wording came from.
   */
  const message = adminHidden
    ? mt("listingStatusHiddenDesc")
    : isListed
      ? mt("listingStatusLiveDesc")
      : blockerCount > 0
        ? mt("listingStatusNotReady", { count: blockerCount })
        : suggestionCount > 0
          ? mt("listingStatusReadyWithTips", { count: suggestionCount })
          : mt("listingStatusReady");

  const ToneIcon = tone.icon;

  return (
    /*
     * NOT a card and NOT a banner.
     *
     * This is the ENTITY HEADER for the kitchen whose sections the tab bar below it owns: identity,
     * publish state, and the one action that follows from that state. It used to be a `Card` with a
     * `border-l-4` tone edge, which is the shape this app already uses for page-level notices, so it
     * read as an alert floating above the page rather than as the header of the thing the tabs edit.
     * The tone lives in the status indicator now, and the header runs straight into the tab bar's own
     * bottom border — the entity-header shape GitHub and Vercel use.
     */
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        {identity}

        {/*
         * Outline rather than a filled brand pill: the state indicator carries the emphasis, and a
         * full-strength CTA in a header shouts louder than the state it sits beside.
         */}
          {isListed ? (
            /*
             * Outline, and it only OPENS a confirmation — the work happens in the dialog, so this
             * button carries no loading or success state of its own.
             */
            <StatusButton
              variant="outline"
              size="sm"
              status="idle"
              onClick={() => setConfirmTakeDown(true)}
              labels={{ idle: mt("listingStatusTakeDown") }}
            />
          ) : (
            /*
             * FILLED, unlike the take-down button above. This is the page's primary action — the one
             * that puts the kitchen in front of chefs — and the header is the only place it appears.
             * It used to be an outline button so the old coloured edge could carry the emphasis; the
             * header has no edge to defer to, and an outline action sitting beside a quiet state line
             * is exactly what let it get missed.
             */
            <StatusButton
              size="sm"
              status="idle"
              onClick={() => onNavigate?.("listing-review", kitchenId)}
              labels={{
                idle: mt("listingStatusReviewAndGoLive"),
                loading: mt("savingShort"),
                success: mt("saved"),
              }}
            />
          )}
        </div>

        {/*
         * The STATE line. The tone is carried by the icon; the label deliberately stays in the normal
         * text colour. Colouring it made "Not listed" read as a HYPERLINK — blue text beside a control
         * is a link to every reader, which is the one thing it is not — while the icon was already
         * saying the same thing. This is the coloured-indicator-plus-plain-label shape Vercel and
         * Linear use for status.
         */}
        <div className="flex items-start gap-2.5">
          <ToneIcon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.label)} aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium">{stateLabel}</span>
            {/* The app's inline separator, so the state and its reason do not read as one run-on
                sentence — at 14px the weight difference alone is not enough to divide them. */}
            <span className="px-1.5 text-muted-foreground/60" aria-hidden="true">
              ·
            </span>
            <span className="text-muted-foreground">{message}</span>
          </p>
        </div>

      {/*
       * Taking the kitchen off the listing is confirmed first, and the confirmation NAMES THE
       * CONSEQUENCE rather than asking "are you sure" — the same shape the delete-kitchen dialog on
       * Details & Pricing uses, for the same reason: a dialog is read on its own, with the page that
       * gave it its context hidden behind it.
       *
       * Every claim in the copy is checked against the endpoint (`PUT /manager/kitchens/:id/
       * listing-status`): it writes `listing_status` and nothing else, so accepted bookings really are
       * untouched and re-listing really is available. It also names the kitchen, because a location
       * can hold several and the header's switcher is not visible behind the dialog.
       */}
      <AlertDialog open={confirmTakeDown} onOpenChange={setConfirmTakeDown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mt("listingTakeDownConfirmTitle", { kitchen: data.details.kitchenName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{mt("listingTakeDownConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={takeDownAction.status === "loading"}>
              {mt("listingTakeDownConfirmKeep")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={takeDownAction.status === "loading"}
              onClick={(event) => {
                // Keep the dialog open while the request runs, so a failure is reported in place
                // rather than leaving the manager to guess whether it went through.
                event.preventDefault();
                void takeDownAction.execute().finally(() => setConfirmTakeDown(false));
              }}
            >
              {takeDownAction.status === "loading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {mt("listingStatusTakeDown")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default KitchenListingStatus;
