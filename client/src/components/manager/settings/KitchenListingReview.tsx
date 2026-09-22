import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { StatusButton } from "@/components/ui/status-button";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  Circle,
} from "@/components/ui/manager-icons";
import { SettingsRow } from "./SettingsRow";
import { ChefPageHeader } from "@/components/chef/ui";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { KitchenSection, KitchensNavigationTarget } from "@/lib/manager-kitchens-navigation";
import {
  invalidateKitchenListingState,
  kitchenListingReadinessKey,
} from "@/lib/manager-kitchens-navigation";
import { mt } from "@/i18n/manager";
import type {
  ListingRecommendationId,
  ListingRequirementId,
} from "@shared/kitchen-listing-readiness";

/**
 * Where a manager goes to fix each item.
 *
 * A row that belongs to a KITCHEN TAB names that tab as a `KitchenSection`; a row that belongs to a
 * page of its own names the view. The distinction is load-bearing and is why this type exists:
 * `"kitchens"` is a valid view that lands on whatever section the URL already happened to hold, so
 * the Equipment, Storage, gallery and cover-photo rows all shipped pointing at the wrong tab — and
 * none of them carried the kitchen, so a location with more than one kitchen sent the manager to
 * `kitchens[0]` instead of the kitchen they were reviewing.
 */
interface RowTarget {
  view: KitchensNavigationTarget;
  /** Present only when the destination is one of the Kitchens view's own tabs. */
  section?: KitchenSection;
}

const REQUIREMENT_TARGET: Record<ListingRequirementId, RowTarget> = {
  description: { view: "kitchens", section: "details" },
  // The rates are on Details & Pricing: that tab embeds `KitchenPricingContent`.
  rate: { view: "kitchens", section: "details" },
  // NOT Details & Pricing. `KitchenPhotos` owns the cover photo and the gallery together
  // (`kitchens.image_url` and `kitchens.gallery_images`), as two labelled groups on the Photos tab.
  coverPhoto: { view: "kitchens", section: "photos" },
  license: { view: "settings-license" },
  availability: { view: "availability" },
  stripe: { view: "payments" },
  applicationRequirements: { view: "application-requirements" },
  bookingRules: { view: "settings-booking-rules" },
};

const RECOMMENDATION_TARGET: Record<ListingRecommendationId, RowTarget> = {
  gallery: { view: "kitchens", section: "photos" },
  // Equipment and storage are TABS of the Kitchens view, each scoped to the selected kitchen —
  // which is why the kitchen has to travel with the destination.
  equipment: { view: "kitchens", section: "equipment" },
  storage: { view: "kitchens", section: "storage" },
  tours: { view: "tour-availability" },
  terms: { view: "settings-booking-rules" },
};

interface ReadinessResponse {
  checklist: {
    requirements: Array<{ id: ListingRequirementId; met: boolean }>;
    recommendations: Array<{ id: ListingRecommendationId; met: boolean }>;
    canPublish: boolean;
    missingRequirementIds: ListingRequirementId[];
    openRecommendationIds: ListingRecommendationId[];
  };
  details: {
    kitchenName: string;
    locationName: string | null;
    description: string | null;
    hourlyRateCents: number | null;
    dailyRateCents: number | null;
    coverPhotoUrl: string | null;
    galleryImageCount: number;
    availabilityDayCount: number;
    licenseStatus: string;
    stripeAccountId: string | null;
    hasApplicationRequirements: boolean;
    termsUploadedAt: string | null;
    toursEnabled: boolean;
    cancellationPolicyHours: number;
    dailyBookingLimit: number;
    minimumBookingWindowHours: number;
    minimumBookingHours: number;
  };
  listingStatus: "draft" | "active";
  adminHidden: boolean;
}

interface KitchenListingReviewProps {
  kitchenId: number;
  /**
   * The location the kitchen belongs to.
   *
   * Needed only so a successful publish can staleness the LOCATION-scoped caches (`managerKitchens`,
   * the sidebar's kitchen list) as well as the kitchen-scoped checklist. Optional because the review
   * is still correct without it — the checklist is keyed by kitchen.
   */
  locationId?: number;
  /**
   * The shell owns routing: which view, which kitchen, and — when the destination is one of the
   * Kitchens view's tabs — which section.
   *
   * All three matter. Without the section a row lands on the wrong tab; without the kitchen it lands
   * on the wrong kitchen. Both were true of every row on this page.
   */
  onNavigate?: (view: KitchensNavigationTarget, kitchenId?: number, section?: KitchenSection) => void;
  /** Called after a successful publish so the shell can return to the kitchen. */
  onListed?: () => void;
}

/**
 * The full-page publish review.
 *
 * A page rather than a dialog because it is the last thing a manager reads before a kitchen goes in
 * front of chefs, and it needs room for the values as well as the gaps — a dialog forced it to be a
 * list of complaints.
 *
 * Three groups, and the grouping is the whole design:
 *
 *  - **Before you can list** — every requirement, unmet ones first. These are the only things that
 *    can stop a listing, so they get the weight. Met rows stay in the same list, because booking
 *    rules are always satisfied and still have to be seen before publishing.
 *  - **Worth doing first** — only the suggestions that are still OPEN. A suggestion you have already
 *    acted on is not a suggestion, and leaving it there teaches the manager to skim the list.
 *  - **Already done** — the suggestions that are covered, collapsed and quiet, so the credit is
 *    there without competing with anything actionable.
 */
export default function KitchenListingReview({
  kitchenId,
  locationId,
  onNavigate,
  onListed,
}: KitchenListingReviewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [completedOpen, setCompletedOpen] = useState(false);

  const { data, isLoading } = useQuery<ReadinessResponse>({
    queryKey: kitchenListingReadinessKey(kitchenId),
    queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/listing-readiness`),
    enabled: Number.isFinite(kitchenId) && kitchenId > 0,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: kitchenListingReadinessKey(kitchenId) });

  const listKitchen = async () => {
    try {
      await apiPost(`/manager/kitchens/${kitchenId}/listing-status`, { status: "active" });
      invalidateKitchenListingState(queryClient, kitchenId, locationId);
      toast({
        title: mt("listingStatusWentLive"),
        description: mt("listingStatusWentLiveDesc"),
      });
      onListed?.();
    } catch (error) {
      // The 400 carries `missingRequirementIds`, but `apiPost` drops the body — and we do not need
      // it: re-running the query puts the same list back, derived from the database.
      toast({
        title: mt("listingStatusPublishFailed"),
        description: mt("listingStatusPublishFailedDesc"),
        variant: "destructive",
      });
      await refresh();
      throw error;
    }
  };

  const listAction = useStatusButton(listKitchen);

  /** Unmet requirements first — the manager's eye should land on what is stopping them. */
  const orderedRequirements = useMemo(() => {
    if (!data) return [];
    return [...data.checklist.requirements].sort((a, b) => Number(a.met) - Number(b.met));
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <ChefPageHeader title={mt("listingReviewPageTitle")} />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {mt("listingStatusLoading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { checklist, details, listingStatus, adminHidden } = data;
  const blockers = checklist.missingRequirementIds;
  const openSuggestions = checklist.openRecommendationIds;
  const coveredSuggestions = checklist.recommendations.filter((r) => r.met);
  const readyCount = checklist.requirements.filter((r) => r.met).length;
  const totalCount = checklist.requirements.length;
  const percentReady = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;
  const canList = checklist.canPublish;
  const isListed = listingStatus === "active";

  /**
   * A row's destination, always carrying the kitchen this review is for.
   *
   * `kitchenId` is the review's OWN kitchen, so a location holding several kitchens cannot land the
   * manager on a different one — which is what happened while every row navigated with no kitchen.
   */
  const go = (target: RowTarget) => onNavigate?.(target.view, kitchenId, target.section);

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={mt("listingReviewPageTitle")}
        description={
          details.locationName
            ? mt("listingReviewPageDescriptionAt", {
                kitchen: details.kitchenName,
                location: details.locationName,
              })
            : mt("listingReviewPageDescription", { kitchen: details.kitchenName })
        }
        actions={
          <>
            {/*
             * An escape hatch. Without one the review reads as a trap: publishing is the only action
             * on the page and the sole way back to the kitchen is the browser button.
             */}
            <Button variant="ghost" size="sm" onClick={() => onNavigate?.("kitchens", kitchenId)}>
              {mt("listingReviewCancel")}
            </Button>
            {isListed ? (
              <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                <CheckCircle className="h-3 w-3" aria-hidden="true" />
                {mt("listingStatusLiveBadge")}
              </Badge>
            ) : (
              <StatusButton
                size="sm"
                status={listAction.status}
                onClick={listAction.execute}
                disabled={!canList}
                labels={{
                  idle: mt("listingStatusGoLive"),
                  loading: mt("savingShort"),
                  success: mt("saved"),
                }}
              />
            )}
          </>
        }
      />

      {/* The one line a manager should be able to act on without reading anything else. */}
      <Card
        className={
          canList
            ? "border-emerald-200 dark:border-emerald-900"
            : "border-amber-200 dark:border-amber-900"
        }
      >
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p
              className={
                canList
                  ? "flex items-start gap-2 text-sm text-emerald-800 dark:text-emerald-300"
                  : "flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300"
              }
            >
              {canList ? (
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {canList
                  ? mt("listingReviewReadyHeadline")
                  : mt("listingReviewBlockedHeadline", { count: blockers.length })}
                {openSuggestions.length > 0
                  ? ` ${mt("listingReviewSuggestionHeadline", { count: openSuggestions.length })}`
                  : ""}
              </span>
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {mt("listingReviewReadyCount", { ready: readyCount, total: totalCount })}
            </span>
          </div>

          {/* Progress, because "6 of 8" alone does not read as progress at a glance. */}
          <Progress
            value={percentReady}
            className={
              canList
                ? "h-1.5 [&>div]:bg-emerald-600"
                : "h-1.5 [&>div]:bg-amber-500"
            }
          />

          {adminHidden ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {mt("listingStatusHiddenDesc")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">{mt("listingReviewRequiredHeading")}</CardTitle>
          <p className="text-xs text-muted-foreground">{mt("listingReviewRequiredNote")}</p>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {orderedRequirements.map((row) => (
            <SettingsRow
              key={row.id}
              id={`req-${row.id}`}
              label={mt(`listingReq_${row.id}`)}
              // A satisfied requirement shows its value; an open one shows WHY it blocks, because
              // "you have not set opening hours" is obvious and "nothing to book" is not.
              hint={requirementValue(row.id, details, row.met) ?? undefined}
              advisory={
                row.met ? undefined : { tone: "warning", text: mt(`listingReq_${row.id}Why`) }
              }
            >
              <RowAction
                label={row.met ? mt("listingReviewChange") : mt("listingReviewFix")}
                onClick={() => go(REQUIREMENT_TARGET[row.id])}
              />
            </SettingsRow>
          ))}
        </CardContent>
      </Card>

      {/* Only rendered when something is actually outstanding — an empty "suggestions" section is
          exactly the padding this page is meant to avoid. */}
      {openSuggestions.length > 0 ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base">{mt("listingReviewRecommendedHeading")}</CardTitle>
            <p className="text-xs text-muted-foreground">{mt("listingReviewRecommendedNote")}</p>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {checklist.recommendations
              .filter((row) => !row.met)
              .map((row) => (
                <SettingsRow
                  key={row.id}
                  id={`rec-${row.id}`}
                  label={mt(`listingRec_${row.id}`)}
                  hint={mt(`listingRec_${row.id}Why`)}
                >
                  <RowAction
                    label={mt("listingReviewAdd")}
                    onClick={() => go(RECOMMENDATION_TARGET[row.id])}
                  />
                </SettingsRow>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {coveredSuggestions.length > 0 ? (
        <Collapsible open={completedOpen} onOpenChange={setCompletedOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  {mt("listingReviewCoveredHeading", { count: coveredSuggestions.length })}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${completedOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="divide-y divide-border border-t p-0">
                {coveredSuggestions.map((row) => (
                  <SettingsRow
                    key={row.id}
                    id={`covered-${row.id}`}
                    label={mt(`listingRec_${row.id}`)}
                    hint={mt("listingReviewCoveredValue")}
                  >
                    <RowAction
                      label={mt("listingReviewChange")}
                      onClick={() => go(RECOMMENDATION_TARGET[row.id])}
                    />
                  </SettingsRow>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : null}
    </div>
  );
}

/**
 * The current value behind a requirement, so the page is a REVIEW and not just a checklist.
 *
 * Returns null when the requirement is UNMET, whatever the underlying field happens to hold. A row
 * that says "Cover photo" with an empty circle must not also say "Cover photo added" — the value
 * line describes a satisfied requirement, and showing a stale value next to an open one reads as the
 * page contradicting itself.
 */
function requirementValue(
  id: ListingRequirementId,
  d: ReadinessResponse["details"],
  met: boolean,
): string | null {
  if (!met) return null;

  switch (id) {
    case "description":
      return d.description ? truncate(d.description, 90) : null;
    case "rate": {
      const parts: string[] = [];
      if (d.hourlyRateCents) parts.push(`${formatCurrency(d.hourlyRateCents)}${mt("listingReviewPerHour")}`);
      if (d.dailyRateCents) parts.push(`${formatCurrency(d.dailyRateCents)}${mt("listingReviewPerDay")}`);
      return parts.length ? parts.join(" · ") : null;
    }
    case "availability":
      return d.availabilityDayCount > 0
        ? mt("listingReviewDaysOpen", { count: d.availabilityDayCount })
        : null;
    case "coverPhoto":
      return d.coverPhotoUrl ? mt("listingReviewCoverSet") : null;
    case "stripe":
      return d.stripeAccountId ? mt("listingReviewPayoutsConnected") : null;
    case "applicationRequirements":
      return d.hasApplicationRequirements ? mt("listingReviewRequirementsSet") : null;
    case "license":
      return d.licenseStatus === "approved" ? mt("listingReviewLicenseApproved") : null;
    case "bookingRules":
      return [
        mt("listingReviewRuleCancellation", { hours: d.cancellationPolicyHours }),
        mt("listingReviewRuleDailyLimit", { hours: d.dailyBookingLimit }),
        mt("listingReviewRuleMinDuration", { hours: d.minimumBookingHours }),
      ].join(" · ");
    default:
      return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The single action on a row.
 *
 * A text link rather than a Button. A review page can carry a dozen rows, and a dozen outlined
 * buttons would shout louder than the thing they act on. This matches the inline links the rest of
 * the manager settings already use.
 */
function RowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <ArrowRight className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
