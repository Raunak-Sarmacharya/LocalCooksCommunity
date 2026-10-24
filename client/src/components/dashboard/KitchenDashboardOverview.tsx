import { managerNavIcons } from "@/lib/manager-nav-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_TIMEZONE } from "@shared/timezone-utils";
import { bookingNextAction, tourNextAction, licenseNextAction, storageHasEnded } from "@/lib/manager-overview-lifecycle";
import { tourRequestDecision } from '@shared/tour-request-decision';
import { formatTourWhen } from '@/lib/chef-viewing-display';
import { isPendingOrUpcomingTour } from "@/lib/chef-viewing-display";
import { useTourClock } from "@/hooks/use-tour-clock";
import { tourActivity } from "@shared/tour-activity";
import { tourListState, tourWhenLine, type TourListTour } from "@/lib/tour-list-status";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { apiGet } from "@/lib/api";
import { mt } from "@/i18n/manager";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { useManagerOverviewActivity } from "@/hooks/use-manager-overview-activity";
import { formatCurrency, formatDate, formatRelativeTime, formatTime } from "@/lib/formatters";
import { kitchenIsVisibleToChefs, licenseAllowsBookings } from "@shared/kitchen-license";
import { CheckCircle, ChevronDown, ChevronRight } from "@/components/ui/manager-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import BookingCalendarWidget, { CalendarEventRow, kitchenNowMinutes, sortEvents, type CalendarEvent, type VisitState } from "./BookingCalendarWidget";
import { badge, btnPrimary, btnSecondary, card, cardBody, cardHead, cardMeta, cardTitle, focusRing, groupCount, groupLabel, linkTertiary, sub } from "./dashboard-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bookingResponseDeadline, formatResponseDeadline } from "@/lib/booking-response-deadline";
import { timeRange } from "@/lib/booking-header-state";
import { cn } from "@/lib/utils";
import { Clock, Info } from "lucide-react";
import { RevenuePayoutsCard } from "./RevenuePayoutsCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { managerDatedListDay, managerListDays } from "@/lib/booking-list-status";
import { kitchenBookingBlocks } from "@/lib/kitchen-booking-blocks";
import type { BookingPillTone } from "@/lib/booking-header-state";
import { addDaysKey, kitchenTodayKey, spanMinutes, weekStartKey, weekStats, type DateOverride, type WeeklyHours } from "@/lib/manager-week-stats";
import { revenueSummaryFromCurrent, revenueSummaryFromLedger } from "@/lib/manager-revenue-summary";
import { useManagerRevenue } from "@/components/manager/revenue/hooks/use-manager-revenue";
import { chipForRental, chipNeedsAction, occupiesUnit, pendingRequests, type StorageRental, type UnitChip } from "@/lib/storage-board";
import { cad, storageDay } from "@/lib/storage-rentals";
import { StatusPill } from "@/components/booking/BookingNowCard";
import { bookingCancelCause } from "@/lib/booking-cancel-cause";
import { bookingListBounds, bookingListPhase, bookingListPill, listWhenLine, openAttendanceAnswers, type BookingListRow } from "@/lib/booking-list-status";
import { ct } from "@/i18n/chef-ns";
import { useCommitmentProblems } from "@/components/support/CommitmentProblems";

interface Location { id: number; name: string; address: string; kitchenLicenseUrl?: string | null; kitchenLicenseStatus?: string | null; kitchenLicenseExpiry?: string | null; timezone?: string; kitchenLicensePendingUrl?: string | null; kitchenLicensePendingExpiry?: string | null }
interface Kitchen { id: number; locationId: number; name: string; isActive: boolean; listingStatus?: string }
interface Booking {
  attendanceReviewComplete?: boolean;
  paymentDecision?: { state?: string } | null;
  /** A customer's change request waiting on the kitchen's answer. */
  pendingChange?: { decisionBy: string } | null;
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
  locationTimezone?: string | null;
  timezone?: string | null;
  closeout?: BookingListRow["closeout"];
  visitStates?: BookingListRow["visitStates"];
  checkinWindowMinutesBefore?: number | null;
  selectedSlots?: BookingListRow["selectedSlots"];
  scheduleRevision?: number;
  paymentStatus?: string;
  responseDeadlineAt?: string | null;
  durationHours?: number | string | null;
  totalPrice?: number | null;
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
/** Hours to one decimal ("18", "2.5"), in the reader's locale. */
const hoursText = (minutes: number, locale: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
/** "HH:MM" of an instant in a zone (24-hour), for placing a tour on the calendar. */
const clockIn = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
const FINISHED_PHASES = ["completed", "visit_ended", "no_show", "issue", "cancelled"];
const IN_KITCHEN = ["in_session", "time_ended_in_session"];
/** Needs-attention groups about a day that has ended: each item names that day and opens its inspection. */
const FOLLOW_UP_ACTIONS = ["overviewKitchenCheckoutReviews", "overviewBookingOutcomes"];
/** The storage board's own chip words ("Move-in overdue"), one key per chip, so a new chip can't arrive without a reason. */
const storageChipKey = (chip: UnitChip) => `stChip${chip[0].toUpperCase()}${chip.slice(1)}`;
/** The rental page's first action for each chip that needs the kitchen (`StorageRentalDetail`'s prominent actions). */
const STORAGE_ACTION: Partial<Record<UnitChip, string>> = { moveInOverdue: "stActionHandover", grace: "stActionOfferExtension", holdover: "stActionHoldoverCharge",
  moveOutDue: "stActionClearMoveOut", needsCleaning: "stActionMarkReady", removalReview: "stActionRecordRemoval" };

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
};

/** The URL param each destination deep-links with. Bookings link straight to their own page. */
const ACTIVITY_PARAM: Record<string, string | undefined> = {
  booking: undefined,
  tour: "viewing",
  storage: "storageBooking",
  application: "application",
  claim: "claim",
};

/**
 * How many entries the Recent activity feed renders.
 *
 * This card is a FEED, not a work queue: it is informational, it is already sorted newest-first, and
 * every entry is also reachable from its own page (Bookings, Tours, Applications, …). So a hard cap
 * costs the manager nothing they need. Without it the card mounts every booking, tour, application,
 * storage booking and claim the location has EVER had — thousands of rows on a mature
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
  const [showDoneToday, setShowDoneToday] = useState(false);
  const [allActivity, setAllActivity] = useState(false);
  const attentionRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const activityListRef = useRef<HTMLDivElement>(null);
  const [activityUnderAttention, setActivityUnderAttention] = useState(false);
  const [hiddenActivity, setHiddenActivity] = useState(0);
  const locationKitchens = kitchens.filter((kitchen) => !selectedLocation || kitchen.locationId === selectedLocation.id);
  // Rows name their kitchen only when the location has several (one kitchen keeps the v2 rows as they are).
  const multiKitchen = locationKitchens.length > 1;
  const kitchenName = (id?: number | null, name?: string | null) => name || locationKitchens.find(kitchen => kitchen.id === id)?.name;
  const inKitchen = (id?: number | null, name?: string | null) => multiKitchen ? kitchenName(id, name) : undefined;
  const activity = useManagerOverviewActivity(selectedLocation?.id, locationKitchens.map((kitchen) => kitchen.id));
  // shortcut: reads every problem this kitchen can see, then filters here; add a server-side open-only filter if lists grow large.
  const problems = useCommitmentProblems(undefined, undefined, "manager");
  const licenseForKitchen = (kitchen: Kitchen) => locations.find((location) => location.id === kitchen.locationId);
  const liveKitchens = locationKitchens.filter((kitchen) => kitchenIsVisibleToChefs(kitchen, licenseForKitchen(kitchen)));
  const draftKitchens = locationKitchens.filter((kitchen) => kitchen.listingStatus !== "active");
  const publishedKitchen = locationKitchens.find((kitchen) => kitchen.listingStatus === "active");
  const publishedButUnavailable = !!publishedKitchen && liveKitchens.length === 0;
  const licenseNeedsAttention = publishedButUnavailable && !licenseAllowsBookings(licenseForKitchen(publishedKitchen!) ?? {});
  const bookings = (allBookings as Booking[]).filter((booking) =>
    !selectedLocation || (booking.locationId ?? booking.location?.id) === selectedLocation.id,
  );

  const timezone = selectedLocation?.timezone || DEFAULT_TIMEZONE;
  const today = kitchenTodayKey(timezone);
  // The storage board's own read (standalone rentals), so its actions refresh the overview too.
  const { data: rentals = [], isLoading: isLoadingRentals, isError: isErrorRentals } = useQuery<StorageRental[]>({
    queryKey: ["/api/manager/storage-rentals"],
    queryFn: () => apiGet("/manager/storage-rentals"),
    enabled: !!user && locationKitchens.length > 0,
    refetchInterval: 30_000,
  });
  const locationRentals = (Array.isArray(rentals) ? rentals : []).filter(rental => locationKitchens.some(kitchen => kitchen.id === rental.kitchen?.id));
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
    enabled: !!user && (liveKitchens.length > 0 || bookings.length > 0 || activity.storageBookings.length > 0 || locationRentals.length > 0),
  });

  const { data: upcomingPayouts, isLoading: isLoadingPayouts } = useQuery<{ totalCents: number; payouts: Array<{ bookingId: number; status: string; amountCents: number; expectedAt: string | null; timezone?: string | null }> }>({
    queryKey: ["/api/manager/revenue/upcoming-payouts"],
    queryFn: () => apiGet("/manager/revenue/upcoming-payouts"),
    enabled: !!user && (liveKitchens.length > 0 || bookings.length > 0 || locationRentals.length > 0),
  });
  // Month to date from the Revenue page's ledger (R1), so the card and Revenue always agree.
  const monthRange = useMemo(() => { const now = new Date(); return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }; }, []);
  const ledger = useManagerRevenue(monthRange, selectedLocation?.id, undefined, !!user && (liveKitchens.length > 0 || bookings.length > 0 || locationRentals.length > 0));
  const tourTime = (tour: Viewing) => Number.isFinite(Date.parse(tour.viewing.scheduledAt)) ? new Date(tour.viewing.scheduledAt).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE }) : "";
  const words = { today: mt("mblToday"), tomorrow: ct("ovTomorrow") };
  /**
   * One row per booked DAY: a multi-day booking reads "Day 1 of 2 · Today · 8:00–9:00 p.m." with that day's own times,
   * never every day's slots merged into one line.
   */
  const dayRows = bookings.flatMap(booking => managerListDays(booking).map(day => ({ ...day, booking, dayKey: dayKey(day.row.bookingDate) })));
  const dayLabel = (day: { dayNumber?: number; dayCount?: number }) => (day.dayCount ?? 0) > 1 ? mt("mdDayOf", { number: day.dayNumber, total: day.dayCount }) : "";
  /** The day a booking's next step is about (the agenda's choice), labelled "Day N of M" when it has several. */
  const datedDay = (booking: Booking) => {
    const row = managerDatedListDay(booking);
    const day = managerListDays(booking).find(item => item.visitId != null && item.visitId === row.visitStates?.[0]?.id);
    return { row, label: day ? dayLabel(day) : "" };
  };
  const pendingBookings = bookings.filter((booking) => booking.status === "pending");
  const pendingApplications = locationApplications.filter((application) => application.status === "inReview" ||
    (application.status === "approved" && (application.current_tier ?? application.currentTier) === 2 && !!application.tier2_completed_at));
  const approvedApplications = locationApplications.filter((application) => application.status === "approved" && (application.current_tier ?? application.currentTier ?? 1) >= 2);
  // A visit the booking page already calls finished (checked out early, ended, no-show) is not on the schedule.
  const upcoming = dayRows.filter(({ row, dayKey: key }) => ["pending", "confirmed", "cancellation_requested"].includes(row.status) && key >= today
    && !FINISHED_PHASES.includes(bookingListPhase(row)) && bookingNextAction(row, locations.find((location) => location.id === (row.locationId ?? row.location?.id))?.timezone) !== "overviewBookingOutcomes")
    // By the real start in the kitchen zone (an overnight slot starts the next calendar day).
    .sort((a, b) => (bookingListBounds(a.row)?.startAt.getTime() ?? 0) - (bookingListBounds(b.row)?.startAt.getTime() ?? 0));
  const bookingActivityLabel: Record<string, string> = { pending: "activityBookingRequested", confirmed: "activityBookingConfirmed", cancelled: "activityBookingCancelled", completed: "activityBookingCompleted", cancellation_requested: "activityBookingCancellationRequested" };
  const tourActivityLabel: Record<string, string> = { pending: "activityTourRequested", confirmed: "activityTourScheduled", cancelled: "activityTourCancelled", completed: "activityTourCompleted", no_show: "activityTourNoShow", rejected: "activityTourDeclined" };
  const chefDisplayName = (record: {chefName?: string; chefId?: number | null; fullName?: string}) => {
    const parentName = record.chefId ? (allBookings as Booking[]).find(booking => booking.chefId === record.chefId && booking.chefName && !booking.chefName.includes("@"))?.chefName : undefined;
    const name = [parentName, record.chefName, record.fullName, record.chefId ? applications.find(application => application.chefId === record.chefId)?.fullName : undefined].find(value => value?.trim() && !value.includes("@"));
    return name?.trim() || mt("guestChef");
  };
  const financialActivityStatus: Record<string,string> = {draft:"overviewDraft",submitted:"overviewAwaitingAdmin",under_review:"overviewAwaitingAdmin",chef_disputed:"overviewAwaitingAdmin",chef_accepted:"chefAccepted",approved:"approved",partially_approved:"partiallyApproved",charge_pending:"overviewPaymentProcessing",charge_failed:"chargeFailed",charge_succeeded:"overviewPaymentCollected",resolved:"overviewResolved",rejected:"rejected",expired:"overviewExpired",escalated:"overviewEscalated",pending_review:"overviewAwaitingReview",penalty_approved:"approved",penalty_waived:"overviewWaived"};
  // A changed request reads as one row ("{name} changed their request"), so the new request's own "Booking requested" row steps aside.
  const changedRequests = new Set((activity.bookingEvents || []).filter(event => event.kind === "replaces").map(event => event.bookingId));
  const whenLine = (booking: Booking) => { const days = managerListDays(booking); return [listWhenLine(days[0].row, i18n.language, words), days.length > 1 ? mt("ovrDayCount", { count: days.length }) : ""].filter(Boolean).join(" · "); };
  const recent = [
    ...bookings.filter(booking => !changedRequests.has(booking.id)).map((booking) => ({ kind: "booking" as const, id: booking.id, activityKey: `created:${booking.id}`, date: booking.createdAt, title: mt("activityBookingRequested"), person: chefDisplayName(booking), kitchen: booking.kitchenName || locationKitchens.find(kitchen => kitchen.id === booking.kitchenId)?.name, scheduled: whenLine(booking), time: "", href: `/manager/booking/${booking.id}` })),
    // The booking row above already says "Booking requested"; its own "requested" lifecycle event is the same moment.
    ...(activity.bookingEvents || []).filter(event => !(event.kind === "requested" && bookings.some(booking => booking.id === event.bookingId))).map(event => {
      const booking = bookings.find(row => row.id === event.bookingId);
      const person = chefDisplayName(booking || {});
      const changed = event.kind === "replaces";
      return { kind: "booking" as const, id: event.bookingId!, activityKey: `event:${event.id}`, date: event.createdAt!,
        title: changed ? mt("activityRequestChanged", { name: person }) : event.title || mt("activityBooking"), person: changed ? "" : person,
        kitchen: event.kitchenName, scheduled: changed && booking ? whenLine(booking) : "", time: "", href: `/manager/booking/${event.bookingId}` };
    }),
    ...locationViewings.flatMap((item) => tourActivity(item.viewing).map(event => ({ kind: "tour" as const, id: item.viewing.id, activityKey: event.key, date: event.recordedAt,
      title: mt(event.corrected ? "activityTourCorrected" : event.disruptionReason ? "activityTourDisrupted" : event.status === 'cancelled' && (item.viewing.adminReviewDecision === 'denied' || item.viewing.cancelledBy === 'manager_declined') ? "activityTourDeclined" : tourActivityLabel[event.status] ?? "kitchenTours"),
      person: chefDisplayName(item), kitchen: item.kitchenName || item.locationName, scheduled: displayDate(item.viewing.scheduledAt), time: tourTime(item) }))),
    ...activity.storageBookings.filter(item => !!item.createdAt).map(item => ({kind:"storage" as const,id:item.id,date:item.createdAt!,title:mt("activityStorageRequested"),person:chefDisplayName(item),kitchen:[item.storageName || item.kitchenName, item.storageName && multiKitchen ? item.kitchenName : undefined].filter(Boolean).join(" · "),scheduled: [item.startDate,item.endDate].filter(Boolean).map(value=>displayDate(item.pricingModel === "hourly" ? value! : value!.slice(0, 10))).join(" – "),time:""})),
    // A customer's cancellation before the start: who, what came back to them and what the kitchen keeps.
    ...locationRentals.flatMap(rental => rental.cancellation ? [{ kind: "rental" as const, id: rental.id, activityKey: `rental-cancel:${rental.id}`, date: rental.cancellation.cancelledAt,
      title: mt("activityStorageCancelled", { name: rental.chef?.name && !rental.chef.name.includes("@") ? rental.chef.name : mt("guestChef") }), person: "", kitchen: "",
      scheduled: mt("stCancelledMoney", { ns: "storage", refund: cad(rental.cancellation.refundCents, i18n.language), payout: cad(rental.cancellation.kitchenPayoutCents ?? 0, i18n.language) }),
      time: "", href: `/manager/storage/${rental.id}` }] : []),
    ...locationApplications.filter(item => !!(item.updatedAt || item.createdAt)).map(item => ({kind:"application" as const,id:item.id,date:item.updatedAt || item.createdAt!,title:mt("overviewApplicationActivity", {status:mt(({inReview:"overviewAwaitingReview",approved:"approved",rejected:"rejected",pending:"pending"} as Record<string,string>)[item.status] ?? "overviewStatusUpdated")}),person:chefDisplayName(item),kitchen:locations.find(location=>location.id===item.locationId)?.name,scheduled:displayDate(item.updatedAt || item.createdAt!),time:""})),
    ...activity.claims.filter(item => !!(item.updatedAt || item.createdAt)).map(item => ({kind:"claim" as const,id:item.id,date:item.updatedAt || item.createdAt!,title:mt("overviewClaimActivity",{status:mt(financialActivityStatus[item.status ?? ""] ?? "overviewStatusUpdated")}),person:chefDisplayName(item),kitchen:item.kitchenName,scheduled:displayDate(item.updatedAt || item.createdAt!),time:""})),
  ].filter(item => Number.isFinite(Date.parse(item.date)) && Date.parse(item.date) <= Date.now()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, RECENT_ACTIVITY_LIMIT);
  const hasHistory = bookings.length > 0 || locationViewings.length > 0;
  const primaryKitchen = draftKitchens[0] ?? locationKitchens[0];
  const status = liveKitchens.length > 0 ? "live" : publishedButUnavailable ? "unavailable" : locationKitchens.length > 0 ? "draft" : "empty";
  const applicationJourney = status === "live" && bookings.length === 0;
  const journeyView = applicationJourney ? "applications" : primaryKitchen ? "listing-review" : "kitchens";
  interface Task { id: string; title: string; detail?: string; view: string; href?: string; param?: string; locationId?: number; booking?: Booking; rental?: StorageRental; tour?: Viewing; action?: string }
  const groups = new Map<string, Task[]>();
  const addTask = (label: string, task: Task) => groups.set(label, [...(groups.get(label) ?? []), task]);
  const recordTitle = (record: { id?: number; chefName?: string; kitchenName?: string; storageName?: string; claimTitle?: string; referenceCode?: string }) =>
    record.claimTitle || [chefDisplayName(record), record.storageName || record.kitchenName, record.storageName && multiKitchen ? record.kitchenName : undefined].filter(Boolean).join(" · ") || record.referenceCode || `#${record.id}`;
  // A live "can't get in" or safety report from the customer comes first: access until they're inside, safety until resolved.
  for (const problem of problems.data?.problems ?? []) {
    const booking = bookings.find(item => item.id === problem.bookingId);
    const phase = booking && bookingListPhase(booking);
    if (!booking || !phase || FINISHED_PHASES.includes(phase) || problem.kind !== "live" || problem.status === "resolved"
      || problem.history.find(entry => entry.action === "report")?.actorRole !== "chef"
      || !(problem.category === "safety" || problem.category === "access" && !IN_KITCHEN.includes(phase))) continue;
    addTask("ovrCustomerReports", { id: `problem-${problem.id}`, title: ct(problem.category === "safety" ? "opaKitchenSafetyTitle" : "opaKitchenAccessTitle", { chef: chefDisplayName(booking) }),
      detail: problem.description, view: "bookings", href: `/manager/booking/${booking.id}` });
  }
  if (activity.paymentsNeedAttention) addTask("overviewPaymentsAttention", { id: "payments", title: mt(activity.paymentsAction ?? "overviewPaymentsUpdate"), view: "payments" });
  const unreadThreads = activity.unreadThreads ?? [];
  for (const thread of unreadThreads) addTask("overviewUnreadMessages", { id: thread.id, title: applications.find((application) => application.id === thread.applicationId)?.fullName || mt("overviewConversationTitle", { id: thread.applicationId }), detail: mt("overviewUnreadThreadCount", { count: thread.unreadManagerCount }), view: "messages", param: "conversation" });
  if (!unreadThreads.length && activity.unreadMessages > 0) addTask("overviewUnreadMessages", { id: "messages", title: mt("overviewUnreadThreadCount", { count: activity.unreadMessages }), view: "messages" });
  const inspectionHref = (bookingId: number, visitId?: number) => `/manager/booking/${bookingId}/inspection${visitId ? `?visitId=${visitId}` : ""}`;
  // Did they come?: visits the server still lets the kitchen answer, soonest deadline first.
  const attendanceAnswers = bookings.flatMap(booking => openAttendanceAnswers(booking).map(answer => ({ booking, answer })))
    .sort((a, b) => a.answer.deadline.localeCompare(b.answer.deadline));
  const answering = (booking: Booking, visitId?: number) => attendanceAnswers.some(item => item.booking.id === booking.id && (visitId === undefined || item.answer.visitId === undefined || item.answer.visitId === visitId));
  for (const booking of bookings) {
    const bookingZone = locations.find((location) => location.id === (booking.locationId ?? booking.location?.id))?.timezone;
    const label = bookingNextAction(booking, bookingZone);
    /*
     * A dated booking's follow-up is decided day by day: the booking row's own check-in status and times are day 1's
     * (and go stale), which flagged "ended" bookings whose day 1 was checked out and pointed at their next day. Each
     * day that ended and is still open (checkout waiting, or nothing recorded) is its own item, named and linked to that
     * day's inspection; a checked-out day is not.
     */
    const days = managerListDays(booking);
    const perDay = !!days[0]?.dayCount && (!label || FOLLOW_UP_ACTIONS.includes(label));
    const endedDays = perDay ? days.flatMap(day => {
      const action = bookingNextAction(day.row, bookingZone);
      return action && FOLLOW_UP_ACTIONS.includes(action) && !(action === "overviewBookingOutcomes" && answering(booking, day.visitId)) ? [{ day, action }] : [];
    }) : [];
    for (const { day, action } of endedDays) addTask(action, { id: `${booking.id}:${day.visitId}`, title: recordTitle(booking),
      detail: [dayLabel(day), listWhenLine(day.row, i18n.language, words)].filter(Boolean).join(" · "), view: "bookings", href: inspectionHref(booking.id, day.visitId) });
    if (label && !perDay && !(label === "overviewBookingOutcomes" && answering(booking))) {
      const dated = datedDay(booking);
      const visitId = dated.row.visitStates?.length === 1 ? dated.row.visitStates[0].id : undefined;
      // A follow-up (checkout to review, ended booking) opens that day's inspection; everything else opens the booking.
      addTask(label, { id: String(booking.id), title: recordTitle(booking), booking, detail: [dated.label, listWhenLine(dated.row, i18n.language, words)].filter(Boolean).join(" · "), view: "bookings",
        href: FOLLOW_UP_ACTIONS.includes(label) ? inspectionHref(booking.id, visitId) : `/manager/booking/${booking.id}` });
    }
    if (booking.pendingChange) addTask("ovrChangeRequests", { id: `change-${booking.id}`, title: recordTitle(booking), booking, view: "bookings", href: `/manager/booking/${booking.id}` });
    for (const item of booking.equipmentItems || []) if (booking.status === 'confirmed' && item.status === 'cancellation_requested')
      addTask('overviewEquipmentCancellations', { id: `${booking.id}:equipment:${item.equipmentBookingId ?? item.id}`, title: item.name || recordTitle(booking),
        view: 'bookings', href: `/manager/booking/${booking.id}` });
  }
  for (const tour of locationViewings) {
    const label = tourNextAction(tour.viewing);
    const decision = tourRequestDecision(tour.viewing);
    // Same deadlines as the Tours list: respond by for a request, record by for a visit that just ended.
    const due = decision?.stage === 'manager' && decision.dueAt ? ` · ${mt(decision.overdue ? 'tourDecisionOverdue' : 'tourDecisionDue')}: ${formatTourWhen(decision.dueAt, null, 'America/St_Johns')}`
      : label === 'overviewTourRecord' ? ` · ${mt('tourRecordBy')}: ${formatTourWhen(new Date(Date.parse(tour.viewing.scheduledAt) + ((tour.viewing.durationMinutes ?? 30) * 60_000) + 24 * 3_600_000).toISOString(), null, 'America/St_Johns')}` : '';
    if (label) addTask(label, { id: String(tour.viewing.id), title: recordTitle({ ...tour, id: tour.viewing.id }), detail: `${displayDate(tour.viewing.scheduledAt)} · ${tourTime(tour)}${due}`, view: "viewings", param: "viewing", href: `/manager/tours/${tour.viewing.id}`, tour });
  }
  for (const application of pendingApplications) addTask("overviewPendingApplications", { id: String(application.id), title: application.fullName || `#${application.id}`, view: "applications", param: "application" });
  for (const storage of activity.storageBookings) if (!bookings.some(booking => booking.id === storage.kitchenBookingId && booking.paymentDecision?.state === 'pending') && ["pending", "cancellation_requested"].includes(storage.status ?? "")) addTask(storage.cancellationAcceptedAt ? 'overviewStorageOutcomes' : "overviewStorageRequests", { id: String(storage.id), title: recordTitle(storage), detail: storage.cancellationAcceptedAt ? mt("storageRemovalConfirmationRequired") : undefined, view: "storage-bookings", param: "storageBooking" });
  for (const storage of activity.storageBookings) {
    if (storage.status !== "confirmed") continue;
    if (storage.checkinStatus === "checkin_requested") addTask("overviewStorageCheckinReviews", { id: String(storage.id), title: recordTitle(storage), view: "storage-bookings" });
    if (storage.checkoutStatus === "active" && storageHasEnded(storage.endDate)) addTask("overviewStorageOutcomes", { id: String(storage.id), title: recordTitle(storage), view: "storage-bookings", param: "storageBooking" });
  }
  for (const extension of activity.extensions) addTask("overviewStorageExtensions", { id: String(extension.storageBookingId ?? extension.id), title: recordTitle(extension), view: "storage-bookings", param: "storageBooking", detail: extension.newEndDate ? mt("overviewExtensionUntil", { date: displayDate(extension.newEndDate) }) : undefined });
  for (const checkout of activity.storageCheckouts) addTask("overviewStorageCheckoutReviews", { id: String(checkout.storageBookingId ?? checkout.id), title: recordTitle(checkout), view: "storage-bookings" });
  const rentalTitle = (rental: StorageRental) => [rental.chef?.name && !rental.chef.name.includes("@") ? rental.chef.name : mt("guestChef"), rental.listing?.name].filter(Boolean).join(" · ");
  for (const rental of pendingRequests(locationRentals)) addTask("overviewStorageRequests", { id: `rental-${rental.id}`, title: rentalTitle(rental),
    detail: [inKitchen(rental.kitchen?.id, rental.kitchen?.name), mt("ovrStorageStarts", { date: storageDay(rental.startOn, i18n.language) })].filter(Boolean).join(" · "), view: "storage-bookings", href: `/manager/storage/${rental.id}`, rental });
  for (const rental of locationRentals) {
    const chip = chipForRental(rental);
    if (occupiesUnit(rental) && chipNeedsAction(chip)) addTask("ovrStorageToAction", { id: `rental-${rental.id}`, title: rental.listing?.name || rentalTitle(rental),
      detail: [rental.chef?.name && !rental.chef.name.includes("@") ? rental.chef.name : mt("guestChef"), inKitchen(rental.kitchen?.id, rental.kitchen?.name), mt(storageChipKey(chip), { ns: "storage" })].filter(Boolean).join(" · "),
      action: STORAGE_ACTION[chip] && mt(STORAGE_ACTION[chip]!, { ns: "storage" }), view: "storage-bookings", href: `/manager/storage/${rental.id}` });
  }
  for (const claim of activity.claims) if (["draft", "approved", "partially_approved", "chef_accepted", "charge_failed", "escalated"].includes(claim.status ?? "")) addTask("overviewClaimsToAction", { id: String(claim.id), title: recordTitle(claim), view: "damage-claims", param: "claim", detail: mt(claim.status === "draft" ? "overviewClaimComplete" : "overviewClaimCollect") });
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
  /**
   * Staging: the Today card, the week strip and the calendar appear once the kitchen has something on its schedule
   * (bookings, storage rentals or a tour); a first-time kitchen keeps the four-card setup view.
   */
  const hasActivity = bookings.length > 0 || locationRentals.length > 0 || futureTours.length > 0;
  const tourDay = (tour: Viewing) => kitchenTodayKey(DEFAULT_TIMEZONE, Date.parse(tour.viewing.scheduledAt));
  // With the Today card on screen, Upcoming starts tomorrow so nothing is listed twice.
  const later = (key: string) => hasActivity ? key > today : true;
  const scheduleRows: Array<{ key: string; id: string; title: string; detail: string; time: number; href?: string; view: string; param?: string; label: string; pill?: { key: string; tone: BookingPillTone } }> = [
    // The booking page's pill and 12-hour, friendly "Day 1 of 2 · Tue, Oct 20 · 2:00–4:00 p.m." line, one per day.
    ...upcoming.filter(day => later(day.dayKey)).map(day => { const booking = day.row; const phase = bookingListPhase(booking); return ({key:`booking-${booking.id}-${day.visitId ?? 0}`,id:String(booking.id),title:chefDisplayName(booking),detail:[dayLabel(day),listWhenLine(booking,i18n.language,words),booking.kitchenName].filter(Boolean).join(" · "),time:bookingListBounds(booking)?.startAt.getTime() ?? NaN,href:`/manager/booking/${booking.id}`,view:"bookings",param:undefined,label:"",pill:bookingListPill(phase,true,bookingCancelCause({ status: booking.status, chefId: booking.chefId, paymentDecision: booking.paymentDecision as never }))}); }),
    ...locationRentals.filter(rental => rental.state === "reserved" && later(rental.startOn.slice(0, 10)) && rental.startOn.slice(0, 10) >= today).map(rental => ({key:`rental-${rental.id}`,id:String(rental.id),title:rentalTitle(rental),detail:mt("ovrStorageStarts",{date:storageDay(rental.startOn,i18n.language)}),time:Date.parse(`${rental.startOn.slice(0, 10)}T12:00:00Z`),href:`/manager/storage/${rental.id}`,view:"storage-bookings",param:undefined,label:mt("ovrMoveIn")})),
    ...futureTours.filter(tour => later(tourDay(tour))).map(tour => ({key:`tour-${tour.viewing.id}`,id:String(tour.viewing.id),title:chefDisplayName(tour),detail:[displayDate(tour.viewing.scheduledAt),tourTime(tour),tour.kitchenName || tour.locationName].filter(Boolean).join(" · "),time:Date.parse(tour.viewing.scheduledAt),href:undefined,view:"viewings",param:"viewing",label:mt("kitchenTours")})),
    ...scheduledStorage.map(storage => ({key:`storage-${storage.id}`,id:String(storage.id),title:recordTitle(storage),detail:[displayDate(storage.startDate ?? ""),displayDate(storage.endDate ?? "")].join(" – "),time:Date.parse(storage.startDate ?? ""),href:undefined,view:"storage-bookings",param:"storageBooking",label:mt("overviewStorageBookingType")})),
  ].sort((a,b)=>(Number.isFinite(a.time)?a.time:Infinity)-(Number.isFinite(b.time)?b.time:Infinity));
  const hasSchedule = bookings.length > 0 || futureTours.length > 0 || scheduledStorage.length > 0 || locationRentals.length > 0;

  // Open hours and date exceptions (closures, special hours) per kitchen — read only once there is activity to measure.
  const hoursKitchens = hasActivity ? locationKitchens : [];
  const thisWeekStart = weekStartKey(today);
  const lastWeekStart = addDaysKey(thisWeekStart, -7);
  const weeklyHours = useQueries({ queries: hoursKitchens.map(kitchen => ({
    queryKey: ["/api/manager/availability", kitchen.id],
    queryFn: async (): Promise<WeeklyHours[]> => ((await apiGet(`/manager/availability/${kitchen.id}`)) as Array<Record<string, unknown>> || []).map(item => ({
      dayOfWeek: Number(item.dayOfWeek ?? item.day_of_week), startTime: String(item.startTime ?? item.start_time ?? ""), endTime: String(item.endTime ?? item.end_time ?? ""),
      isAvailable: Boolean(item.isAvailable ?? item.is_available) })),
    enabled: !!user, staleTime: 60_000,
  })) });
  const dateOverrides = useQueries({ queries: hoursKitchens.map(kitchen => ({
    queryKey: ["/api/manager/kitchens/date-overrides", kitchen.id, lastWeekStart],
    queryFn: async (): Promise<DateOverride[]> => ((await apiGet(`/manager/kitchens/${kitchen.id}/date-overrides?startDate=${lastWeekStart}`)) as Array<Record<string, unknown>> || []).map(item => ({
      id: Number(item.id), specificDate: String(item.specificDate ?? item.specific_date ?? ""), startTime: (item.startTime ?? item.start_time ?? null) as string | null,
      endTime: (item.endTime ?? item.end_time ?? null) as string | null, isAvailable: Boolean(item.isAvailable ?? item.is_available), reason: (item.reason ?? null) as string | null })),
    enabled: !!user, staleTime: 60_000,
  })) });
  const hoursLoading = weeklyHours.some(query => query.isLoading) || dateOverrides.some(query => query.isLoading);
  const hoursByKitchen = new Map(hoursKitchens.flatMap((kitchen, index) => weeklyHours[index]?.data && dateOverrides[index]?.data
    ? [[kitchen.id, { weekly: weeklyHours[index].data!, overrides: dateOverrides[index].data! }] as const] : []));
  const weekDays = dayRows.map(({ row }) => ({ bookingId: row.id, kitchenId: row.kitchenId, status: row.status, bookingDate: row.bookingDate, startTime: row.startTime,
    endTime: row.endTime, operatingWindowStartTime: row.operatingWindowStartTime, selectedSlots: row.selectedSlots }));
  /** This week and last, for every kitchen or the one the calendar is filtered to (bookings, hours and open hours alike). */
  const statsFor = (kitchenId: number | null) => {
    const days = kitchenId === null ? weekDays : weekDays.filter(day => day.kitchenId === kitchenId);
    const hours = kitchenId === null ? hoursByKitchen : new Map(Array.from(hoursByKitchen).filter(([id]) => id === kitchenId));
    return { thisWeek: weekStats(days, thisWeekStart, hours), lastWeek: weekStats(days, lastWeekStart, hours) };
  };

  /** Everything on the kitchen's calendar, one event per booked day and visit block, coloured like the booking pills. */
  const calendarEvents: CalendarEvent[] = !hasActivity ? [] : [
    ...dayRows.flatMap(day => {
      const row = day.row;
      const phase = bookingListPhase(row);
      const pill = bookingListPill(phase, true, bookingCancelCause({ status: row.status, chefId: row.chefId, paymentDecision: row.paymentDecision as never }));
      const startAt = bookingListBounds(row)?.startAt.getTime();
      // One state per visit day; "Answer needed" only while the server still takes the kitchen's answer.
      const state: VisitState = phase === "cancelled" ? "cancelled" : phase === "pending" ? "requested" : answering(row, day.visitId) ? "answer"
        : phase === "no_checkin" || phase === "no_show" ? "noCheckin" : ["completed", "visit_ended", "issue", "checkout_review"].includes(phase) ? "finished" : "booked";
      const label = state === "answer" ? mt("ovrLegendAnswerNeeded") : state === "finished" ? mt("ovrLegendFinished") : ct(pill.key);
      return kitchenBookingBlocks(row).map((block, index) => ({ key: `booking-${row.id}-${day.visitId ?? 0}-${index}`, kind: "booking" as const, date: day.dayKey,
        start: block.startTime, end: block.endTime, sortAt: startAt === undefined ? undefined : startAt + spanMinutes(row.startTime, block.startTime) % 1440 * 60_000,
        title: chefDisplayName(row), detail: [dayLabel(day), row.kitchenName].filter(Boolean).join(" · "), kitchenId: row.kitchenId, kitchen: kitchenName(row.kitchenId, row.kitchenName), label, tone: pill.tone, state,
        muted: FINISHED_PHASES.includes(phase), cancelled: phase === "cancelled", now: IN_KITCHEN.includes(phase), href: `/manager/booking/${row.id}` }));
    }),
    ...locationViewings.filter(({ viewing }) => ["pending", "confirmed", "completed"].includes(viewing.status) && Number.isFinite(Date.parse(viewing.scheduledAt))).map(item => {
      const at = Date.parse(item.viewing.scheduledAt);
      const status = item.viewing.status;
      return { key: `tour-${item.viewing.id}`, kind: "tour" as const, date: tourDay(item), start: clockIn(at, DEFAULT_TIMEZONE),
        end: clockIn(at + (item.viewing.durationMinutes ?? 30) * 60_000, DEFAULT_TIMEZONE), sortAt: at, title: chefDisplayName(item),
        kitchenId: item.viewing.targetedKitchenId ?? undefined, kitchen: item.viewing.targetedKitchenId ? kitchenName(item.viewing.targetedKitchenId, item.kitchenName) : undefined,
        detail: [mt("ovrLegendTour"), item.kitchenName || item.locationName].filter(Boolean).join(" · "),
        label: mt(status === "pending" ? "ovrTourRequested" : status === "completed" ? "completed" : "ovrTourScheduled"),
        tone: status === "pending" ? "amber" as const : status === "completed" ? "grey" as const : "blue" as const, muted: status === "completed",
        onOpen: () => openTask({ id: String(item.viewing.id), title: "", view: "viewings", param: "viewing" }) };
    }),
    ...hoursKitchens.flatMap((kitchen, index) => (dateOverrides[index]?.data ?? []).map(item => {
      const closed = !item.isAvailable || !item.startTime || !item.endTime;
      return { key: `override-${kitchen.id}-${item.id || item.specificDate}`, kind: closed ? "closed" as const : "hours" as const, date: item.specificDate.slice(0, 10),
        ...(closed ? {} : { start: item.startTime!, end: item.endTime! }), title: kitchen.name, detail: item.reason || undefined, kitchenId: kitchen.id, kitchen: kitchen.name,
        label: mt(closed ? "closed" : "ovrSpecialHours"), tone: closed ? "grey" as const : "neutral" as const, onOpen: () => onNavigate("availability", kitchen.id) };
    })),
    ...locationRentals.flatMap(rental => {
      const base = { title: rentalTitle(rental), detail: rental.kitchen?.name, kitchenId: rental.kitchen?.id, kitchen: rental.kitchen?.name, href: `/manager/storage/${rental.id}` };
      const events: CalendarEvent[] = [];
      if (["requested", "reserved", "active", "move_out_requested", "removal_review"].includes(rental.state) && rental.startOn) events.push({ ...base, key: `rental-in-${rental.id}`,
        kind: "moveIn", date: rental.startOn.slice(0, 10), label: mt(rental.state === "requested" ? "ovrStorageRequested" : "ovrMoveIn"), tone: rental.state === "requested" ? "amber" : "purple",
        muted: !["requested", "reserved"].includes(rental.state) });
      if (["reserved", "active", "move_out_requested", "removal_review"].includes(rental.state) && rental.paidThrough) events.push({ ...base, key: `rental-out-${rental.id}`,
        kind: "moveOut", date: rental.paidThrough.slice(0, 10), label: mt("ovrMoveOut"), tone: "purple" });
      return events;
    }),
  ];
  // Today: every visit in time order, a now-line between what's done and what's next; cancelled ones fold into one line.
  const todayAll = sortEvents(calendarEvents.filter(event => event.date === today));
  const todayList = todayAll.filter(event => !event.cancelled);
  const cancelledTodayList = todayAll.filter(event => event.cancelled);
  const inKitchenNow = todayList.filter(event => event.now).length;
  const nowAt = Date.now();
  const firstAfterNow = todayList.findIndex(event => !!event.start && (event.sortAt ?? 0) > nowAt);
  const nowIndex = firstAfterNow < 0 ? todayList.length : firstAfterNow;
  const tomorrowKey = addDaysKey(today, 1);
  const tomorrowList = sortEvents(calendarEvents.filter(event => event.date === tomorrowKey && event.kind === "booking" && !event.cancelled));
  const nextDay = upcoming.find(day => day.dayKey > today);
  const scheduleLoading = isLoadingBookings || isLoadingViewings || isLoadingRentals || activity.isLoading;
  const longDate = new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(Date.now());
  const weekdayDate = (key: string) => new Intl.DateTimeFormat(i18n.language, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${key}T12:00:00Z`));
  const percent = (value: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 }).format(value / 100);
  const cardClass = card;
  const panelClass = `${card} h-[320px]`;

  const attentionLoading = isLoadingBookings || isLoadingViewings || isLoadingApplications || activity.isLoading;
  const attentionError = isErrorBookings || isErrorViewings || isErrorApplications || activity.isError;
  const todoCount = attentionCount + attendanceAnswers.length;
  const requestGroup = attentionGroups.find(group => group.label === "overviewPendingBookings");
  const storageRequestGroup = attentionGroups.find(group => group.label === "overviewStorageRequests");
  const changeGroup = attentionGroups.find(group => group.label === "ovrChangeRequests");
  const storageGroup = attentionGroups.find(group => group.label === "ovrStorageToAction");
  const reportGroup = attentionGroups.find(group => group.label === "ovrCustomerReports");
  // Tours read like bookings (owner, Oct 24): request cards, change cards, and visits to record beside "Did they come?".
  const tourRequestGroup = attentionGroups.find(group => group.label === "overviewPendingTours");
  const tourChangeGroup = attentionGroups.find(group => group.label === "overviewTourReschedules");
  const tourRecords = attentionGroups.find(group => group.label === "overviewTourRecord")?.items ?? [];
  const tourGroups = new Set([tourRequestGroup, tourChangeGroup, attentionGroups.find(group => group.label === "overviewTourRecord")]);
  const otherGroups = attentionGroups.filter(group => group !== reportGroup && group !== requestGroup && group !== storageRequestGroup && group !== changeGroup && group !== storageGroup && !tourGroups.has(group));
  const groupSection = (key: string, label: string, count: number, children: ReactNode, note?: ReactNode) => (
    <section key={key} aria-labelledby={`attention-${key}`} className="border-t border-stone-100 pt-4 first:border-t-0 first:pt-0 [&+&]:mt-4">
      <h3 id={`attention-${key}`} className={cn(groupLabel, "sm:px-4")}>{label}<span className={groupCount}>{count}</span></h3>
      {note}
      <div className="mt-2">{children}</div>
    </section>);
  const rowLink = (task: Task) => {
    const content = <>
      <span className="min-w-0"><span className="block break-words text-sm font-medium text-stone-900">{task.title}</span>{task.detail && <span className={cn("mt-0.5 block break-words", sub)}>{task.detail}</span>}</span>
      {task.action ? <><span className={cn(btnSecondary, "hidden sm:inline-flex")}>{task.action}</span><ChevronRight className="size-4 text-stone-400 sm:hidden" aria-hidden="true" /></>
        : <ChevronRight className="size-4 text-stone-400" aria-hidden="true" />}
    </>;
    const className = cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 border-t border-stone-100 py-3 text-left transition-colors first:border-t-0 hover:bg-stone-50/70 motion-reduce:transition-none sm:px-4", focusRing);
    return task.href ? <Link key={task.id} href={task.href} className={className}>{content}</Link> : <button key={task.id} type="button" className={className} onClick={() => openTask(task)}>{content}</button>;
  };
  const requestRow = (task: Task) => {
    const booking = task.booking!;
    const days = managerListDays(booking);
    const chef = chefDisplayName(booking);
    const hours = Number(booking.durationHours);
    const deadline = bookingResponseDeadline(booking);
    const due = deadline && formatResponseDeadline(deadline, i18n.language, booking.timezone || timezone, false);
    const facts = [Number.isFinite(hours) && hours > 0 ? mt("ovrHoursValue", { hours: hoursText(hours * 60, i18n.language) }) : "",
      typeof booking.totalPrice === "number" ? formatCurrency(booking.totalPrice, "CAD", i18n.language) : ""].filter(Boolean);
    return tintedRequest({ key: task.id, testId: "booking-request", chef, href: `/manager/booking/${booking.id}/review`, due, facts,
      when: [listWhenLine(days[0].row, i18n.language, words), days.length > 1 ? mt("ovrDayCount", { count: days.length }) : ""].filter(Boolean).join(" · "),
      who: [chef, kitchenName(booking.kitchenId, booking.kitchenName)].filter(Boolean).join(" · ") });
  };
  // A change request reads like a booking request: the booked time, who wants it changed, the answer-by time, one Review button.
  const changeRow = (task: Task) => {
    const booking = task.booking!;
    const chef = chefDisplayName(booking);
    return tintedRequest({ key: task.id, testId: "change-request", chef, href: task.href!, facts: [mt("ovrWantsChange")],
      due: formatResponseDeadline(new Date(booking.pendingChange!.decisionBy), i18n.language, booking.timezone || timezone, false),
      when: listWhenLine(managerListDays(booking)[0].row, i18n.language, words),
      who: [chef, kitchenName(booking.kitchenId, booking.kitchenName)].filter(Boolean).join(" · ") });
  };
  // A storage request reads like a booking request: what and when, who and where, the total, the answer-by time, one Review button.
  const storageRequestRow = (task: Task) => {
    const rental = task.rental!;
    const chef = rental.chef?.name && !rental.chef.name.includes("@") ? rental.chef.name : mt("guestChef");
    const total = rental.terms?.[0]?.totalCents;
    return tintedRequest({ key: task.id, testId: "storage-request", chef, href: `/manager/storage/${rental.id}`,
      due: rental.responseDeadline ? formatResponseDeadline(new Date(rental.responseDeadline), i18n.language, rental.timezone || timezone, false) : null,
      when: [rental.listing?.name, `${storageDay(rental.startOn.slice(0, 10), i18n.language)} – ${storageDay(rental.paidThrough.slice(0, 10), i18n.language)}`].filter(Boolean).join(" · "),
      who: [chef, kitchenName(rental.kitchen?.id, rental.kitchen?.name)].filter(Boolean).join(" · "),
      facts: typeof total === "number" ? [cad(total, i18n.language)] : [] });
  };
  // A tour request or time change reads like a booking request: the tour time, who and where, the answer-by time, Review.
  // The Dashboard's tour rows carry optional fields; the shared list rule wants them filled.
  const asListTour = (viewing: Viewing["viewing"]): TourListTour => ({ ...viewing, createdAt: viewing.createdAt ?? viewing.scheduledAt,
    updatedAt: viewing.updatedAt ?? viewing.scheduledAt, disruptionReason: viewing.disruptionReason ?? null, cancelledBy: viewing.cancelledBy ?? null,
    adminReviewDecision: viewing.adminReviewDecision ?? null, requestedRescheduleAt: viewing.requestedRescheduleAt ?? null, durationMinutes: viewing.durationMinutes ?? 30 });
  const tourRequestRow = (task: Task) => {
    const tour = task.tour!;
    const chef = chefDisplayName(tour);
    const listed = tourListState(asListTour(tour.viewing));
    return tintedRequest({ key: task.id, testId: listed.action === "review_change" ? "tour-change-request" : "tour-request", chef, href: task.href!,
      facts: [mt(listed.action === "review_change" ? "ovrWantsChange" : "ovrLegendTour")],
      due: listed.dueAt ? formatResponseDeadline(new Date(listed.dueAt), i18n.language, timezone, false) : null,
      when: tourWhenLine(asListTour(tour.viewing), timezone, i18n.language, words),
      who: [chef, kitchenName(tour.viewing.targetedKitchenId, tour.kitchenName)].filter(Boolean).join(" · ") });
  };
  function tintedRequest({ key, testId, chef, when, who, facts, due, href }: { key: string; testId: string; chef: string; when: string; who: string; facts: string[]; due: string | null | undefined; href: string }) {
    const initials = chef.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
    return <div key={key} className="grid gap-3 rounded-[10px] bg-[#fef3f5] px-4 py-3.5 lg:grid-cols-[36px_minmax(0,1fr)_auto] lg:items-center lg:gap-x-4 [&+&]:mt-2" data-testid={testId}>
      <span aria-hidden="true" className="hidden size-9 items-center justify-center rounded-full bg-white text-xs font-semibold text-[#8f0a2b] ring-1 ring-[#fbcbd6] lg:flex">{initials}</span>
      <div className="min-w-0">
        <p className="break-words font-medium text-stone-900">{when}</p>
        <p className={cn("mt-0.5", sub)}>{who}{facts.length > 0 && <><span className="hidden sm:inline"> · </span><span className="block sm:inline">{facts.join(" · ")}</span></>}</p>
        {due && <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#8f0a2b]"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{mt("ovrRespondBy", { when: due })}</p>}
      </div>
      <Link href={href} className={cn(btnPrimary, "sm:h-11 sm:w-full lg:h-9 lg:w-auto")}>{mt("ovrReviewRequest")}</Link>
    </div>;
  }
  // Two equal answers share the row width until the column is wide enough to sit them beside the visit.
  const answerButton = cn(btnSecondary, "sm:h-10 sm:flex-1 lg:h-8 lg:flex-none");
  const answerRow = ({ booking, answer }: typeof attendanceAnswers[number]) => {
    const zone = booking.timezone || timezone;
    const when = `${answer.localDate === today ? mt("today") : weekdayDate(answer.localDate)}, ${timeRange(formatTime(answer.startTime, i18n.language), formatTime(answer.endTime, i18n.language))}`;
    const deadline = Date.parse(answer.deadline);
    const by = kitchenTodayKey(zone, deadline) === today
      ? mt("ovrAnswerByToday", { time: new Intl.DateTimeFormat(i18n.language, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(deadline) })
      : mt("ovrAnswerBy", { when: new Intl.DateTimeFormat(i18n.language, { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(deadline) });
    const chef = chefDisplayName(booking);
    // Both answers open the booking's visit record on that choice; nothing is recorded until the kitchen confirms there.
    const href = (choice: "came" | "no_show") => `/manager/booking/${booking.id}?${answer.visitId ? `visitId=${answer.visitId}&` : ""}attendance=${choice}`;
    return <div key={`${booking.id}-${answer.visitId ?? 0}`} data-testid="attendance-answer-row" className="grid gap-x-5 gap-y-2.5 border-t border-stone-100 py-3 first:border-t-0 sm:px-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="font-medium text-stone-900">{when}</p>
        <p className={cn("mt-0.5", sub)}>{[chef, inKitchen(booking.kitchenId, booking.kitchenName)].filter(Boolean).join(" · ")}<span className={cn("block", deadline - Date.now() <= 3 * 3_600_000 && "font-medium text-amber-800")}>{by}</span></p>
      </div>
      <div className="flex gap-2">
        <Link href={href("came")} className={answerButton} aria-label={[`${mt("ovrTheyCame")}: ${when}`, chef, inKitchen(booking.kitchenId, booking.kitchenName)].filter(Boolean).join(", ")}>{mt("ovrTheyCame")}</Link>
        <Link href={href("no_show")} className={answerButton} aria-label={[`${mt("ovrReportNoShow")}: ${when}`, chef, inKitchen(booking.kitchenId, booking.kitchenName)].filter(Boolean).join(", ")}>{mt("ovrReportNoShow")}</Link>
      </div>
    </div>;
  };
  // A tour that just ended sits with the booking visits: same answers, opening the tour on that choice (nothing saved yet).
  const tourAnswerRow = (task: Task) => {
    const tour = task.tour!;
    const chef = chefDisplayName(tour);
    const when = tourWhenLine(asListTour(tour.viewing), timezone, i18n.language, words);
    const deadline = Date.parse(tourListState(asListTour(tour.viewing)).dueAt ?? "");
    const by = Number.isFinite(deadline) ? kitchenTodayKey(timezone, deadline) === today
      ? mt("ovrAnswerByToday", { time: new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(deadline) })
      : mt("ovrAnswerBy", { when: new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(deadline) }) : "";
    const label = (choice: string) => [`${choice}: ${when}`, chef, mt("ovrLegendTour")].join(", ");
    return <div key={`tour-${tour.viewing.id}`} data-testid="tour-answer-row" className="grid gap-x-5 gap-y-2.5 border-t border-stone-100 py-3 first:border-t-0 sm:px-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="font-medium text-stone-900">{when}</p>
        <p className={cn("mt-0.5", sub)}>{[chef, mt("ovrLegendTour"), inKitchen(tour.viewing.targetedKitchenId, tour.kitchenName)].filter(Boolean).join(" · ")}{by && <span className={cn("block", deadline - Date.now() <= 3 * 3_600_000 && "font-medium text-amber-800")}>{by}</span>}</p>
      </div>
      <div className="flex gap-2">
        <Link href={`/manager/tours/${tour.viewing.id}?action=came`} className={answerButton} aria-label={label(mt("ovrTheyCame"))}>{mt("ovrTheyCame")}</Link>
        <Link href={`/manager/tours/${tour.viewing.id}?action=no_show`} className={answerButton} aria-label={label(mt("ovrReportNoShow"))}>{mt("ovrReportNoShow")}</Link>
      </div>
    </div>;
  };
  const attentionCard = (fixedHeight: boolean) => {
    const body = <>
      {attentionError && <p role="status" className="mb-3 text-sm text-destructive">{mt("overviewActivityPartialError")}</p>}
      {attentionLoading && <Skeleton className="h-12 rounded-lg" />}
      {reportGroup && groupSection("reports", mt(reportGroup.label), reportGroup.items.length, reportGroup.items.map(rowLink))}
      {requestGroup && groupSection("requests", mt(requestGroup.label), requestGroup.items.length, requestGroup.items.map(task => task.booking ? requestRow(task) : rowLink(task)))}
      {changeGroup && groupSection("change-requests", mt(changeGroup.label), changeGroup.items.length, changeGroup.items.map(changeRow))}
      {storageRequestGroup && groupSection("storage-requests", mt(storageRequestGroup.label), storageRequestGroup.items.length, storageRequestGroup.items.map(task => task.rental ? storageRequestRow(task) : rowLink(task)))}
      {tourRequestGroup && groupSection("tour-requests", mt(tourRequestGroup.label), tourRequestGroup.items.length, tourRequestGroup.items.map(tourRequestRow))}
      {tourChangeGroup && groupSection("tour-change-requests", mt(tourChangeGroup.label), tourChangeGroup.items.length, tourChangeGroup.items.map(tourRequestRow))}
      {attendanceAnswers.length + tourRecords.length > 0 && groupSection("attendance", mt("ovrDidTheyCome"), attendanceAnswers.length + tourRecords.length, [...attendanceAnswers.map(answerRow), ...tourRecords.map(tourAnswerRow)],
        <p className={cn("mt-1.5 flex gap-1.5 sm:px-4", sub)}><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{mt("ovrDidTheyComeNote")}</p>)}
      {storageGroup && groupSection("storage", mt(storageGroup.label), storageGroup.items.length, storageGroup.items.map(rowLink))}
      {otherGroups.map((group, index) => groupSection(`group-${index}`, mt(group.label), group.items.length, group.items.map(rowLink)))}
      {!todoCount && !attentionLoading && !attentionError && <div className="flex items-start gap-3 rounded-lg bg-stone-50 p-4"><CheckCircle className="mt-0.5 size-4 shrink-0 text-stone-500" aria-hidden="true" /><div className="min-w-0"><p className="text-sm font-medium">{mt("overviewAllCaughtUp")}</p><p className={cn("mt-1", sub)}>{mt("overviewAllCaughtUpBody")}</p></div></div>}
    </>;
    return <section className={cn(fixedHeight ? panelClass : card, "flex flex-col xl:h-full")} aria-labelledby="overview-attention-title" data-testid="overview-attention">
      <div className={cardHead}><h2 id="overview-attention-title" className={cardTitle}>{mt("overviewNeedsAttention")}{todoCount > 0 && <span className={cardMeta}>{mt("ovrToDoCount", { count: todoCount })}</span>}</h2></div>
      {fixedHeight ? <ScrollArea className={cn(cardBody, "min-h-0 flex-1")} tabIndex={0} role="region" aria-label={mt("overviewNeedsAttention")}>{body}</ScrollArea>
        : <div className={cardBody} role="region" aria-label={mt("overviewNeedsAttention")}>{body}</div>}
    </section>;
  };
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
    <ScrollArea className={scrollClass} tabIndex={0} role="region" aria-label={mt("overviewUpcomingBookings")}>
      {isLoadingBookings || isLoadingViewings || (!bookings.length && isLoadingApplications) || activity.isLoading ? <Skeleton className="h-32 rounded-xl" /> : isErrorBookings || isErrorViewings || (!bookings.length && isErrorApplications) || activity.isError ? <p role="status" className="text-sm text-destructive">{mt("overviewActivityPartialError")}</p> : null}
      {scheduleRows.map(item => {const content=<><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.detail}</span></span><span className="flex shrink-0 items-center gap-2">{"pill" in item && item.pill ? <StatusPill tone={item.pill.tone}>{ct(item.pill.key)}</StatusPill> : <Badge variant="outline" className="font-medium">{item.label}</Badge>}<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></span></>;return item.href ? <Link key={item.key} href={item.href} className={rowClass}>{content}</Link> : <button key={item.key} className={rowClass} onClick={()=>openTask(item)}>{content}</button>;})}
      {!scheduleRows.length && !isLoadingBookings && !isLoadingViewings && !isLoadingApplications && !activity.isLoading && !isErrorBookings && !isErrorViewings && !isErrorApplications && !activity.isError && <div className="rounded-xl bg-muted/40 p-4"><p className="font-medium">{mt(bookings.length ? "overviewNoUpcoming" : !applicationJourney ? "overviewPrepareForApplications" : pendingApplications.length ? "overviewApplicationsToReview" : approvedApplications.length ? "overviewApprovedChefs" : "overviewWaitingForApplications")}</p><p className="mt-1 text-sm text-muted-foreground">{mt(bookings.length ? status === "draft" && hasHistory ? "overviewPastBookingsRemain" : "overviewNoUpcomingBody" : !applicationJourney ? "overviewPublishBeforeApplicationsBody" : pendingApplications.length ? "overviewReviewApplicationsBody" : approvedApplications.length ? "overviewApprovedChefsBody" : "overviewWaitingForApplicationsBody")}</p></div>}
    </ScrollArea></CardContent></Card>;
  const fixedCards = !hasActivity;
  const historyLoading = isLoadingBookings || isLoadingViewings || isLoadingApplications || activity.isLoading;
  const historyError = isErrorBookings || isErrorViewings || isErrorApplications || activity.isError;
  const activityCard = <section className={cn(fixedCards ? panelClass : card, "flex flex-col xl:h-full")} data-testid="overview-activity" aria-labelledby="overview-activity-title">
    <div className={cardHead}><h2 id="overview-activity-title" className={cardTitle}>{mt("overviewRecentActivity")}</h2>
      {(hiddenActivity > 0 || allActivity) && <button type="button" className={cn(linkTertiary, "shrink-0")} aria-expanded={allActivity} onClick={() => setAllActivity(open => !open)}>{allActivity ? mt("ovrShowFewer") : mt("ovrShowMoreCount", { count: hiddenActivity })}</button>}</div>
    {/* Column flex that wraps: a row that doesn't fit whole moves to a second, clipped column instead of showing cut in half. */}
    <div ref={activityListRef} className={cn("relative min-h-0 flex-1 pb-3", fixedCards ? "overflow-y-auto px-4 sm:px-5" : allActivity ? "px-4 sm:px-5" : "mx-4 flex max-h-[420px] flex-col flex-wrap content-start overflow-hidden sm:mx-5 xl:max-h-none [&>*]:w-full [&>*]:shrink-0")} tabIndex={0} role="region" aria-label={mt("overviewRecentActivity")}>
      {historyError && <p role="status" className="mb-3 text-sm text-destructive">{mt("overviewActivityPartialError")}</p>}
      {historyLoading && !recent.length && <Skeleton className="h-24 rounded-lg" />}
      {!historyLoading && !historyError && !recent.length && <p className={cn("rounded-lg bg-stone-50 p-4", sub)}>{mt("overviewRecentActivityEmpty")}</p>}
      {recent.map(item => {
        const view = ACTIVITY_VIEW[item.kind] ?? "bookings";
        const content = <>
          <span className="min-w-0 text-sm font-medium text-stone-900">{item.title}</span>
          <time dateTime={item.date} title={displayDate(item.date)} className="whitespace-nowrap text-xs text-stone-500">{formatRelativeTime(item.date, i18n.language)}</time>
          <span className={cn("col-span-2 mt-0.5 min-w-0 truncate", sub)}>{[item.person, item.kitchen, item.scheduled, item.time].filter(Boolean).join(" · ")}</span>
        </>;
        const className = cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-stone-100 py-2.5 text-left transition-colors first:border-t-0 hover:bg-stone-50/70 motion-reduce:transition-none", focusRing);
        return item.kind === "booking" || item.kind === "rental" ? <Link key={`${item.kind}-${item.activityKey}`} href={item.href} className={className}>{content}</Link>
          : <button type="button" key={`${item.kind}-${item.id}-${item.kind === "tour" ? item.activityKey : "current"}`} onClick={() => openTask({ id: String(item.id), title: item.title, view, param: ACTIVITY_PARAM[item.kind] })} className={className}>{content}</button>;
      })}
    </div>
  </section>;

  const todayBookings = todayList.filter(event => event.kind === "booking").length;
  const todayCard = <section className={cn(card, "xl:h-full")} data-testid="overview-today" aria-labelledby="overview-today-title">
    <div className={cardHead}><h2 id="overview-today-title" className={cardTitle}>{mt("today")}{todayBookings > 0 && <span className={cardMeta}>{mt("ovrBookingCount", { count: todayBookings })}</span>}</h2></div>
    <div className={cn(cardBody, "pt-1")}>
      {scheduleLoading && !todayList.length && <Skeleton className="h-20 rounded-lg" />}
      <div className="divide-y divide-stone-100">{todayList.slice(0, nowIndex).map(event => <CalendarEventRow key={event.key} event={event} locale={i18n.language} />)}</div>
      {todayList.length > 0 && <div className="flex items-center gap-2 py-2.5 text-xs" data-testid="today-now-line">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="whitespace-nowrap font-semibold text-[#8f0a2b]">{mt("ovrNowAt", { time: formatTime(`${Math.floor(kitchenNowMinutes(timezone, nowAt) / 60)}:${String(kitchenNowMinutes(timezone, nowAt) % 60).padStart(2, "0")}`, i18n.language) })}</span>
        <span className="whitespace-nowrap text-stone-500">{inKitchenNow ? mt("ovrInKitchenNow", { count: inKitchenNow }) : mt("ovrNoOneInKitchen")}</span>
        <span aria-hidden="true" className="h-0.5 min-w-4 flex-1 rounded-full bg-primary" />
      </div>}
      <div className="divide-y divide-stone-100">{todayList.slice(nowIndex).map(event => <CalendarEventRow key={event.key} event={event} locale={i18n.language} />)}</div>
      {!scheduleLoading && todayList.length > 0 && nowIndex === todayList.length && <p className={cn("pb-1", sub)}>{mt("ovrNothingElseToday")}</p>}
      {!scheduleLoading && !todayList.length && <div className="rounded-lg bg-stone-50 p-4"><p className="text-sm font-medium">{mt("ovrNothingToday")}</p>
        {nextDay && !tomorrowList.length && <p className={cn("mt-1", sub)}>{mt("ovrNextUp", { when: [chefDisplayName(nextDay.row), dayLabel(nextDay), listWhenLine(nextDay.row, i18n.language, words)].filter(Boolean).join(" · ") })}</p>}</div>}
      {cancelledTodayList.length > 0 && <div className="mt-2 border-t border-stone-100 pt-1">
        <button type="button" aria-expanded={showDoneToday} aria-controls="overview-today-cancelled" onClick={() => setShowDoneToday(open => !open)}
          className={cn("flex w-full items-center gap-1.5 rounded-md py-2 text-left text-[13px] text-stone-600 hover:text-stone-900", focusRing)}>
          <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", showDoneToday && "rotate-90")} />
          {mt("ovrTodayCancelled", { count: cancelledTodayList.length })}
        </button>
        {showDoneToday && <div id="overview-today-cancelled" className="divide-y divide-stone-100">{cancelledTodayList.map(event => <CalendarEventRow key={event.key} event={event} locale={i18n.language} />)}</div>}
      </div>}
      {tomorrowList.length > 0 && <div className="mt-2 border-t border-stone-100 pt-3" data-testid="overview-tomorrow">
        <p className="flex justify-between gap-3 text-xs text-stone-500"><span>{mt("ovrTomorrowOn", { date: weekdayDate(tomorrowKey) })}</span><span>{mt("ovrBookingCount", { count: tomorrowList.length })}</span></p>
        <ul className="mt-1.5">{tomorrowList.map(event => <li key={event.key}>
          <Link href={event.href ?? "/manager/bookings"} className={cn("flex min-h-10 items-center justify-between gap-3 rounded text-[13px] hover:text-stone-900 lg:min-h-7", multiKitchen && "py-1.5", focusRing)}>
            <span className="whitespace-nowrap font-semibold tabular-nums text-stone-900">{timeRange(formatTime(event.start!, i18n.language), formatTime(event.end!, i18n.language))}</span>
            {/* Several kitchens: chef over kitchen, each on one line, instead of one ragged wrapped line. */}
            {multiKitchen ? <span className="min-w-0 text-right text-stone-600"><span className="block truncate">{event.title}</span><span className="block truncate text-xs text-stone-500">{event.kitchen}</span></span>
              : <span className="min-w-0 truncate text-stone-600">{event.title}</span>}
          </Link></li>)}</ul>
      </div>}
    </div>
  </section>;

  const weekStatsBlock = (kitchenId: number | null) => { const { thisWeek, lastWeek } = statsFor(kitchenId); const weekTiles = [
    { key: "bookings", label: mt("ovrWeekBookings"), value: String(thisWeek.bookings), lines: [mt("ovrLastWeek", { value: String(lastWeek.bookings) })] },
    { key: "hours", label: mt("ovrWeekHours"), value: mt("ovrHoursValue", { hours: hoursText(thisWeek.bookedMinutes, i18n.language) }), lines: [mt("ovrLastWeek", { value: mt("ovrHoursValue", { hours: hoursText(lastWeek.bookedMinutes, i18n.language) }) })] },
    { key: "utilisation", label: mt("ovrWeekUtilisation"), value: thisWeek.utilisation === null ? "—" : percent(thisWeek.utilisation),
      lines: thisWeek.utilisation === null ? [mt("ovrUtilisationNoHours")] : [mt("ovrOfOpenHours", { hours: hoursText(thisWeek.openMinutes, i18n.language) }), mt("ovrLastWeek", { value: lastWeek.utilisation === null ? "—" : percent(lastWeek.utilisation) })] },
  ];
  return bookings.length > 0 && <dl data-testid="overview-week" className="grid border-b border-stone-100 pb-4 lg:grid-cols-[1fr_1fr_1.4fr]">
    {weekTiles.map((tile, index) => <div key={tile.key} data-testid={`week-${tile.key}`} className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 lg:block lg:py-0", index > 0 && "border-t border-stone-100 lg:border-l lg:border-t-0 lg:pl-5", index < 2 && "lg:pr-5")}>
      <dt className="text-sm text-stone-900 lg:text-[13px] lg:text-stone-600">{tile.label}</dt>
      <dd className="row-span-2 flex items-center justify-end gap-3 text-[22px] font-semibold leading-8 tracking-[-0.01em] text-stone-900 tabular-nums lg:mt-1 lg:justify-start lg:text-[26px] lg:leading-[34px]">{tile.key === "utilisation" && hoursLoading ? <Skeleton className="h-7 w-14 rounded" /> : tile.value}</dd>
      {!(tile.key === "utilisation" && hoursLoading) && <dd className="text-xs leading-4 text-stone-500 lg:mt-0.5">{tile.lines.join(" · ")}</dd>}
      {tile.key === "utilisation" && !hoursLoading && thisWeek.utilisation !== null && <dd aria-hidden="true" className="relative col-span-2 mt-2 h-1.5 max-w-[240px] rounded-full bg-stone-100">
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.min(100, thisWeek.utilisation)}%` }} />
        {lastWeek.utilisation !== null && <span className="absolute -inset-y-1 w-0.5 rounded-sm bg-stone-900" style={{ left: `${Math.min(100, lastWeek.utilisation)}%` }} />}
      </dd>}
    </div>)}
  </dl>; };

  const revenueVisible = bookings.length > 0 || activity.storageBookings.length > 0 || locationRentals.length > 0 || liveKitchens.length > 0;
  const revenueCard = <RevenuePayoutsCard className={card} locale={i18n.language} isLoading={ledger.isLoading || isLoadingRevenue || isLoadingPayouts} isError={isErrorRevenue}
    monthLabel={new Date().toLocaleDateString(i18n.language, { month: "long", year: "numeric" })} onDetails={() => onNavigate("revenue")}
    summary={revenueSummaryFromLedger(ledger.data) ?? revenueSummaryFromCurrent(revenue, upcomingPayouts, selectedLocation ? new Set(bookings.map(booking => booking.id)) : undefined)}
    // "Pending payments" (the old overview's pendingPayments) is no longer shown: it read $0.00 beside a non-zero Upcoming.
    extras={[mt("ovrPaidBookingsCount", { count: revenue?.paidBookingCount ?? 0 })]} />;

  // Listing chip: one kitchen names itself; several summarise and list each kitchen in a popover.
  const listings = locationKitchens.map(kitchen => {
    const review = (activity.listingReadiness ?? []).find(item => item.kitchenId === kitchen.id);
    const checklist = review?.data?.checklist;
    const listed = kitchenIsVisibleToChefs(kitchen, licenseForKitchen(kitchen));
    const missing = checklist?.missingRequirementIds.length ?? 0;
    const optional = checklist?.openRecommendationIds.length ?? 0;
    const complete = Boolean(checklist && !review?.isLoading && !review?.isError && !missing && !optional);
    return { kitchen, listed, unavailable: kitchen.listingStatus === "active" && !listed, note: missing ? mt("ovrItemsToFinish", { count: missing }) : optional ? mt("ovrOptionalImprovements", { count: optional }) : "",
      open: () => onNavigate(complete ? "kitchens" : "listing-review", kitchen.id) };
  });
  const listingBadge = (item: typeof listings[number]) => item.listed ? <span className={badge.positive}><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />{mt("listingStatusLiveLabel")}</span>
    : <span className={item.unavailable ? badge.attention : badge.neutral}>{mt(item.unavailable ? "ovrUnavailable" : "listingStatusDraftLabel")}</span>;
  const chipClass = cn("inline-flex min-h-10 max-w-full items-center gap-2.5 rounded-lg bg-white px-3 text-[13px] text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,.06)] ring-1 ring-inset ring-stone-200 transition-colors hover:ring-stone-300 motion-reduce:transition-none", focusRing);
  const listedCount = listings.filter(item => item.listed).length;
  const listingChip = !listings.length ? <button type="button" className={chipClass} onClick={() => onNavigate("kitchens")} data-testid="listing-chip">{mt("addYourKitchen")}<ChevronRight className="size-4 text-stone-400" aria-hidden="true" /></button>
    : listings.length === 1 ? <button type="button" className={chipClass} onClick={listings[0].open} data-testid="listing-chip">
      <span className="min-w-0 truncate font-semibold">{listings[0].kitchen.name}</span>{listingBadge(listings[0])}
      {listings[0].note && <><span aria-hidden="true" className="hidden h-4 w-px bg-stone-200 sm:block" /><span className="hidden whitespace-nowrap text-stone-600 sm:inline">{listings[0].note}</span></>}
      <ChevronRight className="hidden size-4 shrink-0 text-stone-400 sm:block" aria-hidden="true" /></button>
    : <Popover><PopoverTrigger asChild><button type="button" className={chipClass} data-testid="listing-chip">
        <span className="font-semibold">{mt("overviewKitchenCount", { count: listings.length })}</span>
        <span className="text-stone-600">{[listedCount ? mt("ovrListedCount", { count: listedCount }) : "", listings.length - listedCount ? mt("ovrNotListedCount", { count: listings.length - listedCount }) : ""].filter(Boolean).join(" · ")}</span>
        <ChevronDown className="size-4 shrink-0 text-stone-400" aria-hidden="true" /></button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border-stone-200 p-1.5" data-testid="listing-popover">
        <ul aria-label={mt("overviewListingStatus")}>{listings.map(item => <li key={item.kitchen.id}><button type="button" onClick={item.open} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-stone-50", focusRing)}>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-stone-900">{item.kitchen.name}</span>{item.note && <span className="block text-xs text-stone-500">{item.note}</span>}</span>
          {listingBadge(item)}<ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden="true" /></button></li>)}</ul>
      </PopoverContent></Popover>;

  /*
   * Desktop columns end together: Needs attention and Today keep their natural height, and Recent activity fills the gap
   * under whichever of them is shorter (whole rows only). Measured, because both lists change with the day's data.
   */
  useEffect(() => {
    const attention = attentionRef.current, todayNode = todayRef.current, list = activityListRef.current;
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Content height, not the box: a card stretched by the last row of its column must not decide where the feed goes.
      const natural = (node: Element | null) => Array.from(node?.firstElementChild?.children ?? []).reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
      if (attention && todayNode) setActivityUnderAttention(natural(attention) < natural(todayNode));
      // Rows pushed into the clipped second column are the ones not shown.
      const rows = list ? Array.from(list.children) as HTMLElement[] : [];
      setHiddenActivity(rows.filter(row => row.offsetLeft > rows[0].offsetLeft).length);
    };
    const observer = new ResizeObserver(measure);
    // The cards' own parts: a stretched card doesn't resize when its content grows.
    [...Array.from(attention?.firstElementChild?.children ?? []), ...Array.from(todayNode?.firstElementChild?.children ?? []), list].forEach(node => node && observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [hasActivity, recent.length, allActivity]);
  const switcher = locations.length > 1 && onSelectLocation && selectedLocation && <Select value={String(selectedLocation.id)} onValueChange={value => { const location = locations.find(item => String(item.id) === value); if (location) onSelectLocation(location); }}>
    <SelectTrigger className="h-10 w-full sm:w-64" aria-label={mt("ovrLocation")}><SelectValue /></SelectTrigger>
    <SelectContent>{locations.map(location => <SelectItem key={location.id} value={String(location.id)}>{location.name}</SelectItem>)}</SelectContent>
  </Select>;
  return <div className="space-y-4 sm:space-y-5">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0"><h1 className="text-[22px] font-[650] leading-7 tracking-[-0.02em] text-stone-900 sm:text-[26px] sm:leading-8">{longDate}</h1>
        {switcher ? <div className="mt-2">{switcher}</div> : <p className="mt-1 text-sm text-stone-600">{selectedLocation?.name ?? (locations.length > 1 ? mt("cmdAllLocations") : mt("overviewYourWorkspace"))}</p>}</div>
      {hasActivity && <div className="min-w-0 lg:pt-1">{listingChip}</div>}
    </header>
    {hasActivity ? <div className={cn("grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] xl:grid-rows-[auto_1fr]", activityUnderAttention
        ? "xl:[grid-template-areas:'attn_today'_'activity_today'_'week_week'_'pay_pay']" : "xl:[grid-template-areas:'attn_today'_'attn_activity'_'week_week'_'pay_pay']")}>
        {/* The feed takes whole rows; when even one row is more than the gap, the shorter column's card absorbs the rest. */}
        <div ref={attentionRef} className="min-w-0 xl:[grid-area:attn]">{attentionCard(false)}</div>
        <div ref={todayRef} className="min-w-0 xl:[grid-area:today]">{todayCard}</div>
        <div className="min-w-0 xl:[grid-area:week]"><BookingCalendarWidget events={calendarEvents} isLoading={isLoadingBookings} today={today} timezone={timezone} stats={weekStatsBlock} kitchens={locationKitchens} onNavigateToBookings={() => onNavigate("bookings")} /></div>
        {revenueVisible && <div className="min-w-0 xl:[grid-area:pay]">{revenueCard}</div>}
        {/* Zero height + min-height of the area: the feed fills the space the taller column leaves (at least three rows), never stretching it beyond that (unless opened in full). */}
        <div className={cn("min-w-0 xl:[grid-area:activity]", !allActivity && "xl:h-0 xl:min-h-[max(100%,260px)]")}>{activityCard}</div>
      </div>
      : <>
        <div className="grid gap-4 lg:grid-cols-2">{liveKitchens.length ? <>{attentionCard(true)}{listingCard}</> : <>{listingCard}{attentionCard(true)}</>}</div>
        {revenueVisible && revenueCard}
        <div className="grid gap-4 lg:grid-cols-2">{upcomingCard}{activityCard}</div>
      </>}
  </div>;
}
