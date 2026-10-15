import { bookingListBounds, bookingListPill, chefBookingTabs, chefNextVisit, listDayLabel, listTimezone, listWhenLine, type BookingListRow } from "@/lib/booking-list-status";
import { StatusPill } from "@/components/booking/BookingNowCard";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Logo from "@/components/ui/logo";
import { SiStripe } from "react-icons/si";
import { InfoChip } from "@/components/chef/info-chip";
import { KitchenStatusChip } from "@/components/chef/applications/status-icons";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import { openChefShopHome, useShopStatus, useStripeDashboardLink } from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { useToast } from "@/hooks/use-toast";
import { applicationStatusVariant, documentToneFromLabel, getKitchenDisplayStatus, type StatusTone } from "@/components/chef/applications/status";
import type {
  AnyApplication,
  KitchenApplicationWithLocation,
  KitchenSummary,
  EnrichedBooking,
} from "./types";
import { KitchenPathEmptyCard, SellerPathEmptyCard } from "./GetStartedPathCards";
import { TruncatedText } from "@/components/common/TruncatedText";
import { tt } from "@/i18n/common-ns";
import { Icon } from "@iconify/react";
import { KitchenIcon } from "@/components/ui/kitchen-icon";
import { findChefNavItem } from "@/lib/chef-nav-sections";
import { useLocation } from "wouter";
import { countPendingOrUpcomingTours, normalizeChefTourRow, viewingStatusBadge, type ChefTourRow } from "@/lib/chef-viewing-display";
import { tourActivity } from "@shared/tour-activity";
import { DEFAULT_TIMEZONE } from "@shared/timezone-utils";
import { useTourClock } from "@/hooks/use-tour-clock";

interface OverviewTabContentProps {
  user: {
    displayName?: string | null;
  } | null;
  applications: AnyApplication[];
  kitchenApplications: KitchenApplicationWithLocation[];
  kitchenSummary: KitchenSummary;
  trainingStatusLabel?: string;
  enrichedBookings: EnrichedBooking[];
  getMostRecentApplication: () => AnyApplication | null;
  getApplicationStatus: () => string | null;
  getDocumentStatus: () => string;
  onSetActiveTab: (tab: string) => void;
  onSetApplicationViewMode: (mode: "list" | "form" | "documents") => void;
  isSellerApplicationFullyApproved?: boolean;
  isShopCreated?: boolean;
  /** True while applications, kitchen access or bookings are still loading; shows skeletons instead of empty states. */
  isLoading?: boolean;
}

function StatCardSkeleton() {
  return (
    <Card className="h-full shadow-none" aria-hidden>
      <CardContent className="p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-6 w-24" />
        <Skeleton className="mt-2 h-3 w-32" />
      </CardContent>
    </Card>
  );
}

function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "danger" && "bg-destructive",
        tone === "progress" && "bg-foreground/35",
        tone === "neutral" && "bg-muted-foreground/30",
        className
      )}
    />
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: StatusTone;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <Card className="h-full shadow-none transition-colors hover:bg-muted/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <StatusDot tone={tone} />
          </div>
          <TruncatedText as="p" className="mt-2 truncate text-lg font-semibold tracking-tight">{value}</TruncatedText>
          {hint ? (
            <TruncatedText as="p" className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</TruncatedText>
          ) : (
            <p className="mt-0.5 min-h-4 text-xs">&nbsp;</p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

function MetaRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
        {tone ? <StatusDot tone={tone} /> : null}
        <TruncatedText className="truncate">{value}</TruncatedText>
      </span>
    </div>
  );
}

function trainingTone(label: string): StatusTone {
  // Compare against canonical keys, not translated labels —
  // translated labels change with the active language.
  if (
    label === "Completed" ||
    label === "trainingCompleted"
  ) return "success";
  if (
    label === "In Progress" ||
    label === "In progress" ||
    label === "trainingInProgress"
  ) return "progress";
  return "neutral";
}

function sellerTone(status: string | null): StatusTone {
  if (!status) return "neutral";
  const normalized = status.toLowerCase();
  if (normalized.includes("approved") || normalized.includes("approuvée") || normalized.includes("схвалено")) return "success";
  if (normalized.includes("rejected") || normalized.includes("refusée") || normalized.includes("відхилено")) return "danger";
  if (
    normalized.includes("review") ||
    normalized.includes("révision") ||
    normalized.includes("розгляді") ||
    normalized.includes("pending") ||
    normalized.includes("attente") ||
    normalized.includes("очікує") ||
    normalized.includes("started") ||
    normalized.includes("commencé") ||
    normalized.includes("розпочато") ||
    normalized.includes("старті")
  ) {
    return "progress";
  }
  return "neutral";
}

function kitchenSummaryTone(summary: KitchenSummary): StatusTone {
  if (summary.variant === "success") return "success";
  if (summary.variant === "warning") return "warning";
  if (summary.variant === "destructive") return "danger";
  if (summary.variant === "secondary") return "progress";
  return "neutral";
}

export default function OverviewTabContent({
  user,
  applications,
  kitchenApplications,
  kitchenSummary,
  trainingStatusLabel = "Not Started",
  enrichedBookings,
  getMostRecentApplication,
  getApplicationStatus,
  getDocumentStatus,
  onSetActiveTab,
  onSetApplicationViewMode,
  isSellerApplicationFullyApproved,
  isShopCreated,
  isLoading = false,
}: OverviewTabContentProps) {
  useTourClock();
  const { t, i18n } = useTranslation("chef");
  const tr = t as unknown as import("i18next").TFunction;
  const { data: shopStatus } = useShopStatus();
  const dashboardLinkMutation = useStripeDashboardLink();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { user: authUser } = useFirebaseAuth();
  const { data: viewings = [], isError: toursFailed, isLoading: toursLoading } = useQuery({
    queryKey: ["/api/viewings", "chef", authUser?.uid],
    queryFn: async () => {
      if (!authUser) return [];
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/viewings/chef", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(tt("failedToFetchViewings"));
        return res.json();
    },
    enabled: !!authUser?.uid,
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const tourRows = (viewings as unknown[]).map(normalizeChefTourRow).filter((row): row is ChefTourRow => row != null);
  const activeTourCount = countPendingOrUpcomingTours(tourRows);
  const latestTour = [...tourRows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const latestTourBadge = latestTour && viewingStatusBadge(latestTour.status, latestTour.adminReviewDecision, latestTour.cancelledBy, latestTour.disruptionReason);
  const recentTours = tourRows.flatMap(tour => tourActivity(tour).map(event => ({ tour, event })))
    .sort((a, b) => Date.parse(b.event.recordedAt) - Date.parse(a.event.recordedAt)).slice(0, 4);
  const latestTourHint = latestTour
    ? `${latestTour.kitchenName || latestTour.locationName} · ${
        ['pending', 'pending_local_cooks'].includes(latestTour.status) && Date.parse(latestTour.scheduledAt) <= Date.now()
          ? t('tourStatusExpired')
          : latestTour.status === "confirmed"
          ? new Date(latestTour.scheduledAt).getTime() + (latestTour.durationMinutes ?? 30) * 60_000 < Date.now()
            ? t("tourStatusAwaitingOutcome", "Awaiting outcome")
            : t("tourStatusConfirmed", "Approved")
          : t(latestTourBadge!.labelKey, latestTourBadge!.defaultLabel)
      }`
    : t("ovNoViewings", "No tours scheduled");


  const latestApp = getMostRecentApplication();
  const sellerStatus = getApplicationStatus();
  const documentStatus = getDocumentStatus();
  const firstName = user?.displayName?.split(" ")[0];
  const showSellerAccount = Boolean(isSellerApplicationFullyApproved && isShopCreated);

  const kitchenDisplays = useMemo(
    () => kitchenApplications.map((app) => ({ app, display: getKitchenDisplayStatus(app, t) })),
    [kitchenApplications, t]
  );
  // "Bookable" has to mean the same thing here as everywhere else, so it is ASKED of the display
  // instead of re-derived from tier alone. Deriving it here is what let this card offer a delisted
  // kitchen as bookable and drop the chef onto a preview page with nothing in it.
  const firstBookableKitchen = kitchenDisplays.find(
    ({ display }) => display.actionKind === "book"
  )?.app;
  const hasApprovedKitchen = kitchenApplications.some(
    (app) => app.status === "approved" && (app.current_tier ?? 1) >= 3
  );
  const openKitchenPreview = (locationId: number) => navigate(`/kitchen-preview/${locationId}`);

  // Same phases and order as My bookings: the tile shows the next visit (happening now or confirmed), never a request.
  const bookingSummary = useMemo(() => chefNextVisit((enrichedBookings || []) as unknown as BookingListRow[]), [enrichedBookings]);
  const nextBooking = bookingSummary.next?.row as EnrichedBooking | undefined;

  const kitchenHint = useMemo(() => {
    const actionNeeded = kitchenDisplays.filter((item) => item.display.tone === "warning").length;
    const inReview = kitchenDisplays.filter((item) => item.display.tone === "progress").length;
    
    if (inReview > 0) {
      return inReview === 1 ? t("ovWaitingReviewOne") : t("ovWaitingReview", { count: inReview });
    }
    return kitchenApplications.length > 0 ? t("ovOpenKitchenAccess") : t("ovBrowseKitchensHint");
  }, [kitchenDisplays, kitchenApplications.length, t]);

  const nextWhen = (() => {
    const bounds = nextBooking ? bookingListBounds(nextBooking as unknown as BookingListRow) : null;
    if (!nextBooking || !bounds) return "";
    const zone = listTimezone(nextBooking as unknown as BookingListRow);
    const day = listDayLabel(bounds.startAt, zone, i18n.language, { today: t("ovToday"), tomorrow: t("ovTomorrow") });
    const time = new Intl.DateTimeFormat(i18n.language, { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).format(bounds.startAt);
    return `${day} ${time}`;
  })();
  const pendingRequests = bookingSummary.pending ? t("blRequestsPending", { count: bookingSummary.pending }) : "";
  const bookingsValue = nextWhen ? t("blNextWhen", { when: nextWhen })
    : pendingRequests || (enrichedBookings?.length ? t("ovBookingsTotal", { count: enrichedBookings.length }) : t("ovNone"));
  const bookingsHint = nextBooking
    ? [nextBooking.kitchenName || nextBooking.locationName, pendingRequests].filter(Boolean).join(" · ")
    : pendingRequests ? "" : enrichedBookings?.length ? t("ovNoUpcomingSessions") : t("ovNoSessionsBooked");

  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      description: string;
      cta: string;
      onClick: () => void;
    }> = [];
    for (const tour of tourRows) {
      if (tour.status === 'confirmed' && !tour.chefFeedbackSubmitted && Date.parse(tour.scheduledAt) + (tour.durationMinutes ?? 30) * 60_000 <= Date.now()) items.push({ id: `tour-feedback-${tour.id}`, title: tr('tourFeedbackTitle', { ns: 'common' }), description: `${tour.kitchenName || tour.locationName} · TOUR-${tour.id}`, cta: tr('tourFeedbackReview', { ns: 'common' }), onClick: () => navigate(`/dashboard?view=viewings&viewing=${tour.id}&feedback=1`) });
    }
    for (const tour of tourRows.filter(tour => tour.status === 'no_show' || tour.disruptionReason)) {
      items.push({ id: `tour-${tour.id}`, title: t('ovTourOutcomeReview'),
        description: `${tour.kitchenName || tour.locationName} · ${tr(viewingStatusBadge(tour.status, tour.adminReviewDecision, tour.cancelledBy, tour.disruptionReason).labelKey, { ns: 'chef' })}`,
        cta: t('ovReviewTour'), onClick: () => navigate(`/dashboard?view=viewings&viewing=${tour.id}`) });
    }

    const docTone = documentToneFromLabel(documentStatus);
    if (latestApp && docTone === "danger") {
      items.push({
        id: "docs-rejected",
        title: t("ovDocsRejectedTitle"),
        description: t("ovDocsRejectedDesc"),
        cta: t("ovUpdateCta"),
        onClick: () => {
          onSetApplicationViewMode("documents");
          onSetActiveTab("applications");
        },
      });
    } else if (latestApp && docTone === "warning") {
      items.push({
        id: "docs-needed",
        title: t("ovDocsNeededTitle"),
        description: documentStatus,
        cta: t("ovUploadCta"),
        onClick: () => {
          onSetApplicationViewMode("documents");
          onSetActiveTab("applications");
        },
      });
    }

    kitchenDisplays
      .filter((item) => item.display.actionKind === "complete-step")
      .slice(0, 2)
      .forEach(({ app, display }) => {
        items.push({
          id: `kitchen-step-${app.id}`,
          title: t("ovActionNeededKitchen", "Action needed"),
          description: app.location?.name || t("ovKitchenFallback"),
          cta: display.actionLabel || t("ovContinueCta"),
          onClick: () => {
            window.location.href = `/kitchen-requirements/${app.locationId}`;
          },
        });
      });

    if (showSellerAccount && shopStatus && !shopStatus.linked) {
      items.push({
        id: "stripe",
        title: t("ovLinkStripeTitle"),
        description: t("ovLinkStripeDesc"),
        cta: t("ovLinkCta"),
        onClick: () => onSetActiveTab("my-account"),
      });
    }

    return items
      .filter((item) => item.id !== "training" && !/train/i.test(item.title))
      .slice(0, 3);
  }, [
    latestApp,
    documentStatus,
    kitchenDisplays,
    showSellerAccount,
    shopStatus,
    onSetActiveTab,
    onSetApplicationViewMode,
    viewings,
    navigate,
    t,
  ]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t("ovGoodMorning");
    if (hour < 17) return t("ovGoodAfternoon");
    return t("ovGoodEvening");
  };

  const subtitle = useMemo(() => {
    if (attentionItems.length > 0) {
      return attentionItems[0].title;
    }
    if (bookingSummary.upcoming > 0) {
      return t("ovSubtitleUpcoming", { count: bookingSummary.upcoming });
    }
    if (!applications.length && kitchenApplications.length === 0) {
      return t("ovSubtitleStart");
    }
    return t("ovSubtitleAllSet");
  }, [attentionItems, bookingSummary.upcoming, applications.length, kitchenApplications.length, t]);

  const handleOpenDashboard = async () => {
    try {
      const result = await dashboardLinkMutation.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      toast({
        title: t("errorTitle"),
        description: t("ovStripeLinkFailed"),
        variant: "destructive",
      });
    }
  };

  const openShop = () => openChefShopHome();
  const showSkeleton = isLoading || toursLoading;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {getGreeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        {showSkeleton ? <Skeleton className="mt-2 h-4 w-48" /> : <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {showSkeleton ? (
        <div role="status" aria-busy="true" aria-label={t("ovLoading", "Loading your dashboard")} className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-skeleton">
          {[0, 1, 2, 3].map((key) => <StatCardSkeleton key={key} />)}
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("ovStatSeller")}
          value={sellerStatus || t("ovNotStarted")}
          hint={latestApp ? t("ovDocumentsHint", { status: documentStatus }) : t("ovApplyToSellHint")}
          tone={sellerTone(sellerStatus)}
          onClick={() => onSetActiveTab("applications")}
        />
        <StatCard
          label={t("ovStatKitchens")}
          value={kitchenSummary.label}
          hint={kitchenHint}
          tone={kitchenSummaryTone(kitchenSummary)}
          onClick={() => firstBookableKitchen
            ? openKitchenPreview(firstBookableKitchen.locationId)
            : onSetActiveTab(hasApprovedKitchen ? "kitchen-applications" : kitchenApplications.length > 0 ? "kitchen-requests" : "discover-kitchens")}
        />
        <StatCard
          label={t("ovStatKitchenTours", "Kitchen Tours")}
          value={activeTourCount > 0 ? activeTourCount.toString() : t("ovNone", "None")}
          hint={latestTourHint}
          tone={activeTourCount > 0 ? "success" : "neutral"}
          onClick={() => onSetActiveTab("viewings")}
        />
        <StatCard
          label={t("ovStatBookings")}
          value={bookingsValue}
          hint={bookingsHint}
          tone={nextBooking ? "success" : bookingSummary.pending ? "warning" : "neutral"}
          onClick={() => onSetActiveTab("bookings")}
        />
      </div>
      )}

      {toursFailed && <p role="status" className="text-sm text-destructive">{t('ovTourLoadFailed')}</p>}
      {recentTours.length > 0 && <Card className="shadow-none"><CardHeader className="pb-2"><CardTitle className="text-base">{t('ovTourRecentActivity')}</CardTitle></CardHeader>
        <CardContent><ul className="divide-y">{recentTours.map(({ tour, event }) => {
          const label = event.corrected ? t('tourOutcomeCorrected') : tr(viewingStatusBadge(event.status, tour.adminReviewDecision, tour.cancelledBy, event.disruptionReason).labelKey, { ns: 'chef' });
          return <li key={`${tour.id}-${event.key}`}><button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => navigate(`/dashboard?view=viewings&viewing=${tour.id}`)}>
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{tour.kitchenName || tour.locationName} · TOUR-{tour.id}</span></span>
            <time dateTime={event.recordedAt} className="text-xs text-muted-foreground">{new Date(event.recordedAt).toLocaleString(i18n.language, { timeZone: DEFAULT_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' })}</time>
          </button></li>;
        })}</ul></CardContent></Card>}
      {attentionItems.length > 0 && (
        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("ovNeedsAttention")}</CardTitle>
            <CardDescription>{t("ovNeedsAttentionDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y">
              {attentionItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <StatusDot tone="warning" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      <TruncatedText as="p" className="truncate text-xs text-muted-foreground">{item.description}</TruncatedText>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                      {item.cta}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div
        className={cn(
          "grid items-stretch gap-4",
          showSellerAccount ? "lg:grid-cols-3" : "lg:grid-cols-2"
        )}
      >
        {showSellerAccount && (
          <Card className="flex h-full flex-col shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{t("ovSellerAccountTitle")}</CardTitle>
                  <CardDescription className="mt-1">
                    {t("ovSellerAccountDesc")}
                  </CardDescription>
                </div>
                {shopStatus?.linked ? (
                  <InfoChip variant="success" className="shrink-0">
                    {t("ovConnected")}
                  </InfoChip>
                ) : (
                  <InfoChip variant="warning" className="shrink-0">
                    {t("ovPayoutsOff")}
                  </InfoChip>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 pt-0">
              <div className="divide-y border-y">
                <MetaRow
                  label={t("ovShopRow")}
                  value={shopStatus?.phpShopId ? t("ovReady") : t("ovPending")}
                  tone={shopStatus?.phpShopId ? "success" : "progress"}
                />
                <MetaRow
                  label={t("ovStripeRow")}
                  value={shopStatus?.phpShopStripeAccountId ? t("ovConnected") : t("ovNotConnected")}
                  tone={shopStatus?.phpShopStripeAccountId ? "success" : "warning"}
                />
                <MetaRow
                  label={t("ovPayoutsRow")}
                  value={shopStatus?.linked ? t("ovOn") : t("ovOff")}
                  tone={shopStatus?.linked ? "success" : "warning"}
                />
              </div>
            </CardContent>
            <CardFooter className="mt-auto flex-col items-stretch justify-end gap-2 sm:flex-col sm:items-stretch sm:gap-2 xl:flex-row xl:items-center">
              {shopStatus?.linked ? (
                <>
                  <Button variant="outline" size="sm" onClick={openShop}>
                    <Logo variant="brand" className="mr-2 h-4 w-4" />
                    {t("ovShopBtn")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="xl:ml-2"
                    onClick={handleOpenDashboard}
                    disabled={dashboardLinkMutation.isPending}
                  >
                    {dashboardLinkMutation.isPending ? (
                      <Icon icon="mdi:loading" className="mr-2 size-4 animate-spin" aria-hidden />
                    ) : (
                      <SiStripe className="mr-2 h-4 w-4 text-[#635BFF]" aria-hidden />
                    )}
                    {t("ovStripeBtn")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetActiveTab("my-account")}
                >
                  <Icon icon="mdi:link-variant" className="size-4" aria-hidden />
                  {t("ovOpenAccounts")}
                </Button>
              )}
            </CardFooter>
          </Card>
        )}

        {latestApp ? (
          <Card className="flex h-full flex-col shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{t("ovSellerAppTitle")}</CardTitle>
                  <CardDescription className="mt-1">
                    {t("ovSellerAppDesc")}
                  </CardDescription>
                </div>
                <InfoChip variant={applicationStatusVariant(latestApp.status)} className="shrink-0">
                  {formatApplicationStatus(latestApp.status, t)}
                </InfoChip>
              </div>
            </CardHeader>
            <CardContent className="flex-1 pt-0">
              <div className="divide-y border-y">
                <MetaRow label={t("ovRowApplication")} value={`#${latestApp.id}`} />
                <MetaRow
                  label={t("ovRowSubmitted")}
                  value={
                    latestApp.createdAt
                      ? new Date(latestApp.createdAt).toLocaleDateString(i18n.language)
                      : "—"
                  }
                />
                <MetaRow
                  label={t("ovRowDocuments")}
                  value={documentStatus}
                  tone={documentToneFromLabel(documentStatus)}
                />
              </div>
            </CardContent>
            <CardFooter className="mt-auto flex-col items-stretch justify-end gap-2 sm:flex-row sm:items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetActiveTab("applications")}
              >
                <Icon icon={findChefNavItem("applications")!.icon} className="size-4" aria-hidden />
                {t("ovViewApplication")}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <SellerPathEmptyCard
            loading="eager"
            compact={Boolean(showSellerAccount || kitchenApplications.length > 0)}
            onApply={() => {
              onSetApplicationViewMode("form");
              onSetActiveTab("applications");
            }}
          />
        )}

        {kitchenApplications.length > 0 ? (
          <Card className="flex h-full flex-col shadow-none">
            <CardHeader className="pb-3">
              <div>
                <CardTitle className="text-base">{t("ovKitchenAccessTitle")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("ovKitchenAccessDesc")}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex-1 pt-0">
              <div className="max-h-[11.5rem] overflow-y-auto overflow-x-hidden divide-y border-y">
                {kitchenDisplays.map(({ app, display }) => (
                  <button
                    type="button"
                    key={app.id}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => display.actionKind === "book"
                      ? openKitchenPreview(app.locationId)
                      : display.actionKind === "complete-step"
                        ? navigate(`/kitchen-requirements/${app.locationId}`)
                        : onSetActiveTab(app.status === "approved" && (app.current_tier ?? 1) >= 3
                          ? "kitchen-applications"
                          : "kitchen-requests")}
                  >
                    <div className="min-w-0 flex-1">
                      <TruncatedText as="p" className="truncate text-sm font-medium">
                        {app.location?.name || t("ovKitchenFallback")}
                      </TruncatedText>
                      {display.actionKind === "complete-step" ? (
                        <span
                          className="text-xs text-primary underline hover:text-primary/80 transition-colors flex items-center gap-1 mt-0.5"
                        >
                          {t("ovContinueCta", "Continue")}
                          <ChevronRight className="h-3 w-3" />
                        </span>
                      ) : (
                        <TruncatedText as="p" className="truncate text-xs text-muted-foreground">{display.stepCaption}</TruncatedText>
                      )}
                    </div>
                    <KitchenStatusChip display={display} className="shrink-0" />
                  </button>
                ))}
              </div>
            </CardContent>
            <CardFooter className="mt-auto flex-col items-stretch justify-end gap-2 sm:flex-col sm:items-stretch sm:gap-2 xl:flex-row xl:items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetActiveTab("kitchen-applications")}
              >
                <KitchenIcon className="mr-2 size-4" />
                {t("ovMyKitchensBtn")}
              </Button>
              <Button
                size="sm"
                className="xl:ml-2"
                onClick={() => {
                  onSetActiveTab("discover-kitchens");
                }}
              >
                <Icon icon={findChefNavItem("discover-kitchens")!.icon} className="size-4" aria-hidden />
                {t("ovExploreKitchensBtn")}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <KitchenPathEmptyCard
            loading="eager"
            compact={Boolean(showSellerAccount || latestApp)}
            onExplore={() => {
              onSetActiveTab("discover-kitchens");
            }}
          />
        )}
      </div>

      {enrichedBookings?.length > 0 && (
        <UpcomingBookings
          bookings={enrichedBookings}
          locale={i18n.language}
          onViewAll={() => onSetActiveTab("bookings")}
        />
      )}
    </div>
  );
}

function UpcomingBookings({
  bookings,
  onViewAll,
  locale,
}: {
  bookings: EnrichedBooking[];
  onViewAll: () => void;
  locale?: string;
}) {
  const { t } = useTranslation("chef");
  const lang = locale || "en-CA";
  const words = { today: t("ovToday"), tomorrow: t("ovTomorrow") };
  // My bookings' Upcoming tab, in its order (now, requests, confirmed); past visits only when nothing is ahead.
  const tabs = chefBookingTabs(bookings as unknown as BookingListRow[]);
  const listed = tabs.upcoming.length ? tabs.upcoming : tabs.past;
  const displayBookings = listed.slice(0, 4);

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("ovBookingsTitle")}</CardTitle>
            <CardDescription>
              {tabs.upcoming.length ? t("ovBookingsUpcoming", { count: tabs.upcoming.length }) : t("ovRecentSessions")}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onViewAll}>
            {t("ovViewAllBtn")}
            <ChevronRight />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y border-t">
          {displayBookings.map(({ row, phase }) => {
            const booking = row as unknown as EnrichedBooking;
            return (
              <button
                key={booking.id}
                type="button"
                className="flex min-h-11 w-full items-center gap-4 py-3 text-left transition-colors hover:bg-muted/40"
                onClick={onViewAll}
              >
                <div className="min-w-0 flex-1">
                  <TruncatedText as="p" className="truncate text-sm font-medium">
                    {booking.kitchenName || booking.locationName || t("ovKitchenSession")}
                  </TruncatedText>
                  <TruncatedText as="p" className="truncate text-xs tabular-nums text-muted-foreground">{listWhenLine(row, lang, words)}</TruncatedText>
                </div>
                <StatusPill tone={bookingListPill(phase, false).tone} className="shrink-0">{t(bookingListPill(phase, false).key as never)}</StatusPill>
              </button>
            );
          })}
        </div>
        {listed.length > 4 && (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onViewAll}>
            <Icon icon={findChefNavItem("bookings")!.icon} className="size-4" aria-hidden />
            {t("ovMore", { count: listed.length - 4 })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
