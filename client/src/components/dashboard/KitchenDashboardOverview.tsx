import { managerNavIcons } from "@/lib/manager-nav-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createBookingDateTime, DEFAULT_TIMEZONE } from "@shared/timezone-utils";
import { bookingNextAction, tourNextAction, licenseNextAction, overstayNextAction, storageHasEnded } from "@/lib/manager-overview-lifecycle";
import { tourRequestDecision } from '@shared/tour-request-decision';
import { formatTourWhen } from '@/lib/chef-viewing-display';
import { isPendingOrUpcomingTour } from "@/lib/chef-viewing-display";
import { useTourClock } from "@/hooks/use-tour-clock";
import { tourActivity } from "@shared/tour-activity";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { apiGet } from "@/lib/api";
import { mt } from "@/i18n/manager";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { useManagerOverviewActivity } from "@/hooks/use-manager-overview-activity";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/formatters";
import { kitchenIsVisibleToChefs, licenseAllowsBookings } from "@shared/kitchen-license";
import { CheckCircle, ChevronRight, DollarSign } from "@/components/ui/manager-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import BookingCalendarWidget from "./BookingCalendarWidget";

interface Location { id: number; name: string; address: string; kitchenLicenseUrl?: string | null; kitchenLicenseStatus?: string | null; kitchenLicenseExpiry?: string | null; timezone?: string; kitchenLicensePendingUrl?: string | null; kitchenLicensePendingExpiry?: string | null }
interface Kitchen { id: number; locationId: number; name: string; isActive: boolean; listingStatus?: string }
interface Booking {
  attendanceReviewComplete?: boolean;
  paymentDecision?: { state?: string } | null;
  equipmentItems?: Array<{ id: number; equipmentBookingId?: number; status?: string; name?: string }>;
  id: number;
  locationId?: number;
  location?: { id: number };
  kitchenId: number;
  kitchenName?: string;
  chefName?: string;
  chefId?: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "cancellation_requested";
  createdAt: string;
  checkinStatus?: string | null;
  operatingWindowStartTime?: string | null;
}
interface Viewing { viewing: { id: number; locationId: number; status: string; scheduledAt: string; createdAt?: string; updatedAt?: string; durationMinutes?: number; requestedRescheduleAt?: string | null; disruptionReason?: string | null; outcomeHistory?: unknown; checkedInAt?: string | null; checkedOutAt?: string | null; attendanceHistory?: unknown; targetedKitchenId?: number | null; adminReviewDecision?: string | null; cancelledBy?: string | null }; chefName?: string; kitchenName?: string; locationName?: string }
interface Application { chefId?: number; createdAt?: string; updatedAt?: string; fullName?: string; id: number; locationId: number; status: string; current_tier?: number; currentTier?: number; tier2_completed_at?: string | null }
interface Revenue { completedNetRevenue?: number; netRevenue?: number; pendingPayments?: number; completedPayments?: number; paidBookingCount?: number }

interface Props {
  selectedLocation: Location | null;
  locations: Location[];
  kitchens: Kitchen[];
  onNavigate: (view: string, kitchenId?: number) => void;
  onSelectLocation?: (location: Location | null) => void;
}

const dayKey = (value: string) => value.slice(0, 10);
const displayDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value, "short", "UTC") : formatDate(value);
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * Listing row tone — mirrors the `KitchenListingStatus` bar on the review page so the row reads as a
 * scaled-down preview of the bar the click opens.
 *
 * Border is SOLID and full-opacity, not a /45 tint + shadow: at row scale the tint read as a faint
 * grey hairline and the row stopped looking like a discrete object you can act on. One semantic
 * token per state, one var carrying light+dark, no raw palette and no `dark:` twin.
 *
 * RED IS NOT USED HERE. Red means destruction only (delete / remove / take off listing) — see
 * `destructive` on the "Take off the listing" action. So the tone scale is:
 *   success green = earning, info blue = can earn, warning yellow = NEEDS ATTENTION (the manager
 *   has something to do), muted grey = stalled (nothing the manager can act on right now).
 * `hidden` is grey rather than yellow because "hidden by LocalCooks" is a stalled state resolved by
 * support, not a task on the manager. Kept in step with `KitchenListingStatus.tsx`'s `TONES` so the
 * row and the bar it opens agree.
 */
const LISTING_TONES = {
  live:    { border: "border-success",             dot: "bg-success" },
  ready:   { border: "border-info",                dot: "bg-info" },
  blocked: { border: "border-warning",             dot: "bg-warning" },
  hidden:  { border: "border-muted-foreground/40", dot: "bg-muted-foreground/50" },
} as const;
type ListingToneKey = keyof typeof LISTING_TONES;

/**
 * Destination per activity kind — drives the row's ICON and its click target from one place, so the
 * glyph is always the same glyph the sidebar and the "Needs attention" group use for that view.
 * `managerNavIcons` is the single source of truth: the sidebar, the command menu and the attention
 * groups all read it, so picking icons by hand here made e.g. a cancelled booking wear `Calendar`
 * while the sidebar's Bookings entry wore `CalendarDays`.
 */
const ACTIVITY_VIEW: Record<string, keyof typeof managerNavIcons> = {
  booking: "bookings",
  tour: "viewings",
  storage: "storage-bookings",
  application: "applications",
  claim: "damage-claims",
  overstay: "overstays",
};

/** The URL param each destination deep-links with. Bookings link straight to their own page. */
const ACTIVITY_PARAM: Record<string, string | undefined> = {
  booking: undefined,
  tour: "viewing",
  storage: "storageBooking",
  application: "application",
  claim: "claim",
  overstay: undefined,
};

/**
 * How many entries the Recent activity feed renders.
 *
 * This card is a FEED, not a work queue: it is informational, it is already sorted newest-first, and
 * every entry is also reachable from its own page (Bookings, Tours, Applications, …). So a hard cap
 * costs the manager nothing they need. Without it the card mounts every booking, tour, application,
 * storage booking, claim and overstay the location has EVER had — thousands of rows on a mature
 * account, all mounted at once inside a 320px scroll box with no virtualization.
 *
 * `attentionGroups` is deliberately NOT capped. That card is a WORK QUEUE: every row is money on the
 * table (a booking to confirm, an application to review), so silently truncating it would hide work.
 * It is self-limiting instead — items leave as they are actioned.
 */
const RECENT_ACTIVITY_LIMIT = 20;

export default function KitchenDashboardOverview({ selectedLocation, locations, kitchens, onNavigate, onSelectLocation }: Props) {
  const { user } = useFirebaseAuth();
  const { i18n } = useTranslation();
  const { bookings: allBookings, isLoadingBookings, isErrorBookings } = useManagerDashboard();
  const locationKitchens = kitchens.filter((kitchen) => !selectedLocation || kitchen.locationId === selectedLocation.id);
  const activity = useManagerOverviewActivity(selectedLocation?.id, locationKitchens.map((kitchen) => kitchen.id));
  const licenseForKitchen = (kitchen: Kitchen) => locations.find((location) => location.id === kitchen.locationId);
  const liveKitchens = locationKitchens.filter((kitchen) => kitchenIsVisibleToChefs(kitchen, licenseForKitchen(kitchen)));
  const draftKitchens = locationKitchens.filter((kitchen) => kitchen.listingStatus !== "active");
  const publishedKitchen = locationKitchens.find((kitchen) => kitchen.listingStatus === "active");
  const publishedButUnavailable = !!publishedKitchen && liveKitchens.length === 0;
  const licenseNeedsAttention = publishedButUnavailable && !licenseAllowsBookings(licenseForKitchen(publishedKitchen!) ?? {});
  const bookings = (allBookings as Booking[]).filter((booking) =>
    !selectedLocation || (booking.locationId ?? booking.location?.id) === selectedLocation.id,
  );

  const { data: viewings = [], isLoading: isLoadingViewings, isError: isErrorViewings } = useQuery<Viewing[]>({
    queryKey: ["managerViewings", user?.uid],
    queryFn: () => apiGet("/viewings/manager"),
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const locationViewings = viewings.filter((item) =>
    !selectedLocation || item.viewing.locationId === selectedLocation.id,
  );
  const upcomingTourEnds = locationViewings.filter(({ viewing }) => viewing.status === "confirmed")
    .map(({ viewing }) => Date.parse(viewing.scheduledAt) + (viewing.durationMinutes ?? 30) * 60_000)
    .filter(end => Number.isFinite(end) && end > Date.now());
  useTourClock(upcomingTourEnds.length ? Math.min(...upcomingTourEnds) : undefined);
  const { data: applications = [], isLoading: isLoadingApplications, isError: isErrorApplications } = useQuery<Application[]>({
    queryKey: ["/api/manager/kitchen-applications"],
    queryFn: () => apiGet("/manager/kitchen-applications"),
    enabled: !!user && locationKitchens.length > 0,
    staleTime: 30_000,
  });
  const locationApplications = applications.filter((application) =>
    !selectedLocation || application.locationId === selectedLocation.id,
  );

  const month = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const toKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { start: toKey(start), end: toKey(end) };
  }, []);
  const { data: revenue, isLoading: isLoadingRevenue, isError: isErrorRevenue } = useQuery<Revenue>({
    queryKey: ["/api/manager/revenue/overview", month.start, month.end, selectedLocation?.id],
    queryFn: () => apiGet(`/manager/revenue/overview?startDate=${month.start}&endDate=${month.end}${selectedLocation ? `&locationId=${selectedLocation.id}` : ""}`),
    enabled: !!user && (liveKitchens.length > 0 || bookings.length > 0 || activity.storageBookings.length > 0),
  });

  const tourTime = (tour: Viewing) => Number.isFinite(Date.parse(tour.viewing.scheduledAt)) ? new Date(tour.viewing.scheduledAt).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE }) : "";
  const today = todayKey();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 6);
  const nextWeekKey = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, "0")}-${String(nextWeek.getDate()).padStart(2, "0")}`;
  const pendingBookings = bookings.filter((booking) => booking.status === "pending");
  const pendingTours = locationViewings.filter((item) => item.viewing.status === "pending");
  const pendingApplications = locationApplications.filter((application) => application.status === "inReview" ||
    (application.status === "approved" && (application.current_tier ?? application.currentTier) === 2 && !!application.tier2_completed_at));
  const approvedApplications = locationApplications.filter((application) => application.status === "approved" && (application.current_tier ?? application.currentTier ?? 1) >= 2);
  const todayBookings = bookings.filter((booking) => dayKey(booking.bookingDate) === today && ["pending", "confirmed", "cancellation_requested"].includes(booking.status));
  const upcoming = bookings.filter((booking) => ["pending", "confirmed", "cancellation_requested"].includes(booking.status) && dayKey(booking.bookingDate) >= today && bookingNextAction(booking, locations.find((location) => location.id === (booking.locationId ?? booking.location?.id))?.timezone) !== "overviewBookingOutcomes")
    .sort((a, b) => `${a.bookingDate} ${a.startTime}`.localeCompare(`${b.bookingDate} ${b.startTime}`));
  const weekBookings = upcoming.filter((booking) => dayKey(booking.bookingDate) <= nextWeekKey);
  const bookingActivityLabel: Record<string, string> = { pending: "activityBookingRequested", confirmed: "activityBookingConfirmed", cancelled: "activityBookingCancelled", completed: "activityBookingCompleted", cancellation_requested: "activityBookingCancellationRequested" };
  const tourActivityLabel: Record<string, string> = { pending: "activityTourRequested", confirmed: "activityTourScheduled", cancelled: "activityTourCancelled", completed: "activityTourCompleted", no_show: "activityTourNoShow", rejected: "activityTourDeclined" };
  const chefDisplayName = (record: {chefName?: string; chefId?: number | null; fullName?: string}) => {
    const parentName = record.chefId ? (allBookings as Booking[]).find(booking => booking.chefId === record.chefId && booking.chefName && !booking.chefName.includes("@"))?.chefName : undefined;
    const name = [parentName, record.chefName, record.fullName, record.chefId ? applications.find(application => application.chefId === record.chefId)?.fullName : undefined].find(value => value?.trim() && !value.includes("@"));
    return name?.trim() || mt("guestChef");
  };
  const financialActivityStatus: Record<string,string> = {draft:"overviewDraft",submitted:"overviewAwaitingAdmin",under_review:"overviewAwaitingAdmin",chef_disputed:"overviewAwaitingAdmin",chef_accepted:"chefAccepted",approved:"approved",partially_approved:"partiallyApproved",charge_pending:"overviewPaymentProcessing",charge_failed:"chargeFailed",charge_succeeded:"overviewPaymentCollected",resolved:"overviewResolved",rejected:"rejected",expired:"overviewExpired",escalated:"overviewEscalated",pending_review:"overviewAwaitingReview",penalty_approved:"approved",penalty_waived:"overviewWaived",detected:"overviewOverstayDetected",grace_period:"overviewGracePeriod"};
  const recent = [
    ...bookings.map((booking) => ({ kind: "booking" as const, id: booking.id, activityKey: `created:${booking.id}`, date: booking.createdAt, title: mt("activityBookingRequested"), person: chefDisplayName(booking), kitchen: booking.kitchenName || locationKitchens.find(kitchen => kitchen.id === booking.kitchenId)?.name, scheduled: displayDate(booking.bookingDate), time: [booking.startTime, booking.endTime].filter(Boolean).join(" – "), href: `/manager/booking/${booking.id}` })),
    ...(activity.bookingEvents || []).map(event => ({ kind: "booking" as const, id: event.bookingId!, activityKey: `event:${event.id}`, date: event.createdAt!,
      title: event.title || mt("activityBooking"), person: chefDisplayName(bookings.find(booking => booking.id === event.bookingId) || {}),
      kitchen: event.kitchenName, scheduled: "", time: "", href: `/manager/booking/${event.bookingId}` })),
    ...locationViewings.flatMap((item) => tourActivity(item.viewing).map(event => ({ kind: "tour" as const, id: item.viewing.id, activityKey: event.key, date: event.recordedAt,
      title: mt(event.corrected ? "activityTourCorrected" : event.disruptionReason ? "activityTourDisrupted" : event.status === 'cancelled' && (item.viewing.adminReviewDecision === 'denied' || item.viewing.cancelledBy === 'manager_declined') ? "activityTourDeclined" : tourActivityLabel[event.status] ?? "kitchenTours"),
      person: chefDisplayName(item), kitchen: item.kitchenName || item.locationName, scheduled: displayDate(item.viewing.scheduledAt), time: tourTime(item) }))),
    ...activity.storageBookings.filter(item => !!item.createdAt).map(item => ({kind:"storage" as const,id:item.id,date:item.createdAt!,title:mt("activityStorageRequested"),person:chefDisplayName(item),kitchen:item.storageName || item.kitchenName,scheduled: [item.startDate,item.endDate].filter(Boolean).map(value=>displayDate(item.pricingModel === "hourly" ? value! : value!.slice(0, 10))).join(" – "),time:""})),
    ...locationApplications.filter(item => !!(item.updatedAt || item.createdAt)).map(item => ({kind:"application" as const,id:item.id,date:item.updatedAt || item.createdAt!,title:mt("overviewApplicationActivity", {status:mt(({inReview:"overviewAwaitingReview",approved:"approved",rejected:"rejected",pending:"pending"} as Record<string,string>)[item.status] ?? "overviewStatusUpdated")}),person:chefDisplayName(item),kitchen:locations.find(location=>location.id===item.locationId)?.name,scheduled:displayDate(item.updatedAt || item.createdAt!),time:""})),
    ...activity.claims.filter(item => !!(item.updatedAt || item.createdAt)).map(item => ({kind:"claim" as const,id:item.id,date:item.updatedAt || item.createdAt!,title:mt("overviewClaimActivity",{status:mt(financialActivityStatus[item.status ?? ""] ?? "overviewStatusUpdated")}),person:chefDisplayName(item),kitchen:item.kitchenName,scheduled:displayDate(item.updatedAt || item.createdAt!),time:""})),
    ...activity.overstays.filter(item => !!(item.updatedAt || item.detectedAt || item.createdAt)).map(item => ({kind:"overstay" as const,id:item.overstayId ?? item.id,date:item.updatedAt || item.detectedAt || item.createdAt!,title:mt("overviewOverstayActivity",{status:mt(financialActivityStatus[item.status ?? ""] ?? "overviewStatusUpdated")}),person:chefDisplayName(item),kitchen:item.kitchenName,scheduled:displayDate(item.updatedAt || item.detectedAt || item.createdAt!),time:""})),
  ].filter(item => Number.isFinite(Date.parse(item.date)) && Date.parse(item.date) <= Date.now()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, RECENT_ACTIVITY_LIMIT);
  const hasHistory = bookings.length > 0 || locationViewings.length > 0;
  const primaryKitchen = draftKitchens[0] ?? locationKitchens[0];
  const status = liveKitchens.length > 0 ? "live" : publishedButUnavailable ? "unavailable" : locationKitchens.length > 0 ? "draft" : "empty";
  const applicationJourney = status === "live" && bookings.length === 0;
  const journeyView = applicationJourney ? "applications" : primaryKitchen ? "listing-review" : "kitchens";
  interface Task { id: string; title: string; detail?: string; view: string; href?: string; param?: string; locationId?: number }
  const groups = new Map<string, Task[]>();
  const addTask = (label: string, task: Task) => groups.set(label, [...(groups.get(label) ?? []), task]);
  const recordTitle = (record: { id?: number; chefName?: string; kitchenName?: string; storageName?: string; claimTitle?: string; referenceCode?: string }) =>
    record.claimTitle || [chefDisplayName(record), record.storageName || record.kitchenName].filter(Boolean).join(" · ") || record.referenceCode || `#${record.id}`;
  if (activity.paymentsNeedAttention) addTask("overviewPaymentsAttention", { id: "payments", title: mt(activity.paymentsAction ?? "overviewPaymentsUpdate"), view: "payments" });
  const unreadThreads = activity.unreadThreads ?? [];
  for (const thread of unreadThreads) addTask("overviewUnreadMessages", { id: thread.id, title: applications.find((application) => application.id === thread.applicationId)?.fullName || mt("overviewConversationTitle", { id: thread.applicationId }), detail: mt("overviewUnreadThreadCount", { count: thread.unreadManagerCount }), view: "messages", param: "conversation" });
  if (!unreadThreads.length && activity.unreadMessages > 0) addTask("overviewUnreadMessages", { id: "messages", title: mt("overviewUnreadThreadCount", { count: activity.unreadMessages }), view: "messages" });
  for (const booking of bookings) {
    const label = bookingNextAction(booking, locations.find((location) => location.id === (booking.locationId ?? booking.location?.id))?.timezone);
    if (label) addTask(label, { id: String(booking.id), title: recordTitle(booking), detail: `${displayDate(booking.bookingDate)} · ${booking.startTime} – ${booking.endTime}`, view: "bookings", href: `/manager/booking/${booking.id}` });
    for (const item of booking.equipmentItems || []) if (booking.status === 'confirmed' && item.status === 'cancellation_requested')
      addTask('overviewEquipmentCancellations', { id: `${booking.id}:equipment:${item.equipmentBookingId ?? item.id}`, title: item.name || recordTitle(booking),
        view: 'bookings', href: `/manager/booking/${booking.id}` });
  }
  for (const tour of locationViewings) {
    const label = tourNextAction(tour.viewing);
    const decision = tourRequestDecision(tour.viewing);
    const due = decision?.stage === 'manager' && decision.dueAt ? ` · ${mt(decision.overdue ? 'tourDecisionOverdue' : 'tourDecisionDue')}: ${formatTourWhen(decision.dueAt, null, 'America/St_Johns')}` : '';
    if (label) addTask(label, { id: String(tour.viewing.id), title: recordTitle({ ...tour, id: tour.viewing.id }), detail: `${displayDate(tour.viewing.scheduledAt)} · ${tourTime(tour)}${due}`, view: "viewings", param: "viewing", ...(label === 'overviewTourFeedback' ? { href: `/manager/tours/${tour.viewing.id}?feedback=1` } : {}) });
  }
  for (const application of pendingApplications) addTask("overviewPendingApplications", { id: String(application.id), title: application.fullName || `#${application.id}`, view: "applications", param: "application" });
  for (const storage of activity.storageBookings) if (!bookings.some(booking => booking.id === storage.kitchenBookingId && booking.paymentDecision?.state === 'pending') && ["pending", "cancellation_requested"].includes(storage.status ?? "")) addTask(storage.cancellationAcceptedAt ? 'overviewStorageOutcomes' : "overviewStorageRequests", { id: String(storage.id), title: recordTitle(storage), detail: storage.cancellationAcceptedAt ? mt("storageRemovalConfirmationRequired") : undefined, view: "storage-bookings", param: "storageBooking" });
  for (const storage of activity.storageBookings) {
    if (storage.status !== "confirmed") continue;
    if (storage.checkinStatus === "checkin_requested") addTask("overviewStorageCheckinReviews", { id: String(storage.id), title: recordTitle(storage), view: "storage-checkouts" });
    if (storage.checkoutStatus === "active" && storageHasEnded(storage.endDate) && !activity.overstays.some((item) => item.storageBookingId === storage.id)) addTask("overviewStorageOutcomes", { id: String(storage.id), title: recordTitle(storage), view: "storage-bookings", param: "storageBooking" });
  }
  for (const extension of activity.extensions) addTask("overviewStorageExtensions", { id: String(extension.storageBookingId ?? extension.id), title: recordTitle(extension), view: "storage-bookings", param: "storageBooking", detail: extension.newEndDate ? mt("overviewExtensionUntil", { date: displayDate(extension.newEndDate) }) : undefined });
  for (const checkout of activity.storageCheckouts) addTask("overviewStorageCheckoutReviews", { id: String(checkout.storageBookingId ?? checkout.id), title: recordTitle(checkout), view: "storage-checkouts" });
  for (const claim of activity.claims) if (["draft", "approved", "partially_approved", "chef_accepted", "charge_failed", "escalated"].includes(claim.status ?? "")) addTask("overviewClaimsToAction", { id: String(claim.id), title: recordTitle(claim), view: "damage-claims", param: "claim", detail: mt(claim.status === "draft" ? "overviewClaimComplete" : "overviewClaimCollect") });
  for (const overstay of activity.overstays) { const action = overstayNextAction(overstay); if (action) addTask("overviewOverstaysToAction", { id: String(overstay.overstayId ?? overstay.id), title: recordTitle({ ...overstay, id: overstay.overstayId ?? overstay.id }), detail: mt(action), view: "overstays" }); }
  for (const location of locations) {
    if (selectedLocation && location.id !== selectedLocation.id) continue;
    const action = licenseNextAction(location);
    if (action) addTask("overviewLicenseAttention", { id: String(location.id), title: location.name, detail: mt(action), view: "settings-license", locationId: location.id });
  }
  const attentionGroups = Array.from(groups, ([label, items]) => ({ label, items }));
  /**
   * Zero is not shown. The empty state below already says "all caught up" in words, so a "0 actions"
   * badge next to the heading would be the same fact twice — and a count of zero next to a heading
   * reads as a broken number rather than as reassurance. Absent means nothing needs you.
   */
  const attentionCount = attentionGroups.reduce((sum, group) => sum + group.items.length, 0);
  const openTask = (task: Task) => {
    if (task.locationId) { const location = locations.find(item => item.id === task.locationId); if (location) onSelectLocation?.(location); }
    onNavigate(task.view);
    if (task.param) {
      const url = new URL(window.location.href);
      url.searchParams.set(task.param, task.id);
      window.history.replaceState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };
  const futureTours = locationViewings.filter((tour) => tour.viewing.status === "confirmed" && isPendingOrUpcomingTour({ ...tour.viewing, durationMinutes: tour.viewing.durationMinutes ?? null }));
  const scheduledStorage = activity.storageBookings.filter((booking) => booking.status === "confirmed" && !["completed", "checkout_claim_filed"].includes(booking.checkoutStatus ?? "") && !!booking.endDate && Number.isFinite(Date.parse(booking.endDate)) && !storageHasEnded(booking.endDate));
  const scheduleRows = [
    ...upcoming.map(booking => ({key:`booking-${booking.id}`,id:String(booking.id),title:chefDisplayName(booking),detail:[displayDate(booking.bookingDate),`${booking.startTime} – ${booking.endTime}`,booking.kitchenName].filter(Boolean).join(" · "),time:createBookingDateTime(dayKey(booking.bookingDate),booking.startTime,locations.find(location=>location.id===(booking.locationId ?? booking.location?.id))?.timezone ?? DEFAULT_TIMEZONE).getTime(),href:`/manager/booking/${booking.id}`,view:"bookings",param:undefined,label:mt(booking.status === "cancellation_requested" ? "cancellationRequested" : booking.status)})),
    ...futureTours.map(tour => ({key:`tour-${tour.viewing.id}`,id:String(tour.viewing.id),title:chefDisplayName(tour),detail:[displayDate(tour.viewing.scheduledAt),tourTime(tour),tour.kitchenName || tour.locationName].filter(Boolean).join(" · "),time:Date.parse(tour.viewing.scheduledAt),href:undefined,view:"viewings",param:"viewing",label:mt("kitchenTours")})),
    ...scheduledStorage.map(storage => ({key:`storage-${storage.id}`,id:String(storage.id),title:recordTitle(storage),detail:[displayDate(storage.startDate ?? ""),displayDate(storage.endDate ?? "")].join(" – "),time:Date.parse(storage.startDate ?? ""),href:undefined,view:"storage-bookings",param:"storageBooking",label:mt("overviewStorageBookingType")})),
  ].sort((a,b)=>(Number.isFinite(a.time)?a.time:Infinity)-(Number.isFinite(b.time)?b.time:Infinity));
  const hasSchedule = bookings.length > 0 || futureTours.length > 0 || scheduledStorage.length > 0;
  const cardClass = "min-w-0 rounded-[20px] border border-border/70 bg-card shadow-[0_2px_12px_-6px_rgba(15,23,42,0.12)]";

  const panelClass = `${cardClass} h-[320px]`;
  const attentionCard = (<Card className={panelClass}>
          <CardContent className="flex h-full flex-col p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("overviewToday")}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{mt("overviewNeedsAttention")}</h2>
              </div>
              {isLoadingBookings || isLoadingViewings || isLoadingApplications || activity.isLoading ? <Skeleton className="h-6 w-16 rounded-full" /> : attentionCount > 0 ? <Badge variant="outline" className="shrink-0 border-primary/15 bg-primary/5 text-primary tabular-nums">{mt("overviewActionCount", { count: attentionCount })}</Badge> : null}
            </div>

            <ScrollArea className="min-h-0 flex-1" tabIndex={0} role="region" aria-label={mt("overviewNeedsAttention")}>
            {isErrorBookings || isErrorViewings || isErrorApplications || activity.isError ? <p role="status" className="mt-4 text-sm text-destructive">{mt("overviewActivityPartialError")}</p> : null}
            {isLoadingBookings || isLoadingViewings || isLoadingApplications || activity.isLoading ? <Skeleton className="mt-4 h-10 rounded-xl" /> : null}
            <div className="mt-4 space-y-3">{attentionGroups.map((group) => {
              const isPayouts = group.items[0]?.view === "payments";
              const GroupIcon = managerNavIcons[group.items[0]?.view as keyof typeof managerNavIcons] ?? managerNavIcons.bookings;
              return <section key={group.label} className="overflow-hidden">
              <h3 className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/60 bg-card py-2 text-xs font-semibold"><span className="flex items-center gap-2"><GroupIcon aria-hidden="true" className={`size-4 shrink-0 ${isPayouts ? "text-stripe" : "text-primary"}`} />{mt(group.label)}</span><Badge variant="count">{group.items.length}</Badge></h3>
              <div className="divide-y divide-border/50">{group.items.map((task) => {
                const content = <><span className="min-w-0"><span className="block truncate text-sm font-medium">{task.title}</span>{task.detail && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{task.detail}</span>}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></>;
                /* Same hover contract as `rowClass` above — background wash only, no red text flip.
                   These are the only two clickable row styles on the page, so they must agree. */
                const taskClass = "flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-[background-color,color] duration-200 ease-out motion-reduce:transition-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
                return task.href ? <Link key={task.id} href={task.href} className={taskClass}>{content}</Link> : <button key={task.id} className={taskClass} onClick={() => openTask(task)}>{content}</button>;
              })}</div>
            </section>; })}</div>
            {/*
             * Empty state, dressed like the sibling cards' empty states: a `bg-muted/40` block,
             * left-aligned, sized by its own content.
             *
             * It used to be centred inside `h-full max-h-44` with a green-tinted fill, which broke in
             * three ways. `h-full` cannot resolve here — Radix wraps ScrollArea children in a
             * `display: table` element that sizes to its content, so 100% of it is 100% of nothing and
             * the block collapsed to `max-h-44`. The fixed `max-h-44` then stopped it responding to
             * longer copy or a narrower column. And the centring made it the only centred empty state
             * on the page, so it sat off-axis from the Upcoming and Recent activity cards.
             *
             * No green. "All caught up" is an ABSENCE of work, not an achievement, so the whole block
             * stays in the muted register — icon included. It is still legible: the heading keeps the
             * normal text colour and only the supporting line drops to muted.
             */}
            {!attentionGroups.length && !activity.isLoading && !activity.isError && !isLoadingBookings && !isLoadingViewings && !isLoadingApplications && !isErrorBookings && !isErrorViewings && !isErrorApplications && <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/40 p-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/70 text-muted-foreground" aria-hidden="true"><CheckCircle className="size-4" /></span><div className="min-w-0"><p className="text-sm font-medium">{mt("overviewAllCaughtUp")}</p><p className="mt-1 text-xs text-muted-foreground">{mt("overviewAllCaughtUpBody")}</p></div></div>}
            </ScrollArea>
          </CardContent>
        </Card>);
  const listingCard = (<Card className={panelClass}><CardContent className="flex h-full flex-col gap-4 p-5 md:p-6">
<div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("overviewListingStatus")}</p><h2 className="mt-1 text-xl font-semibold tracking-tight">{mt("overviewKitchenCount", { count: locationKitchens.length })}</h2></div>
<ScrollArea className="min-h-0 flex-1" tabIndex={0} role="region" aria-label={mt("overviewListingStatus")}>
{!locationKitchens.length ? <div><h2 className="text-lg font-semibold">{mt("overviewEmptyTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{mt("overviewEmptyBody")}</p><Button className="mt-4" onClick={() => onNavigate("kitchens")}>{mt("addYourKitchen")}<ChevronRight className="size-4" aria-hidden="true" /></Button></div> : locationKitchens.map((kitchen) => {
const review = (activity.listingReadiness ?? []).find((item) => item.kitchenId === kitchen.id);
const checklist = review?.data?.checklist;
const listed = kitchenIsVisibleToChefs(kitchen, licenseForKitchen(kitchen));
const unavailable = kitchen.listingStatus === "active" && !listed;
const missing = checklist?.missingRequirementIds.length ?? 0;
const recommendations = checklist?.openRecommendationIds.length ?? 0;
const listingComplete = Boolean(checklist && !review?.isLoading && !review?.isError && missing === 0 && recommendations === 0);
const licenseAction = licenseNextAction(licenseForKitchen(kitchen) ?? {});
const toneKey: ListingToneKey = !kitchen.isActive
  ? "hidden"
  : listed
    ? "live"
    : unavailable || missing > 0
      ? "blocked"
      : "ready";
const tone = LISTING_TONES[toneKey];
const stateLabelKey = listed
  ? "listingStatusLiveLabel"
  : unavailable
    ? "overviewUnavailableShort"
    : "listingStatusDraftLabel";
const bodyText = review?.isLoading
  ? null
  : review?.isError
    ? mt("overviewListingGuidanceError")
    : checklist
      ? mt(unavailable ? !kitchen.isActive ? "listingStatusHiddenDesc" : licenseAction ? "listingSummaryLicense" : "listingSummaryLicenseReview" : missing ? listed ? "listingSummaryLiveIncomplete" : "listingReviewBlockedHeadline" : listed ? "listingSummaryLive" : "listingSummaryReady", { count: missing }) + (unavailable && missing > 0 ? ` ${mt("listingSummaryRequiredUpdates", { count: missing })}` : "") + (recommendations > 0 ? ` ${mt("overviewListingSuggestions", { count: recommendations })}` : "")
      : null;
return <div key={kitchen.id}><button type="button" onClick={() => onNavigate(listingComplete ? "kitchens" : "listing-review", kitchen.id)} className={`group mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tone.border}`}>
<div className="flex min-w-0 flex-1 flex-col gap-0.5">
<div className="flex min-w-0 items-center gap-2">
<h2 className="min-w-0 truncate text-sm font-semibold">{kitchen.name}</h2>
<span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
<span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
{mt(stateLabelKey)}
</span>
</div>
{review?.isLoading ? <Skeleton className="h-3 w-40 rounded" /> : bodyText ? <p className={`min-w-0 text-xs leading-4 ${review?.isError ? "text-destructive" : "text-muted-foreground"}`}>{bodyText}</p> : null}
</div>
<ChevronRight className="size-4 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
</button>{!listed && licenseAction && <Button variant="ghost" size="sm" className="mb-3" onClick={() => openTask({ id: String(kitchen.locationId), title: kitchen.name, view: "settings-license", locationId: kitchen.locationId })}>{mt("overviewReviewLicense")}<ChevronRight className="size-4" aria-hidden="true" /></Button>}</div>;
})}</ScrollArea></CardContent></Card>);
  // A padded surface responds on hover while labels retain their colour.
  const rowClass = "flex w-full items-center justify-between gap-3 rounded-lg border-b border-border/50 px-2 py-2.5 text-left transition-[background-color,color] duration-200 ease-out motion-reduce:transition-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const scrollClass = "mt-4 min-h-0 flex-1";
  const upcomingCard = <Card className={panelClass}><CardContent className="flex h-full flex-col p-5 md:p-6">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("overviewSchedule")}</p><h2 className="mt-1 text-xl font-semibold">{mt("overviewUpcomingBookings")}</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate(upcoming.length ? "bookings" : futureTours.length ? "viewings" : scheduledStorage.length ? "storage-bookings" : journeyView, primaryKitchen?.id)}>{mt(hasSchedule ? "viewAll" : applicationJourney ? "overviewViewApplications" : primaryKitchen ? "overviewReviewListing" : "addYourKitchen")}<ChevronRight className="size-4" aria-hidden="true" /></Button></div>
    {bookings.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/35 px-3 py-2.5">{[{label:"overviewTodaySessions",value:todayBookings.length},{label:"overviewNextSevenDays",value:weekBookings.length}].map(metric => <div key={metric.label}><p className="text-xs text-muted-foreground">{mt(metric.label)}</p><strong className="text-xl tabular-nums">{metric.value}</strong></div>)}</div>}
    <ScrollArea className={scrollClass} tabIndex={0} role="region" aria-label={mt("overviewUpcomingBookings")}>
      {isLoadingBookings || isLoadingViewings || (!bookings.length && isLoadingApplications) || activity.isLoading ? <Skeleton className="h-32 rounded-xl" /> : isErrorBookings || isErrorViewings || (!bookings.length && isErrorApplications) || activity.isError ? <p role="status" className="text-sm text-destructive">{mt("overviewActivityPartialError")}</p> : null}
      {scheduleRows.map(item => {const content=<><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.detail}</span></span><span className="flex shrink-0 items-center gap-2"><Badge variant="outline" className="font-medium">{item.label}</Badge><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></span></>;return item.href ? <Link key={item.key} href={item.href} className={rowClass}>{content}</Link> : <button key={item.key} className={rowClass} onClick={()=>openTask(item)}>{content}</button>;})}
      {!upcoming.length && !futureTours.length && !scheduledStorage.length && !isLoadingBookings && !isLoadingViewings && !isLoadingApplications && !activity.isLoading && !isErrorBookings && !isErrorViewings && !isErrorApplications && !activity.isError && <div className="rounded-xl bg-muted/40 p-4"><p className="font-medium">{mt(bookings.length ? "overviewNoUpcoming" : !applicationJourney ? "overviewPrepareForApplications" : pendingApplications.length ? "overviewApplicationsToReview" : approvedApplications.length ? "overviewApprovedChefs" : "overviewWaitingForApplications")}</p><p className="mt-1 text-sm text-muted-foreground">{mt(bookings.length ? status === "draft" && hasHistory ? "overviewPastBookingsRemain" : "overviewNoUpcomingBody" : !applicationJourney ? "overviewPublishBeforeApplicationsBody" : pendingApplications.length ? "overviewReviewApplicationsBody" : approvedApplications.length ? "overviewApprovedChefsBody" : "overviewWaitingForApplicationsBody")}</p></div>}
    </ScrollArea></CardContent></Card>;
  const historyLoading = isLoadingBookings || isLoadingViewings || isLoadingApplications || activity.isLoading;
  const historyError = isErrorBookings || isErrorViewings || isErrorApplications || activity.isError;
  const historyCard = <Card className={panelClass}><CardContent className="flex h-full flex-col p-5 md:p-6"><div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("overviewHistory")}</p><h2 className="mt-1 text-xl font-semibold">{mt("overviewRecentActivity")}</h2></div><ScrollArea className={scrollClass} tabIndex={0} role="region" aria-label={mt("overviewRecentActivity")}>
    {historyError && <p role="status" className="mb-3 text-sm text-destructive">{mt("overviewActivityPartialError")}</p>}
    {historyLoading && !recent.length && <Skeleton className="h-32 rounded-xl" />}
    {!historyLoading && !historyError && !recent.length && <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">{mt("overviewRecentActivityEmpty")}</p>}
    {recent.map(item => {const view = ACTIVITY_VIEW[item.kind] ?? "bookings"; const ActivityIcon = managerNavIcons[view] ?? managerNavIcons.bookings; const content = <><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true"><ActivityIcon className="size-4" /></span><span className="flex min-w-0 flex-1 flex-col"><span className="block text-sm font-medium">{item.title}</span><span className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">{[item.person, item.kitchen, item.scheduled, item.time].filter(Boolean).join(" · ")}</span></span><span className="flex shrink-0 items-center gap-2"><time dateTime={item.date} title={displayDate(item.date)} className="whitespace-nowrap text-xs text-muted-foreground">{formatRelativeTime(item.date, i18n.language)}</time><ChevronRight className="size-4 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-out motion-reduce:transition-none motion-reduce:transform-none group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" /></span></>;return item.kind === "booking" ? <Link key={`booking-${item.activityKey}`} href={item.href} className={`group ${rowClass}`}>{content}</Link> : <button key={`${item.kind}-${item.id}-${item.kind === "tour" ? item.activityKey : "current"}`} onClick={() => openTask({ id: String(item.id), title: item.title, view, param: ACTIVITY_PARAM[item.kind] })} className={`group ${rowClass}`}>{content}</button>;})}
  </ScrollArea></CardContent></Card>;
  return <div className="space-y-4"><header className="pb-2"><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">{mt("overviewEyebrow")}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{mt("overviewWelcome", {name:user?.displayName?.split(" ")[0] || mt("shellManagerFallback")})}</h1><p className="mt-1 text-sm text-muted-foreground">{selectedLocation?.name ?? (locations.length > 1 ? mt("cmdAllLocations") : mt("overviewYourWorkspace"))}</p></header>
    <div className="grid gap-4 lg:grid-cols-2">{liveKitchens.length ? <>{attentionCard}{listingCard}</> : <>{listingCard}{attentionCard}</>}</div>
    {(bookings.length > 0 || activity.storageBookings.length > 0 || liveKitchens.length > 0) && <Card className={cardClass}>
      <CardContent className="p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary"><DollarSign className="size-4" /></span><div><h2 className="text-sm font-semibold">{mt("overviewThisMonthRevenue")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{new Date().toLocaleDateString(i18n.language, { month: "long", year: "numeric" })}</p></div></div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onNavigate("revenue")}>{mt("overviewRevenueDetails")}<ChevronRight className="ml-1 size-4" /></Button>
        </div>
        {isLoadingRevenue ? <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div> : isErrorRevenue ? <p role="status" className="rounded-xl bg-muted/40 p-4 text-sm text-destructive">{mt("overviewRevenueError")}</p> : <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr] sm:items-center">
          <div className="min-w-0 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/5 to-transparent px-4 py-3"><span className="block text-xs font-medium text-muted-foreground">{mt("overviewPaidEarnings")}</span><strong className="mt-1 block break-words text-3xl font-semibold tracking-tight tabular-nums">{formatCurrency(revenue?.completedNetRevenue ?? revenue?.netRevenue ?? 0)}</strong></div>
          <div className="grid grid-cols-2 gap-4 sm:col-span-2">{[{label:"overviewPendingPayments",value:formatCurrency(revenue?.pendingPayments ?? 0)},{label:"overviewPaidBookings",value:revenue?.paidBookingCount ?? 0}].map((metric,index) => <div key={metric.label} className={`min-w-0 ${index ? "border-l border-border/70 pl-4" : "sm:pl-2"}`}><span className="block text-xs text-muted-foreground">{mt(metric.label)}</span><strong className="mt-1 block break-words text-xl font-semibold tracking-tight tabular-nums">{metric.value}</strong></div>)}</div>
        </div>}
      </CardContent>
    </Card>}

    <div className="grid gap-4 lg:grid-cols-2">{upcomingCard}{historyCard}</div>
    {upcoming.length > 0 && <BookingCalendarWidget bookings={bookings.map(booking => ({...booking,status:booking.status === "cancellation_requested" ? "confirmed" as const : booking.status}))} isLoading={isLoadingBookings} onNavigateToBookings={() => onNavigate("bookings")} />}
  </div>;
}
