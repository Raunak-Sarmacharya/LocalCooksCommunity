import { bookingListBounds, bookingListPill, chefBookingTabs, chefNextVisit, listDayLabel, listTimezone, listWhenLine, waitingForChef, type BookingListRow } from "@/lib/booking-list-status";
import { invitationOpen, invitationRequest, type Invitation } from "@/lib/invitations";
import { listRentals, storageDay } from "@/lib/storage-rentals";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { openChefShopHome, useEarningsSummary, useShopStatus } from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { documentToneFromLabel, getKitchenDisplayStatus, isActiveKitchenApplication } from "@/components/chef/applications/status";
import { KitchenAccessTracker } from "@/components/chef/applications/KitchenAccessTracker";
import type {
  AnyApplication,
  KitchenApplicationWithLocation,
  KitchenSummary,
  EnrichedBooking,
} from "./types";
import { tt } from "@/i18n/common-ns";
import { useLocation } from "wouter";
import { normalizeChefTourRow, viewingStatusBadge, type ChefTourRow } from "@/lib/chef-viewing-display";
import { useTourClock } from "@/hooks/use-tour-clock";
import { DEFAULT_TIMEZONE } from "@shared/timezone-utils";

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
  const [, navigate] = useLocation();

  const { user: authUser } = useFirebaseAuth();
  const { data: viewings = [], isLoading: toursLoading } = useQuery({
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


  const latestApp = getMostRecentApplication();
  const documentStatus = getDocumentStatus();
  const firstName = user?.displayName?.split(" ")[0];
  const showSellerAccount = Boolean(isSellerApplicationFullyApproved && isShopCreated);

  const kitchenDisplays = useMemo(
    () => kitchenApplications.map((app) => ({ app, display: getKitchenDisplayStatus(app, t) })),
    [kitchenApplications, t]
  );
  const hasApprovedKitchen = kitchenApplications.some(
    (app) => app.status === "approved" && (app.current_tier ?? 1) >= 3
  );
  const openKitchenPreview = (locationId: number) => navigate(`/kitchen-preview/${locationId}`);

  // Same phases and order as My bookings: the tile shows the next visit (happening now or confirmed), never a request.
  const bookingSummary = useMemo(() => chefNextVisit((enrichedBookings || []) as unknown as BookingListRow[]), [enrichedBookings]);
  const confirmedNext = bookingSummary.next?.row as EnrichedBooking | undefined;


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
    // The kitchen offered other times, or asks whether the chef is still coming: the chef must answer.
    for (const tour of tourRows) {
      // Toured and liked it: the next step is the request to apply at that kitchen.
      if (tour.status === 'completed' && tour.locationId && !kitchenApplications.some((app) => app.locationId === tour.locationId)) items.push({ id: `tour-apply-${tour.id}`, title: t('homeTodoApplyAfterTour', { kitchen: tour.kitchenName || tour.locationName }), description: t('homeTodoApplyAfterTourHint'), cta: t('homeRequestToApply'), onClick: () => navigate(`/apply-kitchen/${tour.locationId}?tourId=${tour.id}`) });
      if (tour.status === 'pending' && tour.rescheduleProposedSlots?.length) items.push({ id: `tour-offer-${tour.id}`, title: t('homeTodoTourOffer', { kitchen: tour.kitchenName || tour.locationName }), description: `TOUR-${tour.id}`, cta: t('homeReview'), onClick: () => navigate(`/dashboard?view=viewings&viewing=${tour.id}`) });
      if (tour.reconfirmation?.canReply && !tour.reconfirmation.reply) items.push({ id: `tour-reconfirm-${tour.id}`, title: t('homeTodoTourReconfirm', { kitchen: tour.kitchenName || tour.locationName }), description: `TOUR-${tour.id}`, cta: t('homeReview'), onClick: () => navigate(`/dashboard?view=viewings&viewing=${tour.id}`) });
    }
    // Closed on its own with no result: invite the next step instead of asking them to "review" an outcome nobody reported.
    for (const tour of tourRows.filter(tour => tour.disruptionReason === 'outcome_unknown' && tour.locationId && !kitchenApplications.some((app) => app.locationId === tour.locationId))) {
      items.push({ id: `tour-closed-${tour.id}`, title: t('homeTodoTourClosed', { kitchen: tour.kitchenName || tour.locationName }), description: t('homeTodoApplyAfterTourHint'), cta: t('homeRequestToApply'), onClick: () => navigate(`/apply-kitchen/${tour.locationId}?tourId=${tour.id}`) });
    }
    for (const tour of tourRows.filter(tour => tour.status === 'no_show' || (tour.disruptionReason && tour.disruptionReason !== 'outcome_unknown'))) {
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
          title: display.actionLabel || t("ovContinueCta"),
          description: app.location?.name || t("ovKitchenFallback"),
          cta: t("ovContinueCta"),
          onClick: () => navigate(`/dashboard?view=kitchen-requests&application=${app.id}`),
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
      .filter((item) => item.id !== "training" && !/train/i.test(item.title));
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

  const openShop = () => openChefShopHome();
  const showSkeleton = isLoading || toursLoading;

  const locale = i18n.language || "en-CA";
  const words = { today: t("ovToday"), tomorrow: t("ovTomorrow") };

  // The chef's chosen paths (setup choice). Same cache key as the onboarding-status hook.
  const { data: profile } = useQuery<{ chefOnboardingPaths?: string[] }>({
    queryKey: ["/api/user/profile", authUser?.uid],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/user/profile", { headers: { Authorization: `Bearer ${token}` } });
      return res.ok ? res.json() : {};
    },
    enabled: !!authUser?.uid,
  });
  const paths = profile?.chefOnboardingPaths ?? [];
  const wantsKitchens = paths.includes("kitchen") || kitchenApplications.length > 0 || (enrichedBookings?.length ?? 0) > 0;
  const wantsSelling = paths.includes("localcooks") || Boolean(latestApp);

  const { data: invitationData } = useQuery({
    queryKey: ["chef-invitations"], staleTime: 30_000, retry: false,
    queryFn: () => invitationRequest<{ invitations: Invitation[] }>("/api/chef/invitations"),
  });
  const openInvitations = (invitationData?.invitations || []).filter(invitationOpen);

  const { data: rentals = [] } = useQuery({ queryKey: ["/api/chef/storage-rentals"], queryFn: listRentals, staleTime: 30_000, retry: false });
  const currentRentals = rentals.filter((r) => ["reserved", "active", "move_out_requested"].includes(r.state));

  const { data: weekEarnings } = useEarningsSummary({ period: "week", enabled: Boolean(showSellerAccount && shopStatus?.linked) });
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(amount);

  const upcoming = useMemo(() => chefBookingTabs((enrichedBookings || []) as unknown as BookingListRow[]).upcoming, [enrichedBookings]);
  // Nothing confirmed yet: Up next shows the first request still waiting on the kitchen.
  const nextBooking = confirmedNext ?? (upcoming[0]?.row as unknown as EnrichedBooking | undefined);
  const nextIsRequest = !confirmedNext && Boolean(nextBooking);
  // A tour that is still ahead (requested or confirmed) belongs in Up next too.
  const nextTour = tourRows
    .filter((tour) => ["pending", "pending_local_cooks", "confirmed"].includes(tour.status) && Date.parse(tour.scheduledAt) + (tour.durationMinutes ?? 30) * 60_000 > Date.now())
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  const nextStart = nextBooking ? bookingListBounds(nextBooking as unknown as BookingListRow)?.startAt.getTime() ?? Infinity : Infinity;
  const tourFirst = Boolean(nextTour) && Date.parse(nextTour!.scheduledAt) < nextStart;
  const tourWhen = (tour: ChefTourRow) => {
    const start = new Date(tour.scheduledAt);
    const end = new Date(start.getTime() + (tour.durationMinutes ?? 30) * 60_000);
    const zone = DEFAULT_TIMEZONE;
    const day = listDayLabel(start, zone, locale, words);
    const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" });
    return `${day} · ${time.format(start)}–${time.format(end)}`;
  };
  const openTour = (tour: ChefTourRow) => navigate(`/dashboard?view=viewings&viewing=${tour.id}`);
  const weekAhead = Date.now() + 7 * 86_400_000;
  const laterThisWeek = upcoming.filter(({ row }) => (row as unknown as EnrichedBooking).id !== nextBooking?.id && (bookingListBounds(row)?.startAt.getTime() ?? Infinity) < weekAhead).slice(0, 3);
  const nextBounds = nextBooking ? bookingListBounds(nextBooking as unknown as BookingListRow) : null;
  const opensAt = nextBounds && nextBounds.opensAt.getTime() > Date.now()
    ? new Intl.DateTimeFormat(locale, { timeZone: listTimezone(nextBooking as unknown as BookingListRow), hour: "numeric", minute: "2-digit" }).format(nextBounds.opensAt)
    : null;
  const offers = upcoming.filter(({ row }) => waitingForChef(row));

  // To do: what the chef must answer or fix, one button each.
  const todo = [
    ...openInvitations.map((inv) => ({
      id: `inv-${inv.id}`,
      title: t("homeTodoInvitation", { kitchen: inv.kitchen.name }),
      description: `${new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${inv.date}T12:00:00Z`))} · ${money(inv.pricing.totalCents / 100)}`,
      cta: t("homeReview"),
      onClick: () => navigate(`/invitation/${inv.id}`),
    })),
    ...offers.map(({ row }) => {
      const booking = row as unknown as EnrichedBooking;
      return {
        id: `offer-${booking.id}`,
        title: t("homeTodoOffer", { kitchen: booking.kitchenName || booking.locationName || t("ovKitchenFallback") }),
        description: listWhenLine(row, locale, words),
        cta: t("homeReview"),
        onClick: () => navigate(`/booking/${booking.id}`),
      };
    }),
    // Storage that needs the chef now: items under removal review, or past the paid days.
    ...rentals.filter((r) => r.state === "removal_review" || r.phase === "grace" || r.phase === "holdover").map((r) => ({
      id: `storage-${r.id}`,
      title: t(r.state === "removal_review" ? "homeTodoStorageRemoval" : "homeTodoStorageOverdue", { unit: `${r.listing.name} · ${r.unitLabel}` }),
      description: r.kitchen.name,
      cta: t("homeReview"),
      onClick: () => navigate(`/storage/${r.id}`),
    })),
    ...attentionItems,
  ];

  const kitchenSteps = [
    // A declined or withdrawn request doesn't count: the next step is finding a kitchen again.
    { done: kitchenApplications.some(isActiveKitchenApplication), title: t("homeStepFind"), hint: t("homeStepFindHint"), action: { label: t("homeFindKitchens"), onClick: () => onSetActiveTab("discover-kitchens") } },
    // While every request is still with the kitchen, the next step isn't the chef's yet.
    { done: hasApprovedKitchen, title: t("homeStepRequirements"), hint: t("homeStepRequirementsHint"),
      waiting: !hasApprovedKitchen && kitchenDisplays.some(({ display }) => display.actionKind === "wait") && !kitchenDisplays.some(({ display }) => display.actionKind === "complete-step") },
    { done: (enrichedBookings?.length ?? 0) > 0, title: t("homeStepBook"), hint: t("homeStepBookHint") },
  ];
  const sellerApproved = latestApp?.status === "approved";
  const sellingSteps = [
    { done: Boolean(latestApp), title: t("homeStepApply"), hint: t("homeStepApplyHint"), action: { label: t("homeStartApplication"), onClick: () => { onSetApplicationViewMode("form"); onSetActiveTab("applications"); } } },
    { done: sellerApproved, title: t("homeStepApproved"), hint: t("homeStepApprovedHint") },
    { optional: true, done: trainingStatusLabel === "Completed" || trainingStatusLabel === "trainingCompleted", title: t("homeStepTraining"), hint: t("homeStepTrainingHint"), action: { label: t("homeOpenTraining"), onClick: () => onSetActiveTab("training") } },
  ];
  // One checklist per path (owner, Oct 25): each closes on its own once its required steps are done.
  const checklists = [
    ...(wantsKitchens || !wantsSelling ? [{ id: "kitchen", title: t("homeSetupKitchens"), steps: kitchenSteps }] : []),
    ...(wantsSelling ? [{ id: "selling", title: t("homeSetupSelling"), steps: sellingSteps }] : []),
  ].filter((list) => list.steps.some((step) => !step.done && !("optional" in step && step.optional)));
  // Once something real is happening, setup shrinks to one line under it and can be hidden (Shopify setup guide pattern).
  const hasActivity = Boolean(nextBooking) || tourRows.length > 0 || kitchenApplications.length > 0 || Boolean(latestApp) || currentRentals.length > 0;
  const hideKey = (id: string) => `lc-home-hide-setup-${authUser?.uid}-${id}`;
  const [hiddenLists, setHiddenLists] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : ["kitchen", "selling"].filter((id) => localStorage.getItem(hideKey(id)) === "1"));
  const hideList = (id: string) => { localStorage.setItem(hideKey(id), "1"); setHiddenLists((ids) => [...ids, id]); };
  const visibleChecklists = checklists.filter((list) => !hasActivity || !hiddenLists.includes(list.id));

  const dateLine = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  if (showSkeleton) {
    return (
      <div className="space-y-6" aria-busy data-testid="overview-skeleton">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-56 lg:col-span-2" /><Skeleton className="h-56" /></div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  const readyKitchen = !nextBooking && !nextTour ? kitchenDisplays.find(({ display }) => display.actionKind === "book")?.app : undefined;
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 sm:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{firstName ? `${getGreeting()}, ${firstName}` : getGreeting()}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{dateLine}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {nextTour && (tourFirst || !nextBooking) ? (
          <HomePanel className={cn(showSellerAccount ? "lg:col-span-6" : todo.length ? "lg:col-span-8" : "lg:col-span-12")} title={t("homeUpNext")} link={{ label: t("homeAllTours"), onClick: () => onSetActiveTab("viewings") }}>
            <p className="text-sm font-semibold tabular-nums">{tourWhen(nextTour)}</p>
            <p className="mt-0.5 text-xl font-semibold tracking-[-0.015em]">{t("homeTourAt", { kitchen: nextTour.kitchenName || nextTour.locationName })}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[nextTour.kitchenName ? nextTour.locationName : null, nextTour.status === "confirmed" ? t("homeTourConfirmed") : t("homeWaitingForKitchen")].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full px-4" onClick={() => openTour(nextTour)}>{t("homeOpenTour")}</Button>
            </div>
            {nextBooking && (
              <div className="mt-5 border-t pt-3">
                <p className="text-xs text-muted-foreground">{t("homeAfterThat")}</p>
                <HomeRow title={listWhenLine(nextBooking as unknown as BookingListRow, locale, words)} sub={nextBooking.kitchenName || nextBooking.locationName || ""} onClick={() => navigate(`/booking/${nextBooking.id}`)} />
              </div>
            )}
          </HomePanel>
        ) : nextBooking ? (
          <HomePanel className={cn(showSellerAccount ? "lg:col-span-6" : todo.length ? "lg:col-span-8" : "lg:col-span-12")} title={t("homeUpNext")} link={{ label: t("homeAllBookings"), onClick: () => onSetActiveTab("bookings") }}>
            <p className="text-sm font-semibold tabular-nums">{listWhenLine(nextBooking as unknown as BookingListRow, locale, words)}</p>
            <p className="mt-0.5 text-xl font-semibold tracking-[-0.015em]">{nextBooking.kitchenName || nextBooking.locationName}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[nextBooking.locationName !== nextBooking.kitchenName ? nextBooking.locationName : null, nextIsRequest ? t("homeWaitingForKitchen") : opensAt ? t("homeCheckInOpens", { time: opensAt }) : null].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full px-4" onClick={() => navigate(`/booking/${nextBooking.id}`)}>{t("homeOpenBooking")}</Button>
              {bookingSummary.upcoming > 1 && (
                <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => onSetActiveTab("bookings")}>{t("homeAllBookings")}</Button>
              )}
            </div>
            {laterThisWeek.length > 0 && (
              <div className="mt-5 border-t pt-3">
                <p className="text-xs text-muted-foreground">{t("homeLaterThisWeek")}</p>
                <div>{laterThisWeek.map(({ row, phase }) => {
                  const booking = row as unknown as EnrichedBooking;
                  return (
                    <HomeRow key={booking.id} title={listWhenLine(row, locale, words)} sub={booking.kitchenName || booking.locationName || ""} onClick={() => navigate(`/booking/${booking.id}`)}
                      end={<StatusWord tone={phase === "confirmed" ? "ok" : "wait"}>{t(bookingListPill(phase, false).key as never)}</StatusWord>} />
                  );
                })}</div>
              </div>
            )}
            {nextTour && !tourFirst && (
              <div className="mt-3 border-t pt-3">
                <HomeRow title={tourWhen(nextTour)} sub={t("homeTourAt", { kitchen: nextTour.kitchenName || nextTour.locationName })} onClick={() => openTour(nextTour)}
                  end={<StatusWord tone={nextTour.status === "confirmed" ? "ok" : "wait"}>{nextTour.status === "confirmed" ? t("homeTourConfirmed") : t("homeTourRequested")}</StatusWord>} />
              </div>
            )}
          </HomePanel>
        ) : readyKitchen ? (
          // Approved, nothing booked yet: the next step is booking (owner-approved mock, Oct 26).
          <HomePanel className={cn(showSellerAccount ? "lg:col-span-6" : todo.length ? "lg:col-span-8" : "lg:col-span-12")} title={t("homeUpNext")}>
            <p className="text-xl font-semibold tracking-[-0.015em]">{t("homeNothingBooked", "Nothing booked yet")}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("homeReadyWhenYou", { defaultValue: "{kitchen} is ready when you are.", kitchen: readyKitchen.location?.name || t("ovKitchenFallback") })}</p>
            <div className="mt-4"><Button size="sm" className="rounded-full px-4" onClick={() => openKitchenPreview(readyKitchen.locationId)}>{t("kdBook", "Book kitchen time")}</Button></div>
          </HomePanel>
        ) : null}

        {showSellerAccount && (
          <HomePanel className={cn(nextBooking ? "lg:col-span-6" : "lg:col-span-12")} title={t("homeYourShop")} link={shopStatus?.linked ? { label: t("homeOpenShop"), onClick: openShop } : undefined}>
            {shopStatus?.linked && weekEarnings ? (
              <>
                <p className="text-xs text-muted-foreground">{t("homeLast7Days")}</p>
                <p className="mt-1 flex items-baseline gap-2 tabular-nums">
                  <span className="text-2xl font-medium tracking-[-0.02em]">{money(weekEarnings.earnings.total_earnings)}</span>
                  <span className="text-sm text-muted-foreground">{t("homeFromOrders", { count: weekEarnings.earnings.total_orders })}</span>
                </p>
                <div className="mt-3">
                  <HomeRow title={t("homeToBePaidOut")} sub={t("homeToBePaidOutHint")} end={<span className="text-sm tabular-nums">{money(weekEarnings.earnings.total_due)}</span>} />
                  <HomeRow title={t("homeEarningsAndOrders")} sub={t("homeEarningsAndOrdersHint")} onClick={() => onSetActiveTab("seller-revenue")} end={<span className="text-sm font-semibold underline underline-offset-[3px]">{t("homeView")}</span>} />
                </div>
              </>
            ) : (
              <HomeRow title={t("homeFinishShopSetup")} sub={t("homeFinishShopSetupHint")} onClick={() => onSetActiveTab("my-account")} end={<span className="text-sm font-semibold underline underline-offset-[3px]">{t("homeOpenAccounts")}</span>} />
            )}
          </HomePanel>
        )}

        {todo.length > 0 && (
          <HomePanel className={cn((nextBooking || nextTour) && !showSellerAccount ? "lg:col-span-4" : "lg:col-span-12")} title={t("homeToDo")} count={todo.length}>
            <div className="grid gap-2">
              {todo.slice(0, 5).map((item) => (
                <div key={item.id} className={cn("grid items-center gap-3 rounded-md border border-border/70 bg-muted/30 px-3.5 py-3", (nextBooking || nextTour) && !showSellerAccount ? "grid-cols-1" : "sm:grid-cols-[1fr_auto]")}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-[13px] text-muted-foreground">{item.description}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 justify-self-start rounded-full bg-background px-3" onClick={item.onClick}>{item.cta}</Button>
                </div>
              ))}
            </div>
          </HomePanel>
        )}

        {!hasActivity && checklists.map((list) => {
          const done = list.steps.filter((step) => step.done).length;
          const firstOpen = list.steps.findIndex((step) => !step.done);
          return (
            <HomePanel key={list.id} className={cn(checklists.length > 1 || kitchenDisplays.length ? "lg:col-span-6" : "lg:col-span-12")} title={list.title}
              aside={<span className="text-[13px] tabular-nums text-muted-foreground">{t("homeStepsDone", { done, total: list.steps.length })}</span>}>
              <ol>
                {list.steps.map((step, i) => (
                  <li key={step.title} className="grid grid-cols-[22px_1fr] items-center gap-x-3 gap-y-2 border-t py-2.5 first:border-t-0 sm:grid-cols-[22px_1fr_auto]">
                    <span aria-hidden className={cn("grid h-[22px] w-[22px] place-items-center rounded-full", step.done ? "bg-foreground text-background" : "shadow-[inset_0_0_0_1.5px_hsl(var(--border))]")}>
                      {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through decoration-border")}>{step.title}<span className="sr-only">{step.done ? ` (${t("homeDone")})` : ""}</span></p>
                      {!step.done && <p className="text-[13px] text-muted-foreground">{step.hint}</p>}
                    </div>
                    {i === firstOpen && "action" in step && step.action ? (
                      <Button size="sm" className="col-start-2 justify-self-start rounded-full px-4 sm:col-start-auto" onClick={step.action.onClick}>{step.action.label}</Button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </HomePanel>
          );
        })}

        {kitchenDisplays.length > 0 && (
          <HomePanel className={cn(currentRentals.length ? "lg:col-span-6" : "lg:col-span-12")} title={t("homeYourKitchens")} count={kitchenDisplays.length} link={{ label: t("homeFindMore"), onClick: () => onSetActiveTab("discover-kitchens") }}>
            {kitchenDisplays.map(({ app, display }) => (
              <HomeRow key={app.id} title={app.location?.name || t("ovKitchenFallback")} sub=""
                onClick={() => display.actionKind === "book" ? openKitchenPreview(app.locationId) : navigate(`/dashboard?view=kitchen-requests&application=${app.id}`)}
                end={<>
                  <KitchenAccessTracker app={app} mini className="hidden sm:flex" />
                  <StatusWord tone={display.tone === "success" ? "ok" : display.tone === "warning" || display.tone === "danger" ? "warn" : "wait"}>{display.label}</StatusWord>
                  {display.actionKind === "book" && <span className="text-sm font-semibold underline underline-offset-[3px]">{t("homeBook")}</span>}
                </>} />
            ))}
          </HomePanel>
        )}

        {currentRentals.length > 0 && (
          <HomePanel className="lg:col-span-6" title={t("homeStorage")} count={currentRentals.length} link={{ label: t("homeManage"), onClick: () => navigate("/storage") }}>
            {currentRentals.map((rental) => (
              <HomeRow key={rental.id} title={rental.listing.name} sub={`${rental.kitchen.name} · ${t("homeUntil", { date: storageDay(rental.paidThrough, locale) })}`} onClick={() => navigate(`/storage/${rental.id}`)}
                end={<StatusWord tone={rental.state === "active" ? "ok" : "wait"}>{t(rental.state === "active" ? "homeActive" : rental.state === "reserved" ? "homeReserved" : "homeMovingOut")}</StatusWord>} />
            ))}
          </HomePanel>
        )}

        {hasActivity && visibleChecklists.length > 0 && (
          <section className="lg:col-span-12 rounded-lg border bg-card px-4 sm:px-5" aria-label={t("homeGetSetUp")}>
            {visibleChecklists.map((list) => {
              const done = list.steps.filter((step) => step.done).length;
              const next = list.steps.find((step) => !step.done);
              return (
                <div key={list.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-3 first:border-t-0">
                  <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">{list.title}</span><span className="ml-2 tabular-nums text-muted-foreground">{t("homeStepsDone", { done, total: list.steps.length })}</span></p>
                  {next && "action" in next && next.action ? <Button size="sm" variant="outline" className="h-8 rounded-full px-3" onClick={next.action.onClick}>{next.action.label}</Button>
                    : next ? <span className="text-[13px] text-muted-foreground">{"waiting" in next && next.waiting ? t("kdInReview", "Waiting for the kitchen") : next.title}</span> : null}
                  <button type="button" onClick={() => hideList(list.id)} className="text-[13px] text-muted-foreground hover:text-foreground hover:underline">{t("homeHide")}</button>
                </div>
              );
            })}
          </section>
        )}

        {/* Not beside the kitchen checklist, which already offers the same thing. */}
        {!wantsKitchens && wantsSelling && (
          <HomePanel className="lg:col-span-12" title={t("homeKitchenToo")} link={{ label: t("homeFindKitchens"), onClick: () => onSetActiveTab("discover-kitchens") }}>
            <p className="text-sm text-muted-foreground">{t("homeKitchenTooBody")}</p>
          </HomePanel>
        )}

        {!wantsSelling && (
          <HomePanel className="lg:col-span-12" title={t("homeSellToo")} link={{ label: t("homeStartApplication"), onClick: () => { onSetApplicationViewMode("form"); onSetActiveTab("applications"); } }}>
            <p className="text-sm text-muted-foreground">{t("homeSellTooBody")}</p>
          </HomePanel>
        )}
      </div>
    </div>
  );
}

function HomePanel({ title, count, link, aside, className, children }: { title: string; count?: number; link?: { label: string; onClick: () => void }; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">
          {title}
          {count != null && <span className="ml-2 rounded-full border bg-muted/40 px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{count}</span>}
        </h2>
        {link ? <button type="button" onClick={link.onClick} className="text-[13px] text-muted-foreground hover:text-foreground hover:underline">{link.label}</button> : aside}
      </div>
      {children}
    </section>
  );
}

function HomeRow({ title, sub, end, onClick }: { title: string; sub?: string; end?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">{title}</p>
        {sub ? <p className="truncate text-[13px] text-muted-foreground">{sub}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">{end}</div>
    </>
  );
  const cls = "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t py-3 text-left first:border-t-0";
  return onClick ? <button type="button" onClick={onClick} className={cn(cls, "-mx-1 rounded-sm px-1 hover:bg-muted/40")}>{body}</button> : <div className={cls}>{body}</div>;
}

/** Status as words with a small dot: colour only marks what needs the chef. */
function StatusWord({ tone, children }: { tone: "ok" | "warn" | "wait"; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]", tone === "warn" ? "text-foreground" : "text-muted-foreground")}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", tone === "ok" ? "bg-emerald-700" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/40")} />
      {children}
    </span>
  );
}
