import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/formatters";
import {
  ArrowRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import {
  openChefShopHome,
  useShopStatus,
  useStripeDashboardLink,
} from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { useToast } from "@/hooks/use-toast";
import {
  applicationStatusVariant,
  documentToneFromLabel,
  getKitchenDisplayStatus,
  toneToBadgeVariant,
  type StatusTone,
} from "@/components/chef/applications/status";
import type {
  AnyApplication,
  KitchenApplicationWithLocation,
  KitchenSummary,
  EnrichedBooking,
  StatusVariant,
} from "./types";
import { KitchenPathEmptyCard, SellerPathEmptyCard } from "./GetStartedPathCards";
import { TruncatedText } from "@/components/common/TruncatedText";
import { requestDiscoverKitchensWalkthrough } from "@/components/kitchen-application/DiscoverKitchensButtonTour";

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
}: OverviewTabContentProps) {
  const { t, i18n } = useTranslation("chef");
  const tr = t as unknown as import("i18next").TFunction;
  const { data: shopStatus } = useShopStatus();
  const dashboardLinkMutation = useStripeDashboardLink();
  const { toast } = useToast();

  const { user: authUser } = useFirebaseAuth();
  const { data: viewings = [] } = useQuery({
    queryKey: ["/api/viewings", "chef", authUser?.uid],
    queryFn: async () => {
      if (!authUser) return [];
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/viewings/chef", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to fetch viewings");
        return res.json();
      } catch (error) {
        console.error(error);
        return [];
      }
    },
    enabled: !!authUser?.uid,
  });


  const latestApp = getMostRecentApplication();
  const sellerStatus = getApplicationStatus();
  const documentStatus = getDocumentStatus();
  const firstName = user?.displayName?.split(" ")[0];
  const showSellerAccount = Boolean(isSellerApplicationFullyApproved && isShopCreated);

  const kitchenDisplays = useMemo(
    () => kitchenApplications.map((app) => ({ app, display: getKitchenDisplayStatus(app, t) })),
    [kitchenApplications, t]
  );

  const upcomingBookings = useMemo(() => {
    return (enrichedBookings || [])
      .filter((booking) => booking.status === "pending" || booking.status === "confirmed")
      .sort((a, b) => {
        const priority = a.status === "pending" ? 0 : 1;
        const other = b.status === "pending" ? 0 : 1;
        if (priority !== other) return priority - other;
        return (
          (a.bookingDate || "").localeCompare(b.bookingDate || "") ||
          (a.startTime || "").localeCompare(b.startTime || "")
        );
      });
  }, [enrichedBookings]);

  const nextBooking = upcomingBookings[0];

  const kitchenHint = useMemo(() => {
    const actionNeeded = kitchenDisplays.filter((item) => item.display.tone === "warning").length;
    const inReview = kitchenDisplays.filter((item) => item.display.tone === "progress").length;
    if (actionNeeded > 0) {
      return actionNeeded === 1 ? t("ovKitchenNeedsYouOne") : t("ovKitchenNeedsYou", { count: actionNeeded });
    }
    if (inReview > 0) {
      return inReview === 1 ? t("ovWaitingReviewOne") : t("ovWaitingReview", { count: inReview });
    }
    return kitchenApplications.length > 0 ? t("ovOpenKitchenAccess") : t("ovBrowseKitchensHint");
  }, [kitchenDisplays, kitchenApplications.length, t]);

  const bookingsHint = nextBooking
    ? `${formatBookingWhen(nextBooking, t, i18n.language)}${nextBooking.startTime ? ` · ${formatTime(nextBooking.startTime)}` : ""}`
    : enrichedBookings?.length
      ? t("ovNoUpcomingSessions")
      : t("ovNoSessionsBooked");

  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      description: string;
      cta: string;
      onClick: () => void;
    }> = [];

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
          title: display.stepCaption,
          description: app.location?.name || t("ovKitchenFallback"),
          cta: display.actionLabel || t("ovContinueCta"),
          onClick: () => onSetActiveTab("kitchen-applications"),
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
    if (upcomingBookings.length > 0) {
      return t("ovSubtitleUpcoming", { count: upcomingBookings.length });
    }
    if (!applications.length && kitchenApplications.length === 0) {
      return t("ovSubtitleStart");
    }
    return t("ovSubtitleAllSet");
  }, [attentionItems, upcomingBookings.length, applications.length, kitchenApplications.length, t]);

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {getGreeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

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
          onClick={() =>
            onSetActiveTab(
              kitchenApplications.length > 0 ? "kitchen-applications" : "discover-kitchens"
            )
          }
        />
        <StatCard
          label={t("ovStatKitchenTours", "Kitchen Tours")}
          value={viewings.length > 0 ? viewings.length.toString() : t("ovNone", "None")}
          hint={viewings.length > 0 ? t("ovViewingsScheduled", "Tours scheduled") : t("ovNoViewings", "No tours scheduled")}
          tone={viewings.length > 0 ? "success" : "neutral"}
          onClick={() => onSetActiveTab("viewings")}
        />
        <StatCard
          label={t("ovStatBookings")}
          value={
            upcomingBookings.length
              ? t("ovBookingsUpcoming", { count: upcomingBookings.length })
              : enrichedBookings?.length
                ? t("ovBookingsTotal", { count: enrichedBookings.length })
                : t("ovNone")
          }
          hint={bookingsHint}
          tone={
            upcomingBookings.some((booking) => booking.status === "pending")
              ? "warning"
              : upcomingBookings.length
                ? "success"
                : "neutral"
          }
          onClick={() => onSetActiveTab("bookings")}
        />
      </div>

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
                      <ArrowRight className="h-3.5 w-3.5" />
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
                  <Badge variant="success" className="shrink-0 font-medium">
                    {t("ovConnected")}
                  </Badge>
                ) : (
                  <Badge variant="warning" className="shrink-0 font-medium">
                    {t("ovPayoutsOff")}
                  </Badge>
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
            <CardFooter className="mt-auto flex-row justify-end gap-2">
              {shopStatus?.linked ? (
                <>
                  <Button variant="outline" size="sm" onClick={openShop}>
                    {t("ovShopBtn")}
                    <ExternalLink />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenDashboard}
                    disabled={dashboardLinkMutation.isPending}
                  >
                    {t("ovStripeBtn")}
                    {dashboardLinkMutation.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ExternalLink />
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSetActiveTab("my-account")}
                >
                  {t("ovOpenAccounts")}
                  <ArrowRight />
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
                <Badge variant={applicationStatusVariant(latestApp.status)} className="shrink-0 font-medium">
                  {formatApplicationStatus(latestApp.status, t)}
                </Badge>
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
            <CardFooter className="mt-auto flex-row justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetActiveTab("applications")}
              >
                {t("ovViewApplication")}
                <ArrowRight />
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{t("ovKitchenAccessTitle")}</CardTitle>
                  <CardDescription className="mt-1">
                    {t("ovKitchenAccessDesc")}
                  </CardDescription>
                </div>
                <Badge variant={kitchenSummary.variant} className="shrink-0 font-medium">
                  {kitchenSummary.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 pt-0">
              <div className="divide-y border-y">
                {kitchenDisplays.slice(0, 3).map(({ app, display }) => (
                  <div key={app.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <TruncatedText as="p" className="truncate text-sm font-medium">
                        {app.location?.name || t("ovKitchenFallback")}
                      </TruncatedText>
                      <TruncatedText as="p" className="truncate text-xs text-muted-foreground">{display.stepCaption}</TruncatedText>
                    </div>
                    <Badge variant={toneToBadgeVariant(display.tone)} className="shrink-0 font-medium">
                      {display.label}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter className="mt-auto flex-row justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetActiveTab("kitchen-applications")}
              >
                {t("ovMyKitchensBtn")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  requestDiscoverKitchensWalkthrough();
                  onSetActiveTab("discover-kitchens");
                }}
              >
                {t("ovExploreKitchensBtn")}
                <ArrowRight />
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <KitchenPathEmptyCard
            loading="eager"
            compact={Boolean(showSellerAccount || latestApp)}
            onExplore={() => {
              requestDiscoverKitchensWalkthrough();
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

function formatBookingWhen(
  booking: EnrichedBooking,
  t: import("i18next").TFunction<"chef", undefined>,
  locale?: string
): string {
  const bookingDateObj = booking.bookingDate
    ? new Date(booking.bookingDate + "T00:00:00")
    : null;
  if (!bookingDateObj) return t("ovScheduled");

  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (today.toDateString() === bookingDateObj.toDateString()) return t("ovToday");
  if (tomorrow.toDateString() === bookingDateObj.toDateString()) return t("ovTomorrow");
  return formatDate(booking.bookingDate, "short", undefined, locale);
}

const bookingStatusConfig: Record<
  string,
  { labelKey: string; fallback: string; variant: StatusVariant; tone: StatusTone }
> = {
  confirmed: { labelKey: "ovBookingConfirmed", fallback: "Confirmed", variant: "success", tone: "success" },
  pending: { labelKey: "ovBookingPending", fallback: "Awaiting approval", variant: "warning", tone: "warning" },
  completed: { labelKey: "ovBookingCompleted", fallback: "Completed", variant: "outline", tone: "neutral" },
  cancelled: { labelKey: "ovBookingCancelled", fallback: "Cancelled", variant: "outline", tone: "neutral" },
};

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

  const sortedBookings = [...bookings].sort((a, b) => {
    const priority: Record<string, number> = {
      pending: 0,
      confirmed: 1,
      completed: 2,
      cancelled: 3,
    };
    const pa = priority[a.status] ?? 4;
    const pb = priority[b.status] ?? 4;
    if (pa !== pb) return pa - pb;
    return (
      (a.bookingDate || "").localeCompare(b.bookingDate || "") ||
      (a.startTime || "").localeCompare(b.startTime || "")
    );
  });

  const displayBookings = sortedBookings.slice(0, 4);
  const pendingCount = bookings.filter((booking) => booking.status === "pending").length;
  const confirmedCount = bookings.filter((booking) => booking.status === "confirmed").length;

  const descriptionParts = [
    pendingCount ? t("ovAwaitingApproval", { count: pendingCount }) : null,
    confirmedCount ? t("ovConfirmed", { count: confirmedCount }) : null,
  ].filter(Boolean);

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("ovBookingsTitle")}</CardTitle>
            <CardDescription>
              {descriptionParts.length > 0 ? descriptionParts.join(" · ") : t("ovRecentSessions")}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onViewAll}>
            {t("ovViewAllBtn")}
            <ArrowRight />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y border-t">
          {displayBookings.map((booking) => {
            const config = bookingStatusConfig[booking.status] || {
              labelKey: booking.status,
              fallback: booking.status,
              variant: "outline" as const,
              tone: "neutral" as const,
            };
            const timeLabel =
              booking.startTime && booking.endTime
                ? `${formatTime(booking.startTime)} – ${formatTime(booking.endTime)}`
                : "";

            return (
              <button
                key={booking.id}
                type="button"
                className="flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-muted/40"
                onClick={onViewAll}
              >
                <div className="w-[4.5rem] shrink-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {formatBookingWhen(booking, t, locale)}
                  </p>
                  {booking.startTime && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatTime(booking.startTime)}
                    </p>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <TruncatedText as="p" className="truncate text-sm font-medium">
                    {booking.kitchenName || booking.locationName || t("ovKitchenSession")}
                  </TruncatedText>
                  {timeLabel && (
                    <TruncatedText as="p" className="truncate text-xs text-muted-foreground">{timeLabel}</TruncatedText>
                  )}
                </div>
                <Badge variant={config.variant} className="shrink-0 font-medium">
                  {t(config.labelKey as never, { defaultValue: config.fallback })}
                </Badge>
              </button>
            );
          })}
        </div>
        {bookings.length > 4 && (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onViewAll}>
            {t("ovMore", { count: bookings.length - 4 })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
