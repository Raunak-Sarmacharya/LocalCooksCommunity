import { localCooksSupportHref } from "@/components/support/ContactLocalCooks";
import { ct } from '@/i18n/chef-ns';
import { KitchenPayoutStatus } from '@/components/booking/KitchenPayoutStatus';
import { bookingStatusLabel } from "@/components/booking/booking-status-label";
import { CancellationRefundReview } from '@/components/booking/CancellationRefundReview';
import BookingPreparation from "@/components/booking/BookingPreparation";
import { ChangeBookingDialog, KitchenBookingChanges } from '@/components/booking/KitchenBookingChanges';
import { BookingCancellationChooser } from '@/components/booking/BookingCancellationChooser';
import { BookingCancellationCard } from '@/components/booking/BookingCancellationCard';
import { KitchenCausedCancellation } from '@/components/booking/KitchenCausedCancellation';
import { BookingHistoryPanel } from '@/components/booking/BookingHistoryPanel';
import { BookingFeedbackCard } from '@/components/booking/BookingFeedbackCard';
import { CommitmentProblems } from '@/components/support/CommitmentProblems';
import { OpenProblemAlert } from '@/components/support/OpenProblemAlert';
import { ManagerDamageClaimEntry, claimFilingOpen } from '@/components/booking/ManagerDamageClaimEntry';
import { PartialAcceptanceCard } from '@/components/booking/PartialAcceptanceCard';
import { waitingPartialAcceptance, type PartialAcceptance } from '@shared/partial-acceptance';
import { BookingNowCard, ClampedBlock, NowClaimRows, chefCanPayClaim, closedClaimLine, closedClaims, nowClaims, type NowSecondaryLink } from '@/components/booking/BookingNowCard';
import { BookingVisitRecord, type VisitTimelineEvent } from '@/components/booking/BookingVisitRecord';
import { BookingReceipts, useBookingDocuments } from "@/components/booking/BookingReceipts";
import { BookingPaymentCard, paymentStatusSource } from '@/components/booking/BookingPaymentCard';
import { BookingDayList, currentBookingDays } from '@/components/booking/BookingDayList';
import { StorageRows, EquipmentRows } from '@/components/booking/BookingAddOns';
import { bookingNowContent, NOW_SECONDARY_VISIBLE } from '@/lib/booking-now';
import { formatBookedDuration } from '@/lib/booked-duration';
import { friendlyDate, friendlyDateTime } from '@/lib/friendly-date';
import { claimMoney, claimPayByDate, claimWhen, claimRequest, type DamageClaimCardData } from '@/lib/damage-claims';
import { claimBookingHeld } from '@shared/damage-claims';
import { canReportRunningLate } from '@shared/running-late';
import { cn } from '@/lib/utils';
import { bookingChangeSchedule, kitchenRescheduleCutoff } from '@shared/kitchen-booking-change';
import { EquipmentIcon as Wrench } from "@/components/ui/inventory-icons";
import { logger } from "@/lib/logger";
import { calendarDateForBookingTime, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { lazy, Suspense, useState, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatTime as formatKitchenClock } from "@/lib/formatters";
import { useLocation, useRoute } from "wouter";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import ManagerBookingLayout from "@/layouts/ManagerBookingLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatPhoneForDisplay, normalizePhoneNumber } from "@shared/phone-validation";
import { ArrowLeft, MapPin, FileText, Download, Loader2, CheckCircle2, XCircle, AlertCircle, Phone, Mail, Receipt, LogIn, LogOut, Camera, FileWarning, Clock, MoreHorizontal, MessageSquare, CalendarPlus, CalendarX, ClipboardCheck, LifeBuoy, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { changeRequestHref } from "@/lib/change-request";
import { arrivalRecorded, bookedMinutes, bookingHeaderPhase, canCancelOrChange, canMessage, contactVisible, initials, timeRange, type BookingHeaderPhase } from "@/lib/booking-header-state";
import { bookingCancelCause } from '@/lib/booking-cancel-cause';
import { bookingReference } from '@/lib/booking-reference';
import { bookingStartDateKey, calendarDateKey } from '@/lib/calendar-date';
import { bookingIcs, bookingDaysIcs, downloadBookingIcs } from "@/lib/booking-ics";
import { buildChefBookingReceiptBreakdown, buildKitchenPayoutStatementBreakdown } from "@shared/booking-pricing-breakdown";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { BookingActionDialog, type BookingForAction } from "@/components/manager/bookings/BookingActionDialog";
import { BookingManagementDialog, type BookingForManagement, type ManagementSubmitParams } from "@/components/manager/bookings/BookingManagementDialog";
import { BookingAttendancePanel } from "@/components/booking/BookingAttendancePanel";
import { RunningLateCard } from "@/components/booking/RunningLateCard";
import { SessionExtensionsCard, type ExtensionTool } from "@/components/booking/SessionExtensionsCard";
import type { RunningLateState } from "@shared/running-late";
import { VisitCodePanel, POLL_LEAD_MINUTES } from "@/components/manager/bookings/VisitCodePanel";
import { ManagerBookingDays } from '@/components/manager/bookings/ManagerBookingDays';
import { bookingResponseDeadline, formatResponseDeadline } from '@/lib/booking-response-deadline';
import { createBookingDateTime, friendlyTimezoneName } from '@shared/timezone-utils';
import { lateCheckoutOpen } from '@shared/clock-closeout';
import { StripeProcessingFeeRefundInfo } from "@/components/booking/StripeProcessingFeeRefundInfo";
import { ServiceFeeInfoPopover } from "@/components/booking/ServiceFeeInfoPopover";
import { SmartImage } from "@/components/ui/smart-image";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { ChefBookingReceiptBreakdown, KitchenPayoutStatementBreakdown } from "@/components/booking/BookingPricingBreakdown";
import { RefundRequestStatus, type FullRefundRequest } from "@/components/booking/RefundRequestStatus";

// The map preview is optional and heavy (Leaflet): loaded only when a kitchen has coordinates.
const LocationMap = lazy(() => import("@/components/ui/location-map"));

/** Media-query state; false where matchMedia is unavailable (tests, SSR). */
function useMedia(query: string) {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

interface BookingDetails {
  scheduleRevision?: number;
  dayMoney?: import('@shared/booking-day-money').BookingDayMoney[];
  /** Multi-day: the booking charge's equipment subtotal (its kitchen part is totalPrice). */
  chargeEquipmentCents?: number;
  cancellationPolicySnapshot?: import('@shared/cancellation-policy').CancellationPolicySnapshot | null;
  payout?: import('@shared/kitchen-payout').KitchenPayout;
  closeout?: import("@shared/clock-closeout").BookingCloseout;
  id: number;
  referenceCode?: string | null;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  selectedSlots?: Array<{ startTime: string; endTime: string }>;
  status: string;
  paymentStatus?: string;
  paymentDecision?: { state?: string; amount?: number; target?: string; actorId?: number | null; replacedBy?: { bookingId?: number; reference?: string } | null } | null;
  /** The kitchen accepted without some equipment; the chef answers the new total before anything is charged. */
  partialAcceptance?: PartialAcceptance | null;
  /** Kitchen view: whether accepting without some equipment may still ask the chef (false in the last 3 h). */
  partialAcceptanceAvailable?: boolean;
  cancellationPolicyHours?: number;
  cancellationRequestDeclinedAt?: string | null;
  specialNotes?: string;
  totalPrice?: number;
  hourlyRate?: number;
  /** Frozen at booking creation; shown so the chef knows the extra-time hourly rate. */
  extraTimeRateCents?: number | null;
  durationHours?: number;
  pricingMode?: "hourly" | "daily";
    serviceFee?: number;
    taxAmount?: number;
  /** Admin-configured service fee rate (fraction, e.g. 0.07) */
  platformCommissionRate?: number;
  currency?: string;
  createdAt: string;
  updatedAt?: string;
  paymentIntentId?: string;
  kitchenContact?: { email: string; phone: string | null } | null;
  kitchen?: {
    id: number;
    name: string;
    description?: string;
    photos?: string[];
    locationId: number;
    taxRatePercent?: number;
  };
  location?: {
    id: number;
    name: string;
    address?: string;
    arrivalInstructions?: string | null;
    departureInstructions?: string | null;
    /** Missing = released (older server). Instruction text is null before release. */
    instructionsReleased?: boolean;
    instructionsReleaseAt?: string;
    timezone?: string;
    cancellationPolicyHours?: number;
    /** Present when the server sends them; the chef's map preview needs both. */
    latitude?: number | null;
    longitude?: number | null;
  };
  arrivalMode?: 'staffed' | 'self' | 'mixed' | 'legacy';
  chef?: {
    id: number;
    username: string;
    fullName?: string;
    phone?: string;
  };
  storageBookings?: Array<{
    pricingModel?: string;
    id: number;
    storageListingId: number;
    startDate: string;
    endDate: string;
    totalPrice: number;
    status: string;
    paymentStatus?: string;
    storageListing?: {
      name: string;
      storageType: string;
      photos?: string[];
    };
  }>;
  equipmentBookings?: Array<{
    id: number;
    equipmentListingId: number;
    kitchenBookingVisitId?: number | null;
    totalPrice: number;
    status: string;
    paymentStatus?: string;
    equipmentListing?: {
      equipmentType: string;
      brand?: string;
      photos?: string[];
    };
  }>;
  paymentTransaction?: {
    id?: number;
    amount: number;
    serviceFee: number;
    taxAmount?: number;
    managerRevenue: number;
    kitchenShareCents?: number;
    status: string;
    stripeProcessingFee?: number;
    /** Pre-capture estimate from platform_settings (when stripeProcessingFee is 0) */
    estimatedStripeProcessingFee?: number;
    cardCountry?: string | null;
    cardFeeRate?: import('@shared/card-fee-estimate').CardFeeRate | null;
    estimatedManagerPayout?: number;
    paidAt?: string;
    refundAmount?: number;
    /** Part of refundAmount that Local Cooks sent as goodwill; the kitchen payout is unchanged by it. */
    goodwillRefundCents?: number;
    netAmount?: number;
    refundedAt?: string;
    refundReason?: string;
    metadata?: { fullRefundRequest?: FullRefundRequest } | null;
  };
  // ── Kitchen Check-In / Check-Out Lifecycle ──────────────────────────────
  checkinStatus?: string | null;
  checkedInAt?: string | null;
  checkedInMethod?: string | null;
  checkoutRequestedAt?: string | null;
  checkedOutAt?: string | null;
  checkoutApprovedAt?: string | null;
  noShowDetectedAt?: string | null;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  checkinPhotoUrls?: string[] | null;
  checkoutPhotoUrls?: string[] | null;
  checkinNotes?: string | null;
  checkoutNotes?: string | null;
  checkoutManagerMessage?: string | null;
  checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }> | null;
  checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }> | null;
  checkinEnabled?: boolean;
  checkoutEnabled?: boolean;
  checkinWindowMinutesBefore?: number;
  noShowGraceMinutes?: number;
  /** Extra time, changes and claim payments (their own payment rows). `kitchenShareCents` only in the manager view. */
  additionalCharges?: Array<{ id: number; kind: 'extension' | 'extra_time' | 'damage_claim' | 'kitchen_change'; minutes: number | null; amountCents: number;
    kitchenShareCents?: number; refundedCents: number; paidAt: string | null; status: string;
    subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; cardFeeCents?: number; refundShareCents?: number }>;
  /** The chef's latest "running late" heads-up to the kitchen. */
  runningLate?: RunningLateState | null;
  visits?: Array<{ id: number; updatedAt: string; blockIndex: number; startTime: string; endTime: string; checkinStatus: string; checkedInAt: string | null; checkoutRequestedAt: string | null; checkedOutAt: string | null; checkoutApprovedAt: string | null; noShowDetectedAt: string | null; checkoutManagerMessage?: string | null; visitDate?: string | null; scheduleRevision?: number | null; scheduleState?: string | null; pricingMode?: string | null; operatingWindowStartTime?: string | null; priceSnapshot?: { kitchenCents?: number; equipment?: Array<{ cents: number }> } | null; closeout?: { scheduledStartAt?: string; scheduledEndAt?: string } }>;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
    }
  } catch (error) {
    logger.error("Error getting Firebase token:", error);
  }
  return {
    "Content-Type": "application/json",
  };
}

export default function BookingDetailsPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/booking/:id");
  const [, managerParams] = useRoute("/manager/booking/:id");
  const bookingId = params?.id || managerParams?.id;
  const isManagerView = !!managerParams?.id;
  const { t: tStrict, i18n } = useTranslation("chef");
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;

  const { loading: authLoading } = useFirebaseAuth();
  const { toast } = useToast();

  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  // Issued receipts / remittances / statement (WP-R). Unavailable until migration 0086: the legacy download stays.
  const documentsQuery = useBookingDocuments(booking?.id, isManagerView ? 'manager' : 'chef',
    !!booking && booking.paymentDecision?.state !== 'pending' && ['paid', 'partially_refunded', 'refunded'].includes(booking.paymentStatus || ''));
  const bookingDocuments = documentsQuery.data?.available ? documentsQuery.data : null;
  const [openingConversation, setOpeningConversation] = useState(false);
  const openBookingConversation = async () => {
    if (!booking || openingConversation) return;
    setOpeningConversation(true);
    try {
      const response = await fetch(`/api/bookings/${booking.id}/conversation`, { method: 'POST', headers: await getAuthHeaders(), credentials: 'include' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || t('detailsCopy00'));
      navigate(result.path);
    } catch (error) {
      toast({ title: t('detailsCopy01'), description: error instanceof Error ? error.message : t('detailsCopy02'), variant: 'destructive' });
    } finally { setOpeningConversation(false); }
  };
  // "Message {chef}" in the no-check-in alert and running-late notice opens the conversation straight away.
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (!isManagerView || !booking || openedFromLink.current || !canMessage(booking.status) || new URLSearchParams(window.location.search).get('action') !== 'message') return;
    openedFromLink.current = true;
    void openBookingConversation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagerView, booking]);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [cancellationRefundScope, setCancellationRefundScope] = useState<{ kind: 'storage' | 'equipment'; id: number } | undefined>();
  const [cancellationRefundOpen, setCancellationRefundOpen] = useState(false);
  const [managementDialogOpen, setManagementDialogOpen] = useState(false);
  const [isManagementProcessing, setIsManagementProcessing] = useState(false);
  const [itemCancellationPending, setItemCancellationPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  // Bumped after a change request is sent so the pending-change panel refetches at once.
  const [changesVersion, setChangesVersion] = useState(0);
  const [kitchenCancelOpen, setKitchenCancelOpen] = useState(false);
  const { t: policyT } = useTranslation('booking');
  const bt = policyT as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [fixOpen, setFixOpen] = useState(false);
  // "Record when they left" opens Fix the visit record straight on the departure choice.
  const [fixAction, setFixAction] = useState<'departure' | 'report_attended' | 'report_no_show' | undefined>();
  // Each "I was there" tap opens the booking's problem report, framed for a disputed no-show.
  const [iWasThereOpen, setIWasThereOpen] = useState(0);
  const [lateOpen, setLateOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [extTools, setExtTools] = useState<ExtensionTool[]>([]);
  const [extTool, setExtTool] = useState<ExtensionTool | null>(null);
  const [payingClaimId, setPayingClaimId] = useState<number | null>(null);
  // The primary sits in the sticky bar below 640 px and in the card above it, never both (one in the document).
  const narrow = useMedia("(max-width: 639px)");
  const wide = useMedia("(min-width: 1024px)");
  const queryClient = useQueryClient();

  // When the chef clicks a sidebar tab from this booking-detail sub-page, we
  // REPLACE the current /booking/:id history entry with the dashboard view
  // instead of pushing a new one. That way the back button doesn't bounce
  // them through the booking detail again — it goes straight to wherever
  // they came from before opening this page.
  const handleViewChange = (view: string) => {
    navigate(`/dashboard?view=${view}`, { replace: true });
  };

  useEffect(() => {
    if (!bookingId) {
      setError(t('detailsCopy03'));
      setIsLoading(false);
      return;
    }

    // Wait for Firebase auth to finish initializing before fetching.
    // On a hard refresh, auth.currentUser is null until Firebase restores the
    // session asynchronously. Fetching immediately would send an unauthenticated
    // request (401), which the server correctly rejects — but the UI was
    // incorrectly showing "Booking Not Found" instead of waiting for auth.
    if (authLoading) {
      return; // auth not ready yet — effect will re-run when authLoading becomes false
    }

    let cancelled = false;

    const fetchBookingDetails = async () => {
      try {
        const headers = await getAuthHeaders();
        const endpoint = isManagerView
          ? `/api/manager/bookings/${bookingId}/details`
          : `/api/chef/bookings/${bookingId}/details`;

        const response = await fetch(endpoint, {
          credentials: "include",
          headers,
          // Same as reloadBookingDetails: never reuse a cached waiting payload after the chef answered.
          cache: "no-store",
        });

        if (!response.ok) {
          // A manager who opened a chef link (e.g. a shared URL) belongs on the manager page for this booking.
          if (!isManagerView && (response.status === 403 || response.status === 404)) {
            const asManager = await fetch(`/api/manager/bookings/${bookingId}/details`, { credentials: "include", headers, cache: "no-store" }).catch(() => null);
            if (asManager?.ok) {
              if (!cancelled) navigate(`/manager/booking/${bookingId}`, { replace: true });
              return;
            }
          }
          if (response.status === 401) {
            throw new Error(t("bdErrSessionExpired"));
          }
          if (response.status === 404) {
            throw new Error(t("bdErrNotFound"));
          }
          if (response.status === 403) {
            throw new Error(t("bdErrForbidden"));
          }
          throw new Error(t("bdErrFetch"));
        }

        const data = await response.json();
        if (!cancelled) setBooking(data);
      } catch (err) {
        if (cancelled) return;
        logger.error("Error fetching booking details:", err);
        setError(err instanceof Error ? err.message : t("bdErrLoad"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchBookingDetails();
    // Refresh decisions made in another tab when returning to the booking.
    const refreshOnFocus = () => { void fetchBookingDetails(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [bookingId, isManagerView, authLoading]);

  const reloadBookingDetails = async () => {
    if (!bookingId) return;
    try {
      const headers = await getAuthHeaders();
      const endpoint = isManagerView
        ? `/api/manager/bookings/${bookingId}/details`
        : `/api/chef/bookings/${bookingId}/details`;
      // no-store: after accept/decline the previous waiting payload must not be reused from the browser cache.
      const response = await fetch(endpoint, { credentials: "include", headers, cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setBooking(data);
    } catch (err) {
      logger.error("Error reloading booking details:", err);
    }
  };

  const reviewEquipmentCancellation = async (id: number, accept: boolean) => {
    if (!booking || !isManagerView) return;
    // Accepting moves money, so it goes through the add-on's own refund quote (the server refuses the bare status change).
    if (accept) { setCancellationRefundScope({ kind: 'equipment', id }); setCancellationRefundOpen(true); return; }
    setItemCancellationPending(true);
    try {
      const response = await fetch(`/api/manager/bookings/${booking.id}/status`, {
        method: 'PUT', credentials: 'include', headers: await getAuthHeaders(),
        body: JSON.stringify({ status: 'confirmed', equipmentActions: [{ equipmentBookingId: id, action: accept ? 'cancelled' : 'confirmed' }] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('detailsCopy04'));
      await reloadBookingDetails();
    } catch (error) { toast({ title: t('crManagerReviewRequired'), description: error instanceof Error ? error.message : t('detailsCopy05'), variant: 'destructive' }); }
    finally { setItemCancellationPending(false); }
  };

  const handleDownloadInvoice = async () => {
    if (!booking?.id) return;
    if (bookingDocuments) { document.getElementById('booking-payment-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }

    setIsDownloading(true);
    try {
      const headers = await getAuthHeaders();
      // Use different endpoints for chef vs manager
      const endpoint = isManagerView
        ? `/api/manager/revenue/invoices/${booking.id}`
        : `/api/bookings/${booking.id}/invoice`;
      
      const response = await fetch(endpoint, {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error(tt("failedToGenerateInvoice"));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;

      const bookingDate = booking.bookingDate
        ? calendarDateKey(booking.bookingDate) ?? "unknown"
        : "unknown";
      a.download = isManagerView
        ? `LocalCooks-Payout-Statement-${booking.id}-${bookingDate}.pdf`
        : `LocalCooks-Booking-Receipt-${booking.id}-${bookingDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t("bdInvoiceDownloadedTitle"),
        description: t("bdInvoiceDownloadedDesc"),
      });
    } catch (err) {
      logger.error("Error downloading invoice:", err);
      toast({
        title: t("bdDownloadFailedTitle"),
        description: err instanceof Error ? err.message : t("bdDownloadFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timeStr: string) => formatKitchenClock(timeStr, i18n.language);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}/.test(dateStr) ? `${dateStr.slice(0, 10)}T12:00:00Z` : dateStr);
    return date.toLocaleDateString(i18n.language, {
      timeZone: booking?.location?.timezone || undefined,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // "Oct 15" / "Oct 15 at 8:00 p.m."; the year only when it isn't this year (the when-line already names the zone).
  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00Z` : dateStr);
    return friendlyDate(date, i18n.language, booking?.location?.timezone || undefined);
  };

  const formatEventTimestamp = (dateStr: string) => friendlyDateTime(dateStr, i18n.language, booking?.location?.timezone || undefined);

  const formatCurrency = (cents: number | undefined | null) => {
    if (cents === undefined || cents === null) return "$0.00";
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatBookingTimeSlots = (): string[] => {
    if (!booking) return [];
    const rawSlots = booking.selectedSlots;

    if (!rawSlots || rawSlots.length === 0) {
      return [timeRange(formatTime(booking.startTime), formatTime(booking.endTime))];
    }

    const slotOrder = sortTimesInOperatingWindow(rawSlots.map(slot => slot.startTime),
      booking.operatingWindowStartTime || booking.startTime);
    const sorted = slotOrder.map(time => rawSlots.find(slot => slot.startTime === time)!);

    let isContiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].endTime !== sorted[i].startTime) {
        isContiguous = false;
        break;
      }
    }

    if (isContiguous) {
      return [timeRange(formatTime(booking.startTime), formatTime(booking.endTime))];
    }

    return sorted.map((s) => timeRange(formatTime(s.startTime), formatTime(s.endTime)));
  };

  const formatContactPhone = (phone: string) => {
    const formatted = formatPhoneForDisplay(phone);
    return normalizePhoneNumber(phone)?.startsWith('+1') ? `+1 ${formatted}` : formatted;
  };
  const bookingTimeSlots = formatBookingTimeSlots();

  const getCheckinStatusBadge = (checkinStatus: string | null | undefined) => {
    if (!checkinStatus || checkinStatus === 'not_checked_in') {
      return (
        <InfoChip variant="outline" icon={<Clock className="h-3 w-3" />}>
          {t("bdCiNotCheckedIn")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checked_in') {
      return (
        <InfoChip variant="success" icon={<LogIn className="h-3 w-3" />}>
          {t("bdCiCheckedIn")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checkout_requested') {
      return (
        <InfoChip variant="info" icon={<Camera className="h-3 w-3" />}>
          {t("bdCiCheckoutPending")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checked_out') {
      return (
        <InfoChip variant="success" icon={<LogOut className="h-3 w-3" />}>
          {t("bdCiCheckedOut")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'no_show') {
      return (
        <InfoChip variant="destructive" icon={<XCircle className="h-3 w-3" />}>
          {t("bdCiNoShow")}
        </InfoChip>
      );
    }
    if (checkinStatus === 'checkout_claim_filed') {
      return (
        <InfoChip variant="warning" icon={<FileWarning className="h-3 w-3" />}>
          {t("bdCiClaimFiled")}
        </InfoChip>
      );
    }
    return null;
  };

  const responseDeadline = booking ? bookingResponseDeadline(booking) : null;
  const responseDeadlineText = responseDeadline ? friendlyDateTime(responseDeadline, i18n.language, booking?.location?.timezone || undefined) : null;
  // The kitchen accepted without some equipment; the chef still has to answer the new total (nothing charged yet).
  const proposal = booking ? waitingPartialAcceptance(booking) : null;

  const paymentMessage = (() => {
    if (!booking) return null;
    if (booking.paymentDecision?.state === 'pending') return { summary: t('bdPaymentRecovery'), detail: t('bdPaymentRecovery') };
    const status = booking.paymentStatus;
    const captured = ['paid', 'partially_refunded', 'refunded'].includes(status || '');
    const ended = ['cancelled', 'rejected', 'expired', 'declined'].includes(booking.status);
    if (!isManagerView && !captured && ended) return { summary: t('bnHoldReleased'), detail: t('bdAuthVoidedChef') };
    if (!isManagerView && !captured && booking.status === 'pending')
      return proposal
        ? { summary: t('paChargedIfYouAccept', { amount: formatCurrency(proposal.newTotalCents) }), detail: t('bdPaymentHeldChef') }
        : { summary: t('bnChargedOnlyIfAccepts', { kitchen: booking.kitchen?.name || t('bdKitchenBookingFallback') }), detail: t('bdPaymentHeldChef') };
    // While the chef answers a new total, the kitchen's payout is unknown — never show the original hold's estimate.
    if (isManagerView && proposal) return { summary: t('paPayoutDependsOnChef'), detail: t('paPayoutDependsOnChef') };
    if (status === 'authorized') return { summary: isManagerView ? t('bdPaymentHeldSummaryManager') : t('bdPaymentHeldSummary', { defaultValue: 'Your payment is on hold.' }), detail: t(isManagerView ? 'bdPaymentHeldManager' : 'bdPaymentHeldChef') };
    if (status === 'failed' && booking.status === 'cancelled') return { summary: isManagerView ? t('bdAuthVoidedSummaryManager') : t('bdAuthVoidedSummary', { defaultValue: 'Your payment hold was released.' }), detail: t(isManagerView ? 'bdAuthVoidedManager' : 'bdAuthVoidedChef') };
    const refundedCents = (booking.paymentTransaction?.refundAmount || 0)
      + (booking.additionalCharges || []).reduce((sum, line) => sum + line.refundedCents, 0);
    const goodwill = booking.paymentTransaction?.goodwillRefundCents || 0;
    if (goodwill > 0 && (status === 'refunded' || status === 'partially_refunded')) {
      const total = Math.max(refundedCents, goodwill);
      const other = total - goodwill;
      const chefLabel = booking.chef?.fullName || booking.chef?.username || t('bdhChefFallback');
      return isManagerView ? {
        // Visible on the card itself (the detail sits in a popover): the payout does not change.
        summary: t('bdGoodwillManager', { chef: chefLabel, amount: formatCurrency(goodwill) }),
        detail: other > 0 ? t('bdRefundedToChef', { amount: formatCurrency(other) }) : t('bdGoodwillManagerDetail'),
      } : {
        summary: t('bdRefundedTotal', { amount: formatCurrency(total) }),
        detail: other > 0 ? t('bdRefundedYou', { amount: formatCurrency(total) }) : t('bdGoodwillChef', { amount: formatCurrency(goodwill) }),
      };
    }
    if (status === 'refunded' || status === 'partially_refunded' || refundedCents > 0) return {
      // The kitchen didn't pay: it reads what happened to the chef's payment, never "your payment".
      // With a second payment (a paid change, extra time), say what the refund is out of: every charge, not the first one only.
      summary: refundedCents > 0 && booking.additionalCharges?.length ? t('bnRefundedOf', { amount: formatCurrency(refundedCents),
          total: formatCurrency((booking.paymentTransaction?.amount || 0) + booking.additionalCharges.reduce((sum, line) => sum + line.amountCents, 0)) })
        : refundedCents > 0 ? t('bnChargeRefunded', { amount: formatCurrency(refundedCents) })
        : status === 'refunded' ? t('bdRefundedSummary', { defaultValue: 'Your payment was refunded.' }) : t('bdPartialRefundSummary', { defaultValue: 'Part of your payment was refunded.' }),
      detail: `${refundedCents ? t(isManagerView ? 'bdRefundedToChef' : 'bdRefundedYou', { amount: formatCurrency(refundedCents) }) : t('bdRefundAmountUnavailable', { defaultValue: 'The refund amount is not yet available.' })}${booking.paymentTransaction?.refundedAt ? ` ${t('bdRefundedOn', { date: formatShortDate(booking.paymentTransaction.refundedAt) })}` : ''}${booking.paymentTransaction?.refundReason && isManagerView ? ` ${t('bdRefundReason', { reason: booking.paymentTransaction.refundReason })}` : ''}`,
    };
    if (status === 'paid' && booking.status === 'cancelled') return { summary: t('bdCancelledPaidSummary', { defaultValue: 'Your booking was cancelled after payment.' }), detail: t(isManagerView ? 'bdBookingCancelledManager' : 'bdBookingCancelledChef') };
    // Payout after closeout: the chef has paid, but the kitchen's share is not the kitchen's money until it is sent.
    if (status === 'paid' && isManagerView && booking.payout?.timing === 'after_closeout' && booking.payout.status !== 'sent')
      return { summary: t('bdPaidSummaryManagerHeld'), detail: t('bdPaidDetailManagerHeld') };
    if (status === 'paid') return { summary: isManagerView ? t('bdPaidSummaryManager') : t('bdPaidSummary', { defaultValue: 'Your payment was collected.' }), detail: t('bdPaymentCapturedInfo', { defaultValue: 'Your payment has been captured for this booking.' }) };
    if (status === 'processing') return { summary: t('bdProcessingSummary', { defaultValue: 'Your payment is processing.' }), detail: t('bdPaymentProcessingInfo', { defaultValue: 'Your payment is being processed. This page will show the final status once it is available.' }) };
    if (status === 'pending') return { summary: t('bdPendingSummary', { defaultValue: 'Your payment is pending.' }), detail: t('bdPaymentPendingInfo', { defaultValue: 'Payment has not been completed yet.' }) };
    if (status === 'failed') return { summary: t('bdPaymentFailedInfo', { defaultValue: 'Payment failed.' }), detail: t('bdPaymentFailedDetail', { defaultValue: 'The payment could not be completed. Contact Local Cooks if you need help.' }) };
    if (status === 'canceled') return { summary: t('bdCanceledSummary', { defaultValue: 'Your payment was canceled.' }), detail: t('bdPaymentCanceledInfo', { defaultValue: 'The payment was canceled before it was completed.' }) };
    return { summary: t('bdUnknownPaymentSummary', { defaultValue: 'Payment status is unavailable.' }), detail: t('bdUnknownPaymentDetail', { defaultValue: 'Contact Local Cooks if you need help with this payment.' }) };
  })();

  // The real start–end span of every visit, so an early start or extension always shows (never a stale stored count).
  const calculateMinutes = () => booking ? bookedMinutes({ closeoutVisits: booking.closeout?.visits, visits: booking.visits,
    startTime: booking.startTime, endTime: booking.endTime, durationHours: booking.durationHours }) : 0;

  // ── Payment state helpers ─────────────────────────────────────────────────
  // VOID = auth was cancelled before capture (paymentStatus='failed') — never charged
  // REFUND = payment was captured then refunded (paymentStatus='refunded') — money returned
  const isRefunded = booking?.paymentStatus === 'refunded';
  const isPartiallyRefunded = booking?.paymentStatus === 'partially_refunded';
  const hasRefund = isRefunded || isPartiallyRefunded;
  const refundAmount = booking?.paymentTransaction?.refundAmount || 0;
  const goodwillRefund = booking?.paymentTransaction?.goodwillRefundCents || 0;

  // Helper: item was voided (never charged — exclude from totals)
  const isItemVoided = (item: { paymentStatus?: string; status: string }) =>
    item.paymentStatus === 'failed';

  // Helper: item was refunded (was charged, then money returned — include in totals, show as refunded)
  const isItemRefunded = (item: { paymentStatus?: string; status: string }) =>
    item.paymentStatus === 'refunded' && item.status === 'cancelled';
  // Multi-day: an approved change replaces the old days and their equipment rows; those rows are history, not money or add-ons.
  const isReplacedEquipment = (item: { kitchenBookingVisitId?: number | null }) => !!booking?.scheduleRevision && !!item.kitchenBookingVisitId
    && !booking.visits?.some(visit => visit.id === item.kitchenBookingVisitId && visit.scheduleRevision === booking.scheduleRevision);

  const totals = useMemo(() => {
    if (!booking) return { kitchen: 0, storage: 0, equipment: 0, subtotal: 0, tax: 0, total: 0 };

    const kitchenTotal = booking.totalPrice || 0;
    // VOID AWARENESS: Only exclude items with paymentStatus='failed' (never charged).
    // REFUND AWARENESS: Items with paymentStatus='refunded' WERE charged — include them
    // in the "Amount Charged" calculation. Refund is shown separately below.
    const storageTotal = booking.storageBookings?.reduce((sum, s) => {
      if (s.paymentStatus === 'failed') return sum; // Voided — never charged
      return sum + (s.totalPrice || 0);
    }, 0) || 0;
    const equipmentTotal = booking.chargeEquipmentCents ?? (booking.equipmentBookings?.reduce((sum, e) => {
      if (e.paymentStatus === 'failed' || isReplacedEquipment(e)) return sum; // Voided — never charged; replaced by a change
      return sum + (e.totalPrice || 0);
    }, 0) || 0);

    // Subtotal is kitchen + non-voided storage + non-voided equipment (what was actually charged)
    const subtotal = kitchenTotal + storageTotal + equipmentTotal;

    return {
      kitchen: kitchenTotal,
      storage: storageTotal,
      equipment: equipmentTotal,
      subtotal: subtotal,
      serviceFee: booking.serviceFee || 0,
      total: subtotal,
    };
  }, [booking]);

  const pricingBreakdownInput = useMemo(() => {
    if (!booking) return null;
    const subtotal = totals.subtotal || 0;
    const serviceFee = totals.serviceFee || booking.paymentTransaction?.serviceFee || 0;
    // The API returns the historical rate from the recorded financial split.
    const platformFeeRate =
      booking.platformCommissionRate != null
        ? Number(booking.platformCommissionRate)
        : subtotal > 0 && serviceFee > 0
          ? serviceFee / subtotal
          : 0;
    const actualStripe = booking.paymentTransaction?.stripeProcessingFee || 0;
    const estimatedStripe = booking.paymentTransaction?.estimatedStripeProcessingFee || 0;
    const isAuthorizedHold = booking.paymentStatus === "authorized";
    const stripeFee =
      actualStripe > 0
        ? actualStripe
        : isAuthorizedHold
          ? estimatedStripe
          : 0;
    const feesAreEstimated = isAuthorizedHold && actualStripe <= 0 && stripeFee > 0;
    // The kitchen's statement subtracts only what refunds took from its share (the chef's refund also returns the service and card fees).
    const txn = booking.paymentTransaction;
    const kitchenRefundShare = isManagerView && txn?.kitchenShareCents != null && actualStripe > 0
      ? Math.max(0, (txn.amount || 0) - (txn.serviceFee || 0) - actualStripe - txn.kitchenShareCents) : null;

    return {
      kitchenBaseSubtotalCents: subtotal,
      kitchenHstRatePercent: Number(booking.kitchen?.taxRatePercent) || 0,
      kitchenHstAmountCents: booking.paymentTransaction?.taxAmount,
      platformFeeRate,
      platformFeeAmountCents: serviceFee,
      paymentProcessorFeeCents: stripeFee,
      // Pre-capture manager_revenue is still kitchen gross — force estimate path.
      kitchenNetPayoutCents: feesAreEstimated
        ? null
        : booking.paymentTransaction?.managerRevenue,
      chargeAmountCents: booking.paymentTransaction?.amount,
      // Local Cooks goodwill never reduces the kitchen's payout.
      refundAmountCents: kitchenRefundShare ?? Math.max(0, (booking.paymentTransaction?.refundAmount || 0) - (isManagerView ? goodwillRefund : 0)),
      hourlyRateCents: booking.hourlyRate,
      bookedHours: booking.durationHours,
      showPaymentProcessorFee: stripeFee > 0,
      paymentProcessorFeeIsEstimate: feesAreEstimated,
      showPlatformFeeLine: serviceFee > 0,
    };
  }, [booking, totals]);

  // Show ALL storage/equipment bookings including rejected ones for full audit trail
  const allStorageBookings = booking?.storageBookings || [];
  const allEquipmentBookings = (booking?.equipmentBookings || []).filter(item => !isReplacedEquipment(item));

  // Original totals including ALL items (for showing what was originally booked)
  const allStorageTotal = allStorageBookings.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const allEquipmentTotal = allEquipmentBookings.reduce((sum, e) => sum + (e.totalPrice || 0), 0);
  // Voided totals (never charged) for sidebar strikethrough — only voided items, not refunded
  const rejectedStorageTotal = allStorageBookings.filter(isItemVoided).reduce((sum, s) => sum + (s.totalPrice || 0), 0);
  const rejectedEquipmentTotal = allEquipmentBookings.filter(isItemVoided).reduce((sum, e) => sum + (e.totalPrice || 0), 0);

  const openActionDialog = () => {
    setActionDialogOpen(true);
  };

  const openManagementDialog = () => {
    setManagementDialogOpen(true);
  };

  const bookingForAction: BookingForAction | null = booking ? {
    scheduleRevision: booking.scheduleRevision,
    visits: booking.visits,
    id: booking.id,
    kitchenName: booking.kitchen?.name,
    chefName: booking.chef?.fullName || booking.chef?.username,
    locationName: booking.location?.name,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    selectedSlots: booking.selectedSlots,
    operatingWindowStartTime: booking.operatingWindowStartTime,
    totalPrice: booking.totalPrice,
    pricingMode: booking.pricingMode,
    transactionAmount: booking.paymentTransaction?.amount,
    cardFeeRate: booking.paymentTransaction?.cardFeeRate,
    estimatedCardFeeCents: booking.paymentTransaction?.estimatedStripeProcessingFee,
    serviceFee: totals.serviceFee || booking.paymentTransaction?.serviceFee || 0,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    // Include ALL items with rejected flag so action dialog shows full audit trail
    // Rejected items appear as read-only, actionable items are toggleable
    storageItems: booking.storageBookings
      ?.map((s) => ({
        id: s.id,
        storageBookingId: s.id,
        name: s.storageListing?.name || `Storage #${s.storageListingId}`,
        storageType: s.storageListing?.storageType || 'Storage',
        totalPrice: s.totalPrice,
        startDate: s.startDate,
        endDate: s.endDate,
        rejected: s.paymentStatus === 'failed' || s.status === 'cancelled',
      })),
    equipmentItems: booking.equipmentBookings
      ?.map((e) => ({
        id: e.id,
        equipmentBookingId: e.id,
        name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
        totalPrice: e.totalPrice,
        rejected: e.paymentStatus === 'failed' || e.status === 'cancelled',
        visitDate: (e as { visitDate?: string | null }).visitDate ?? null,
      })),
    paymentStatus: booking.paymentStatus,
    canAskChef: booking.partialAcceptanceAvailable !== false,
  } : null;

  const handleApprovalSubmit = async (params: {
    bookingId: number;
    status: 'confirmed' | 'cancelled';
    storageActions?: Array<{ storageBookingId: number; action: string }>;
    equipmentActions?: Array<{ equipmentBookingId: number; action: string }>;
    message?: string;
  }) => {
    if (!booking?.id) return;

    setIsUpdatingStatus(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/bookings/${booking.id}/status`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({
          status: params.status,
          storageActions: params.storageActions,
          equipmentActions: params.equipmentActions,
          message: params.message,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update booking`);
      }

      const responseData = await response.json().catch(() => ({}));

      // Accepted without some equipment: the request waits for the chef's answer; nothing was charged.
      if (responseData.proposal) {
        queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
        toast({ title: t('paSentTitle'), description: t('paSentBody') });
        await reloadBookingDetails();
        setIsUpdatingStatus(false);
        setActionDialogOpen(false);
        return;
      }

      // Determine updated paymentStatus based on server response
      // - Voided auth (rejected authorized booking): paymentStatus → 'failed'
      // - Approved authorized booking: paymentStatus → 'paid'
      // - Rejected paid booking with refund: paymentStatus → 'refunded' or 'partially_refunded'
      // - Cancelled confirmed booking: paymentStatus unchanged ('paid')
      const hadRefund = !!responseData.refund;
      let updatedPaymentStatus = booking.paymentStatus;
      if (responseData.authorizationVoided) {
        updatedPaymentStatus = 'failed';
      } else if (params.status === 'confirmed' && booking.paymentStatus === 'authorized') {
        updatedPaymentStatus = 'paid';
      } else if (hadRefund && params.status === 'cancelled') {
        updatedPaymentStatus = 'refunded';
      }

      // For refund scenarios (post-capture rejection), reload to get accurate data from server
      // because the refund engine updates payment_transactions, paymentStatus, and item statuses
      // and local patching would be incomplete (refund amounts, item paymentStatus='refunded', etc.)
      if (hadRefund) {
        queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
        toast({
          title: t("bdBookingRejectedRefundedTitle"),
          description: t("bdRefundProcessedDesc", { amount: `$${(responseData.refund.amount / 100).toFixed(2)}` }),
        });
        window.location.reload();
        return;
      }

      // Capture + Connect transfer update payment_transactions asynchronously.
      // Never keep the pre-capture paymentTransaction on the client — that shows
      // kitchen gross (subtotal+tax) as "Your payout" instead of the transfer net.
      if (
        params.status === "confirmed" &&
        (booking.paymentStatus === "authorized" || updatedPaymentStatus === "paid")
      ) {
        queryClient.invalidateQueries({ queryKey: ["managerBookings"] });
        toast({
          title: t("bdSuccessTitle"),
          description: t("bdBookingConfirmedDesc"),
        });
        await reloadBookingDetails();
        // Transfer may land slightly after capture; one short follow-up refresh.
        window.setTimeout(() => {
          void reloadBookingDetails();
        }, 2500);
        setIsUpdatingStatus(false);
        setActionDialogOpen(false);
        return;
      }

      // For non-refund scenarios (void or simple status change), update local state directly
      // Cancelled items have paymentStatus='failed' (voided — never charged)
      const updatedStorageBookings = booking.storageBookings?.map((sb) => {
        const action = params.storageActions?.find((a) => a.storageBookingId === sb.id);
        if (action) {
          return { ...sb, status: action.action, paymentStatus: action.action === 'cancelled' ? 'failed' : 'paid' };
        }
        return { ...sb, status: params.status };
      });
      const updatedEquipmentBookings = booking.equipmentBookings?.map((eb) => {
        const action = params.equipmentActions?.find((a) => a.equipmentBookingId === eb.id);
        if (action) {
          return { ...eb, status: action.action, paymentStatus: action.action === 'cancelled' ? 'failed' : 'paid' };
        }
        return { ...eb, status: params.status };
      });
      setBooking({
        ...booking,
        status: params.status,
        paymentStatus: updatedPaymentStatus,
        storageBookings: updatedStorageBookings,
        equipmentBookings: updatedEquipmentBookings,
      });

      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });

      // Show contextual toast based on server response
      if (responseData.authorizationVoided) {
        toast({
          title: t("bdBookingRejectedToast"),
          description: t("bdHoldReleasedDesc"),
        });
      } else if (responseData.requiresManualRefund) {
        toast({
          title: t("bdBookingCancelledToast"),
          description: t("bdIssueRefundRevenueDesc"),
        });
      } else {
        toast({
          title: t("bdSuccessTitle"),
          description: params.status === 'confirmed' ? t("bdBookingConfirmedDesc") : t("bdBookingRejectedDesc"),
        });
      }
      // Success: close the dialog, then refetch so the page shows the server's decision.
      setIsUpdatingStatus(false);
      setActionDialogOpen(false);
      await reloadBookingDetails();
    } catch (err) {
      logger.error('Error updating booking:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : t('detailsCopy07'),
        variant: "destructive",
      });
    } finally {
      setIsUpdatingStatus(false);
      setActionDialogOpen(false);
    }
  };

  // ── Management Dialog data (for confirmed/paid bookings) ──────────────
  const bookingForManagement: BookingForManagement | null = booking ? {
    id: booking.id,
    kitchenName: booking.kitchen?.name,
    chefName: booking.chef?.fullName || booking.chef?.username,
    locationName: booking.location?.name,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    selectedSlots: booking.selectedSlots,
    operatingWindowStartTime: booking.operatingWindowStartTime,
    totalPrice: booking.totalPrice,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    transactionId: booking.paymentTransaction?.id,
    fullRefundRequest: booking.paymentTransaction?.metadata?.fullRefundRequest,
    transactionAmount: booking.paymentTransaction?.amount,
    stripeProcessingFee: booking.paymentTransaction?.stripeProcessingFee,
    managerRevenue: booking.paymentTransaction?.managerRevenue,
    serviceFee: booking.paymentTransaction?.serviceFee || booking.serviceFee || 0,
    taxRatePercent: booking.kitchen?.taxRatePercent ? Number(booking.kitchen.taxRatePercent) : undefined,
    managerRemainingBalance: Math.max(
      0,
      (booking.paymentTransaction?.managerRevenue || 0) -
        Math.max(0, (booking.paymentTransaction?.refundAmount || 0) - goodwillRefund),
    ),
    refundAmount: booking.paymentTransaction?.refundAmount || 0,
    cancellationRequested: booking.status === 'cancellation_requested',
    storageItems: booking.storageBookings?.map((s) => ({
      id: s.id,
      storageBookingId: s.id,
      name: s.storageListing?.name || `Storage #${s.storageListingId}`,
      storageType: s.storageListing?.storageType || 'Storage',
      totalPrice: s.totalPrice,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
      cancellationRequested: false, // detail endpoint doesn't expose this directly
    })),
    equipmentItems: booking.equipmentBookings?.map((e) => ({
      id: e.id,
      equipmentBookingId: e.id,
      name: e.equipmentListing?.equipmentType || `Equipment #${e.equipmentListingId}`,
      totalPrice: e.totalPrice,
      status: e.status,
    })),
  } : null;

  const handleManagementSubmit = async (params: ManagementSubmitParams) => {
    if (!booking?.id) return;
    setIsManagementProcessing(true);
    try {
      const headers = await getAuthHeaders();

      switch (params.action) {
        case "cancel-booking":
        case "cancel-booking-refund": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({
              status: 'cancelled',
              storageActions: params.storageActions,
              equipmentActions: params.equipmentActions,
            }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || t('detailsCopy08')); }
          if (params.action === "cancel-booking-refund" && bookingForManagement?.transactionId) {
            const requestRes = await fetch(`/api/manager/revenue/transactions/${bookingForManagement.transactionId}/full-refund-request`, {
              method: 'POST', headers, credentials: 'include',
              body: JSON.stringify({ reason: ct('sweepText33') }),
            });
            if (!requestRes.ok) { const d = await requestRes.json().catch(() => ({})); throw new Error(d.error || t('detailsCopy09')); }
          }
          toast({
            title: t("bdBookingCancelledToast"),
            description: params.action === "cancel-booking-refund" ? t('detailsCopy10') : t("bdBookingCancelledDesc"),
          });
          // Reload to get fresh payment status, refund amounts, and item statuses from server
          window.location.reload();
          break;
        }
        case "partial-cancel":
        case "partial-cancel-refund": {
          const statusRes = await fetch(`/api/manager/bookings/${params.bookingId}/status`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ status: 'confirmed', storageActions: params.storageActions, equipmentActions: params.equipmentActions }),
          });
          if (!statusRes.ok) { const d = await statusRes.json().catch(() => ({})); throw new Error(d.error || t('detailsCopy11')); }

          if (
            params.action === "partial-cancel-refund" &&
            params.refundAmountCents &&
            params.refundAmountCents > 0 &&
            bookingForManagement?.transactionId
          ) {
            // Kitchen-caused add-on cancellation: the server refunds the chef in full (card fee absorbed by Local Cooks).
            const refundRes = await fetch(`/api/manager/bookings/${params.bookingId}/addon-refund`, {
              method: 'POST', headers, credentials: "include",
              body: JSON.stringify({
                operationKey: `addon-${params.bookingId}-${crypto.randomUUID()}`,
                items: [
                  ...(params.storageActions || []).filter(entry => entry.action === 'cancelled').map(entry => ({ kind: 'storage', id: entry.storageBookingId })),
                  ...(params.equipmentActions || []).filter(entry => entry.action === 'cancelled').map(entry => ({ kind: 'equipment', id: entry.equipmentBookingId })),
                ],
              }),
            });
            const refundResult = await refundRes.json().catch(() => ({}));
            if (!refundRes.ok) throw new Error(refundResult.error || t('detailsCopy12'));
            toast({
              title: t("bdItemsCancelledToast"),
              description: t("bdRefundProcessedDesc", {
                amount: `$${((refundResult.amountCents ?? params.refundAmountCents) / 100).toFixed(2)}`,
              }),
            });
          } else {
            toast({ title: t("bdItemsCancelledToast"), description: t("bdItemsCancelledDesc") });
          }
          window.location.reload();
          break;
        }
        case "refund-only": {
          if (!bookingForManagement?.transactionId || !params.refundAmountCents) {
            throw new Error(t("bdRefundPanelInfo"));
          }
          const refundRes = await fetch(
            `/api/manager/revenue/transactions/${bookingForManagement.transactionId}/refund`,
            {
              method: 'POST', headers, credentials: "include",
              body: JSON.stringify({
                amount: params.refundAmountCents,
                reason: params.note || ct('sweepText35'),
              }),
            },
          );
          if (!refundRes.ok) {
            const d = await refundRes.json().catch(() => ({}));
            throw new Error(d.error || t('detailsCopy13'));
          }
          toast({
            title: t("bdRefundProcessedDesc", {
              amount: `$${(params.refundAmountCents / 100).toFixed(2)}`,
            }),
          });
          window.location.reload();
          break;
        }
        case "request-full-refund": {
          if (!bookingForManagement?.transactionId) throw new Error(t("bdRefundPanelInfo"));
          const requestRes = await fetch(`/api/manager/revenue/transactions/${bookingForManagement.transactionId}/full-refund-request`, {
            method: 'POST', headers, credentials: 'include',
            body: JSON.stringify({ reason: ct('sweepText36') }),
          });
          if (!requestRes.ok) {
            const d = await requestRes.json().catch(() => ({}));
            throw new Error(d.error || t('detailsCopy14'));
          }
          toast({ title: t('detailsCopy15'), description: t('detailsCopy16') });
          setBooking({ ...booking, paymentTransaction: booking.paymentTransaction ? { ...booking.paymentTransaction, metadata: { ...booking.paymentTransaction.metadata, fullRefundRequest: { status: 'pending' } } } : undefined });
          setManagementDialogOpen(false);
          break;
        }
        case "accept-cancellation": {
          setCancellationRefundScope(undefined); setCancellationRefundOpen(true);
          break;
        }
        case "decline-cancellation": {
          const res = await fetch(`/api/manager/bookings/${params.bookingId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || t('detailsCopy06')); }
          setBooking({ ...booking, status: 'confirmed' });
          toast({ title: mt("cancellationDeclined") });
          break;
        }
        case "accept-storage-cancel": {
          if (!params.storageCancellationId) throw new Error(tt("noStorageBookingId"));
          setCancellationRefundScope({ kind: 'storage', id: params.storageCancellationId }); setCancellationRefundOpen(true);
          break;
        }
        case "decline-storage-cancel": {
          if (!params.storageCancellationId) throw new Error(tt("noStorageBookingId"));
          const res = await fetch(`/api/manager/storage-bookings/${params.storageCancellationId}/cancellation-request`, {
            method: 'PUT', headers, credentials: "include",
            body: JSON.stringify({ action: 'decline' }),
          });
          if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || t('detailsCopy06')); }
          toast({ title: mt("storageCancellationDeclined") });
          break;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['managerBookings'] });
      setManagementDialogOpen(false);
    } catch (error: any) {
      toast({ title: t("bdErrorTitle"), description: error.message || t("bdSomethingWrong"), variant: "destructive" });
    } finally {
      setIsManagementProcessing(false);
    }
  };

  const handleBack = () => {
    // Use browser history so the user returns to wherever they came from
    // (bookings list, calendar view, manager panel, etc.) rather than always
    // hard-redirecting to the dashboard root.
    if (window.history.length > 1) {
      window.history.back();
    } else if (isManagerView) {
      navigate("/manager/dashboard");
    } else {
      navigate("/dashboard");
    }
  };

  // Loading content
  const loadingContent = (
    <div className="space-y-4 py-8" role="status" aria-label={t("bdLoading")}>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );

  // Error content
  const errorContent = (
    <div className="py-12">
      <div className="max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold mb-2">{t("bdNotFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground mb-6">{error || t("bdNotFoundBody")}</p>
        <Button onClick={handleBack} variant="outline" size="sm">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {t("bdGoBack")}
        </Button>
      </div>
    </div>
  );

  const cap = (value?: string | null) => value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
  const itemChip = (item: { id: number; status: string; paymentStatus?: string }, storage: boolean) => {
    const voided = isItemVoided(item), refunded = isItemRefunded(item);
    // Declined in a waiting new-total offer: the row stays pending until the chef answers.
    const declinedInOffer = !storage && !!proposal && (proposal.declined.some(d => d.id === item.id)
      || proposal.equipment.some(e => e.id === item.id && e.status === 'cancelled'));
    if (storage && item.status === 'completed') return <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>{cap(t('bdStatusCleared'))}</InfoChip>;
    if (refunded) return <InfoChip variant="warning" icon={<Receipt className="h-2.5 w-2.5" />}>{cap(t('bdStatusRefunded'))}</InfoChip>;
    if (declinedInOffer) return <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />} data-testid="pa-declined-item-chip">
      {t(isManagerView ? 'paItemKitchenDeciding' : 'paItemChefIfAccept')}</InfoChip>;
    // After the chef accepts, declined equipment is voided: chef keeps "Not charged"; kitchen says "Not included".
    if (voided) return <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>{cap(t(isManagerView ? 'paItemNotIncluded' : 'bdStatusNotCharged'))}</InfoChip>;
    if (item.status === 'cancelled') return <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>{cap(t('bdStatusCancelled'))}</InfoChip>;
    if (item.status === 'confirmed' || item.status === 'active') return <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>{cap(t('bdStatusConfirmed'))}</InfoChip>;
    return <InfoChip variant="warning" icon={<AlertCircle className="h-2.5 w-2.5" />}>
      {item.status === 'pending' ? cap(t('bdStatusPending')) : item.status === 'expired' ? cap(t('bdStatusExpired')) : bookingStatusLabel(item.status, t)}
    </InfoChip>;
  };
  // Owner (WP-R): the kitchen's figure stays an estimate until its payout statement is issued at settlement.
  // Once the transfer is sent the amount is final, even before the closing statement is issued.
  const payoutTitle = booking?.paymentStatus === 'authorized' || (bookingDocuments && !bookingDocuments.statementIssued && booking?.payout?.status !== 'sent') ? t('bdEstimatedPayout', { defaultValue: 'Estimated payout' }) : t('bdYourPayout', { defaultValue: 'Your payout' });
  const chefTotalLabel = booking?.paymentStatus === 'authorized' ? t('bdAmountAuthorized') : t('bdAmountCharged');
  // Headline figure reuses the same shared breakdown builders the itemized list renders (display only).
  const paymentCaptured = ['paid', 'partially_refunded', 'refunded'].includes(booking?.paymentStatus || '');
  const bookingEnded = ['cancelled', 'rejected', 'expired', 'declined'].includes(booking?.status || '');
  // Extra time, changes and claims are their own charges; the chef's total includes what they paid, the kitchen's its share.
  const extraCharges = paymentCaptured ? (booking?.additionalCharges || []) : [];
  const extraCents = (line: NonNullable<BookingDetails['additionalCharges']>[number]) => isManagerView ? (line.kitchenShareCents ?? 0) : line.amountCents;
  const extraTotalCents = extraCharges.reduce((sum, line) => sum + extraCents(line), 0);
  // The "Refunded" line is every refund on the booking, matching the header (a change payment is refunded on its own charge).
  const extraRefundedCents = extraCharges.reduce((sum, line) => sum + (line.refundedCents || 0), 0);
  const paymentHeadline = (() => {
    if (!booking?.paymentTransaction || !pricingBreakdownInput || booking.paymentDecision?.state === 'pending'
      || (!paymentCaptured && bookingEnded)) return null;
    // Waiting on the chef's answer: hide the original-hold payout estimate (see payment status line).
    if (isManagerView && proposal) return null;
    if (isManagerView) return { label: payoutTitle, struck: false,
      // The booking's own net plus each extra charge's net. (The payout snapshot already includes the extras: never add them to it.)
      cents: (booking.paymentTransaction.kitchenShareCents ?? (extraCharges.length ? buildKitchenPayoutStatementBreakdown(pricingBreakdownInput).kitchenNetPayoutCents
        : !booking.scheduleRevision && booking.payout?.timing === 'after_closeout' ? booking.payout.amountCents : buildKitchenPayoutStatementBreakdown(pricingBreakdownInput).kitchenNetPayoutCents)) + extraTotalCents };
    // Before capture it is only a hold on the card; "Total paid" appears once the money was actually taken.
    if (!paymentCaptured) return { label: t('bnCardHold'), cents: booking.paymentTransaction.amount || buildChefBookingReceiptBreakdown(pricingBreakdownInput).totalPaidCents, struck: false };
    return { label: t('bdhTotalPaid'), cents: booking.paymentTransaction.amount + extraTotalCents, struck: false };
  })();
  // Once money is captured: one statement over every payment (Airbnb's "Guest paid" then "Host payout"). Holds keep the receipt view.
  const statement = (() => {
    const txn = booking?.paymentTransaction;
    // A chef's pending request reads the same way, ending in its card hold; the kitchen's review keeps the payout estimate.
    const held = !paymentCaptured && booking?.status === 'pending' && ['pending', 'authorized'].includes(booking.paymentStatus || '');
    if (!txn || !pricingBreakdownInput || !(paymentCaptured || held) || !paymentHeadline || (isManagerView && proposal)) return null;
    const sum = (key: 'amountCents' | 'serviceFeeCents' | 'taxCents' | 'refundedCents' | 'cardFeeCents' | 'refundShareCents') => extraCharges.reduce((total, line) => total + (line[key] ?? 0), 0);
    const serviceFee = pricingBreakdownInput.platformFeeAmountCents || 0, paid = txn.amount + sum('amountCents');
    const gross = txn.amount - serviceFee + sum('amountCents') - sum('serviceFeeCents');
    const cardFees = (pricingBreakdownInput.paymentProcessorFeeCents || 0) + sum('cardFeeCents');
    const refundShare = (pricingBreakdownInput.refundAmountCents || 0) + sum('refundShareCents');
    return { serviceFee: serviceFee + sum('serviceFeeCents'), tax: (txn.taxAmount || 0) + sum('taxCents'), paid, refunded: refundAmount + sum('refundedCents'),
      gross, cardFees, refundShare, payout: paymentHeadline.cents, adjustment: paymentHeadline.cents - (gross - cardFees - refundShare), held };
  })();
  const chargeLabel = (line: NonNullable<BookingDetails['additionalCharges']>[number]) => line.kind === 'damage_claim' ? t('bnChargeDamage')
    : line.kind === 'kitchen_change' ? t('bnChargeBookingChange')
    : line.kind === 'extra_time' ? t('bnChargeExtraTime')
    : line.minutes ? t('bnChargeExtension', { length: formatBookedDuration(line.minutes, lang) }) : t('bnChargeExtensionNoLength');
  const moneyRow = (label: ReactNode, cents: number, options: { sub?: string; muted?: boolean; total?: boolean; testId?: string } = {}) => (
    <div className={`flex justify-between gap-3 text-sm ${options.total ? 'mt-1 border-t pt-2 font-semibold' : ''}`} data-testid={options.testId}>
      <span className={`inline-flex items-center gap-1 ${options.muted ? 'text-muted-foreground' : ''}`}>{label}
        {/* The why behind a line opens from it (as Airbnb's price lines do), so the statement stays label + amount. */}
        {options.sub && <Popover><PopoverTrigger asChild>
          <button type="button" className="!min-h-0 !min-w-0 inline-flex items-center rounded-sm text-muted-foreground hover:text-foreground" aria-label={t('bdLineInfo', { item: typeof label === 'string' ? label : '' })}>
            <Info className="h-3.5 w-3.5" /></button>
        </PopoverTrigger><PopoverContent className="max-w-xs p-3 text-sm font-normal" align="start" side="top">{options.sub}</PopoverContent></Popover>}</span>
      <span className={`tabular-nums ${cents < 0 ? 'text-muted-foreground' : ''}`}>{cents < 0 ? `−${formatCurrency(-cents)}` : formatCurrency(cents)}</span>
    </div>);
  // ── State, times and facts for the Now card (design-booking-consolidation.md §2) ─────────────────────────────
  const hasMultipleVisits = (booking?.visits?.length ?? 0) > 1;
  const datedBooking = !!booking?.scheduleRevision;
  const bookingDays = datedBooking ? currentBookingDays(booking?.visits ?? [], booking!.scheduleRevision!) : [];
  const tz = booking?.location?.timezone || undefined;
  const lang = i18n.language;
  const closeoutVisits = booking?.closeout?.visits || [];
  const nowMs = Date.now();
  const headerDay = datedBooking ? bookingDays.find(visit => {
    if (visit.scheduleState !== 'active' || visit.checkinStatus === 'checked_out') return false;
    const clock = closeoutVisits.find(clock => clock.visitId === visit.id);
    if (clock) return Date.parse(clock.scheduledEndAt) > nowMs;
    try { return createBookingDateTime(calendarDateForBookingTime(visit.visitDate!.slice(0, 10), visit.endTime, visit.operatingWindowStartTime, visit.startTime), visit.endTime, tz!).getTime() > nowMs; }
    catch { return false; }
  }) ?? bookingDays.filter(visit => visit.scheduleState === 'active').at(-1) : undefined;
  const headerClock = headerDay ? closeoutVisits.find(clock => clock.visitId === headerDay.id) : undefined;
  const inspectionDue = closeoutVisits[0]?.inspection?.deadline;
  const inspectionDueText = inspectionDue ? formatEventTimestamp(inspectionDue) : null;
  const inspectionCanRespond = datedBooking ? !!headerClock?.inspection.canRespond : closeoutVisits.some(visit => visit.inspection.canRespond);
  const visitBounds = (() => {
    if (!booking || !tz) return null;
    try {
      const date = headerDay?.visitDate?.slice(0, 10) ?? booking.bookingDate.split('T')[0];
      const start = headerDay?.startTime ?? booking.startTime;
      const end = headerDay?.endTime ?? booking.endTime;
      const anchor = headerDay?.operatingWindowStartTime ?? booking.operatingWindowStartTime;
      const startAt = createBookingDateTime(calendarDateForBookingTime(date, start, anchor), start, tz);
      const endAt = createBookingDateTime(calendarDateForBookingTime(date, end, anchor, start), end, tz);
      return { startAt, endAt, opensAt: new Date(startAt.getTime() - (booking.checkinWindowMinutesBefore ?? 15) * 60_000) };
    } catch { return null; }
  })();
  const phase: BookingHeaderPhase = booking ? bookingHeaderPhase({
    status: booking.status, checkinStatus: headerDay?.checkinStatus ?? booking.checkinStatus, visits: datedBooking ? undefined : booking.visits, closeoutPhase: datedBooking ? headerClock?.phase : booking.closeout?.phase,
    visitAttendance: datedBooking ? headerClock ? [headerClock.attendance] : undefined : booking.closeout?.legacy ? undefined : booking.closeout?.visits?.map(visit => visit.attendance), inspectionCanRespond, startAt: visitBounds?.startAt, endAt: visitBounds?.endAt, checkinOpensAt: visitBounds?.opensAt, timezone: tz,
  }) : 'confirmed';
  const cancelCause = booking ? bookingCancelCause({ status: booking.status, chefId: booking.chefId, paymentDecision: booking.paymentDecision, partialAcceptance: booking.partialAcceptance }) : null;
  // After a declined or expired request: the chef finds another time; the kitchen can invite the chef to one (spec row 5).
  const findAnotherTimeHref = booking && (cancelCause === 'declined' || cancelCause === 'expired') && (booking.location?.id ?? booking.kitchen?.locationId)
    ? isManagerView ? (booking.chefId ? `/manager/invitations/new?chefId=${booking.chefId}&location=${booking.location?.id ?? booking.kitchen?.locationId}` : null)
      : `/book/${booking.location?.id ?? booking.kitchen?.locationId}?kitchenId=${booking.kitchenId}` : null;
  // A request the chef changed: its replacement is where things continue.
  const replacedBy = cancelCause === 'replaced' ? booking?.paymentDecision?.replacedBy : null;
  const newRequestHref = replacedBy?.bookingId ? `${isManagerView ? '/manager' : ''}/booking/${replacedBy.bookingId}` : null;
  // "Change request" (pending only): rebook first; the earlier request closes once the new one is sent.
  const changeRequestLink = booking && !isManagerView && booking.status === 'pending' && booking.paymentStatus === 'authorized' && !booking.paymentDecision
    ? changeRequestHref({ ...booking, locationId: booking.location?.id ?? booking.kitchen?.locationId }) : null;
  const chefName = booking?.chef?.fullName || booking?.chef?.username || t('bdhChefFallback');
  const kitchenName = booking?.kitchen?.name || t('bdKitchenBookingFallback');
  const visitActive = !!booking && (['checked_in', 'checkout_requested'].includes(booking.checkinStatus || '') || (booking.visits || []).some(visit => ['checked_in', 'checkout_requested'].includes(visit.checkinStatus)));
  const visitStarted = !!booking && (['in_booked_time', 'booked_time_ended', 'ended'].includes(booking.closeout?.phase || '')
    || ![null, undefined, '', 'not_checked_in'].includes(booking.checkinStatus) || booking.status === 'completed'
    || (booking.visits || []).some(visit => visit.checkinStatus !== 'not_checked_in'));
  const shortWhen = (value: Date | string) => { try { return friendlyDateTime(value, lang, tz); } catch { return ''; } };
  const clockTime = (value: Date | string) => {
    try { return new Intl.DateTimeFormat(lang, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value)); }
    catch { return ''; }
  };
  const zoneName = tz ? friendlyTimezoneName(tz, lang) : '';
  const withZone = (value: Date | string) => `${clockTime(value)}${zoneName ? ` ${zoneName}` : ''}`;
  const cancellationCutoff = (() => {
    if (!booking) return null;
    const policy = booking.cancellationPolicySnapshot;
    if (datedBooking && policy?.sessions[0]) return Date.parse(policy.sessions[0].startAt) - policy.noticeHours * 3_600_000;
    try { return kitchenRescheduleCutoff(bookingChangeSchedule(booking), booking.cancellationPolicyHours ?? booking.location?.cancellationPolicyHours ?? 24); } catch { return null; }
  })();
  const cancellationDeadlineText = cancellationCutoff != null ? formatEventTimestamp(new Date(cancellationCutoff).toISOString()) : undefined;
  const paidCancellationAvailable = cancellationCutoff != null && Date.now() < cancellationCutoff;
  const hasArrival = !!booking && arrivalRecorded(booking);
  const chefCanCancel = !isManagerView && !!booking && !visitActive
    && canCancelOrChange({ status: booking.status, phase, arrivalRecorded: hasArrival });
  const managerCanManage = isManagerView && !!booking && (canCancelOrChange({ status: booking.status, phase, arrivalRecorded: hasArrival, manager: true })
    || (booking.status === 'cancelled' && !!bookingForManagement?.transactionId && ['paid', 'succeeded', 'partially_refunded'].includes(booking.paymentStatus || '')));
  const canDownload = !!booking && booking.paymentDecision?.state !== 'pending' && ['paid', 'partially_refunded', 'refunded'].includes(booking.paymentStatus || '');
  const showRefundReview = !!booking && !(booking.status === 'cancelled' && booking.paymentStatus === 'failed') && (['cancelled', 'cancellation_requested'].includes(booking.status)
    || [...(booking.storageBookings || []), ...(booking.equipmentBookings || [])].some(item => ['cancelled', 'cancellation_requested', 'removal_required'].includes(item.status)));
  const inspectionVisitId = booking?.visits?.length === 1 ? booking.visits[0].id
    : booking?.visits?.find(visit => visit.checkinStatus === 'checkout_requested')?.id;
  const inspectionHref = booking ? `/manager/booking/${booking.id}/inspection${inspectionVisitId ? `?visitId=${inspectionVisitId}` : ''}` : '';
  // The booked end (after any extension) of the visit the chef is still checked in to.
  const overstayEndAt = closeoutVisits.find(visit => visit.arrivalRecorded && lateCheckoutOpen(visit))?.scheduledEndAt ?? visitBounds?.endAt ?? null;
  const startPassed = !!visitBounds && nowMs >= visitBounds.startAt.getTime();
  const runningLateOpen = !isManagerView && !!booking && !!visitBounds
    && canReportRunningLate({ status: booking.status, checkedIn: visitStarted, start: visitBounds.startAt, end: visitBounds.endAt }, nowMs);
  const runningLateSent = !!booking?.runningLate && booking.status === 'confirmed' && !visitStarted && !!visitBounds && nowMs < visitBounds.endAt.getTime();
  const checkoutAt = booking?.checkoutRequestedAt || booking?.visits?.find(visit => visit.checkoutRequestedAt)?.checkoutRequestedAt || null;
  const inspectionOutcome = closeoutVisits.length && closeoutVisits.every(visit => visit.inspection.outcome === 'manager_cleared') ? 'manager_cleared'
    : closeoutVisits.some(visit => visit.inspection.outcome === 'auto_closed_uninspected') ? 'auto_closed_uninspected' : null;
  const inspectedAt = inspectionOutcome === 'manager_cleared' ? closeoutVisits.at(-1)?.inspection.closedAt : null;
  const releaseAt = booking?.location?.instructionsReleaseAt;
  const detailsReleaseAt = booking?.location?.instructionsReleased === false && releaseAt && Date.parse(releaseAt) > nowMs ? shortWhen(releaseAt) : null;
  const bookedEndAt = closeoutVisits.at(-1)?.scheduledEndAt ?? visitBounds?.endAt ?? null;
  const claimWindowOpen = isManagerView && !!booking && ['confirmed', 'completed'].includes(booking.status) && visitStarted
    && claimFilingOpen({ bookedEndAt, departure: booking });
  const upcoming = ['pending', 'confirmed', 'today', 'checkin_open'].includes(phase);
  const messageAllowed = !!booking && canMessage(booking.status);

  // Claims (same query the claim cards use); open ones join the Now card, closed ones the visit details.
  const claimsQuery = useQuery({ queryKey: ['damage-claims', booking?.id ?? 0], enabled: !!booking && ['confirmed', 'completed'].includes(booking.status),
    queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>(`/bookings/${booking!.id}/damage-claims`), retry: false });
  const claims = claimsQuery.data?.claims;
  const visibleClaims = claims?.filter(claim => claim.claimVersion === 2 && claim.status !== 'draft' && (isManagerView || claim.chefVisible));
  const unreportedVisits = (booking?.visits || []).filter(visit => !claims?.some(claim => claim.claimVersion === 2 && claim.status !== 'draft' && claim.visitId === visit.id));
  const alreadyReported = !!claims?.some(claim => claim.claimVersion === 2 && claim.status !== 'draft')
    && (!(booking?.visits || []).length || unreportedVisits.length === 0);
  const latestClaim = visibleClaims?.reduce<DamageClaimCardData | undefined>((latest, claim) => !latest || claim.id > latest.id ? claim : latest, undefined);
  const settledClaim = latestClaim?.status === 'charge_succeeded' ? { outcome: 'chef_paid' as const, amount: claimMoney(latestClaim.amountCents, i18n.language) }
    : latestClaim?.status === 'resolved' && latestClaim.kitchenPaid && ['closed', 'write_off'].includes(latestClaim.resolutionType || '') && latestClaim.fundedBy === 'local_cooks'
      ? isManagerView ? { outcome: 'local_cooks_paid' as const, amount: claimMoney(latestClaim.amountCents, i18n.language) } : null
      : latestClaim && ['rejected', 'resolved'].includes(latestClaim.status) ? { outcome: 'closed' as const, amount: '' } : null;

  const now = bookingNowContent({ phase, role: isManagerView ? 'manager' : 'chef', t, facts: {
    chef: chefName, kitchen: kitchenName, cancelCause, status: booking?.status,
    responseDeadline: responseDeadlineText, detailsReleaseAt,
    opensAt: visitBounds ? shortWhen(visitBounds.opensAt) : null,
    startClock: visitBounds ? clockTime(visitBounds.startAt) : null,
    endClock: visitBounds ? clockTime(visitBounds.endAt) : null,
    endWithZone: visitBounds ? withZone(visitBounds.endAt) : null,
    overstayEndWithZone: overstayEndAt ? withZone(overstayEndAt) : null,
    startPassed,
    runningLate: runningLateSent && booking?.runningLate ? { duration: t(`rlDurationShort${booking.runningLate.minutes}`) } : null,
    arrivalMode: booking?.arrivalMode,
    checkedInClock: booking?.checkedInAt ? clockTime(booking.checkedInAt) : null,
    checkedInMethod: booking?.checkedInMethod,
    checkoutClock: checkoutAt ? clockTime(checkoutAt) : null,
    inspectionCanRespond, inspectionDue: inspectionDueText,
    payoutReview: isManagerView && booking?.payout?.timing === 'after_closeout' && booking.payout.status === 'scheduled' && booking.payout.amountCents > 0 && booking.payout.expectedAt
      ? { amount: formatCurrency(booking.payout.amountCents), date: formatEventTimestamp(booking.payout.expectedAt) } : null,
    claimDeadline: latestClaim && !settledClaim && !['resolved', 'rejected'].includes(latestClaim.status) ? claimWhen(latestClaim.deadline, latestClaim.visitEvidence?.timezone || tz || 'America/St_Johns', i18n.language) : undefined,
    claimStage: latestClaim && !settledClaim ? (['chef_disputed', 'under_review'].includes(latestClaim.status) ? 'reviewing'
      : latestClaim.upheldAt && latestClaim.chefOwes && ['approved', 'partially_approved', 'chef_accepted'].includes(latestClaim.status) ? 'decided' : undefined) : undefined,
    claimAmount: latestClaim ? claimMoney(latestClaim.amountCents, i18n.language) : undefined,
    claimPaused: !!latestClaim && claimBookingHeld(latestClaim),
    claimPayBy: latestClaim?.upheldAt ? claimPayByDate(latestClaim.upheldAt, latestClaim.visitEvidence?.timezone || tz || 'America/St_Johns', i18n.language) : undefined,
    settledClaim, hasClaim: claimsQuery.isPending || claimsQuery.isError || !!claims?.some(claim => claim.claimVersion === 2 && claim.status !== 'draft'),
    inspectionOutcome, inspectedOn: inspectedAt ? formatShortDate(inspectedAt) : null,
    canCancel: chefCanCancel, canChangeRequest: !!changeRequestLink && chefCanCancel, canAddToCalendar: booking?.status === 'confirmed' && !!visitBounds && upcoming, runningLateOpen, canMessage: messageAllowed,
    canDownload, managerCanManage, claimFilingOpen: claimWindowOpen, findAnotherTime: !!findAnotherTimeHref,
    replacedByRef: newRequestHref ? replacedBy?.reference || `#${replacedBy?.bookingId}` : null,
  } });
  // Waiting for the chef's answer to the kitchen's new total: the kitchen has nothing to review; the card below carries the answer.
  const primary = proposal && now.primary === 'review_request' ? null : now.primary;

  const payableClaim = !isManagerView ? nowClaims(claims, false).find(chefCanPayClaim) : undefined;
  const claimTakesPrimary = !primary && !!payableClaim;

  const primaryLabel = primary === 'review_request' ? t('bdTakeAction') : primary === 'review_cancellation' ? t('bdhReviewCancellation')
    : primary === 'review_checkout' ? t('bdhReviewCheckout') : primary === 'inspect_visit' ? t('fixInspection') : primary === 'open_visit' ? (phase === 'in_session' || phase === 'time_ended_in_session' ? t('bdhCheckOut') : t('bdhOpenVisit'))
    : primary === 'answer_attendance' ? t('bnTheyCame') : '';
  const runPrimary = () => {
    if (!booking) return;
    // The request is answered on its own page (Airbnb / Peerspace request pages), not in a dialog.
    if (primary === 'review_request') navigate(`/manager/booking/${booking.id}/review`);
    else if (primary === 'review_cancellation') openManagementDialog();
    else if (primary === 'review_checkout' || primary === 'inspect_visit') navigate(inspectionHref);
    else if (primary === 'open_visit') navigate(`/booking/${booking.id}/visit${headerDay ? `?visitId=${headerDay.id}` : ''}`);
    // "They came": the existing visit-record statement (report_attended), with an optional note for the actual times.
    else if (primary === 'answer_attendance') openFix('report_attended');
  };
  const primaryBusy = (primary === 'review_request' && isUpdatingStatus) || (primary === 'review_cancellation' && isManagementProcessing);
  const primaryButton = (testId: string, className?: string) => primary && primary !== 'answer_attendance' && (
    <Button type="button" className={cn('min-h-11', className)} data-testid={testId} data-primary-action="true" onClick={runPrimary} disabled={primaryBusy}>
      {primaryBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
      {primaryLabel}
    </Button>
  );
  const messageLabel = openingConversation ? t('detailsCopy18') : isManagerView ? t('detailsCopy19') : t('detailsCopy20');
  const messageButton = (className?: string) => messageAllowed && (
    <Button type="button" variant="outline" className={cn('min-h-11', className)} onClick={() => void openBookingConversation()} disabled={openingConversation}>
      <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />{messageLabel}
    </Button>
  );
  const goToHelp = () => document.getElementById('booking-support')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const addToCalendar = () => {
    if (!booking || !visitBounds) return;
    if (datedBooking) {
      const ics = bookingDaysIcs(bookingDays.map(visit => {
        const day = visit.visitDate!.slice(0, 10);
        return { uid: `booking-${booking.id}-visit-${visit.id}`, revision: booking.scheduleRevision!, title: t('bdhCalendarTitle', { kitchen: kitchenName }),
          start: createBookingDateTime(calendarDateForBookingTime(day, visit.startTime, visit.operatingWindowStartTime), visit.startTime, tz!),
          end: createBookingDateTime(calendarDateForBookingTime(day, visit.endTime, visit.operatingWindowStartTime, visit.startTime), visit.endTime, tz!),
          cancelled: visit.scheduleState === 'cancelled', location: booking.location?.address, description: booking.referenceCode };
      }));
      downloadBookingIcs(`LocalCooks-${booking.referenceCode || booking.id}.ics`, ics);
      return;
    }
    const ics = bookingIcs({ uid: `booking-${booking.id}`, title: t('bdhCalendarTitle', { kitchen: kitchenName }), start: visitBounds.startAt, end: visitBounds.endAt,
      location: [booking.location?.name, booking.location?.address].filter(Boolean).join(', '), description: booking.referenceCode || undefined });
    downloadBookingIcs(`LocalCooks-${booking.referenceCode || booking.id}.ics`, ics);
  };
  const openFix = (action?: 'departure' | 'report_attended' | 'report_no_show') => { setFixAction(action); setFixOpen(true); };
  // With issued documents the action scrolls to the Receipts list (handleDownloadInvoice), so it names that list, never a "final invoice".
  const downloadLabel = bookingDocuments ? t(isManagerView ? 'bdViewPayoutDocuments' : 'bdViewReceipts')
    : isManagerView ? t('bdDownloadPayoutStatement') : t(booking?.status === 'completed' && phase !== 'no_checkin' && phase !== 'no_show' ? 'bdDownloadFinalInvoice' : 'bdDownloadReceipt');

  // Secondary row: at most three links; the rest join the ⋯ menu.
  const toolLabel = (tool: ExtensionTool) => bt(tool === 'offer' ? 'sxbOfferMore' : tool === 'early_start' ? 'sxbLetStartEarly' : 'sxbChargeExtra');
  const secondaryLinks: NowSecondaryLink[] = now.secondary.flatMap((key): NowSecondaryLink[] => {
    switch (key) {
      case 'change_request': return changeRequestLink ? [{ key, label: t('bnChangeRequest'), href: changeRequestLink, onSelect: () => navigate(changeRequestLink), testId: 'change-request' }] : [];
      case 'cancel_request': return [{ key, label: t('bnCancelRequest'), onSelect: () => setCancelOpen(true) }];
      case 'see_arrival_details': return booking ? [{ key, label: t('bnSeeArrivalDetails'), onSelect: () => navigate(`/booking/${booking.id}/visit`) }] : [];
      case 'add_to_calendar': return [{ key, label: t('bdhAddToCalendar'), icon: CalendarPlus, onSelect: addToCalendar }];
      case 'running_late': return [{ key, label: runningLateSent ? t('bnRunningLateUpdate') : t('rlAction'), onSelect: () => setLateOpen(true), testId: 'running-late-link' }];
      case 'arrived_early': return [{ key, label: t('bnArrivedEarly', { kitchen: kitchenName }), icon: MessageSquare, onSelect: () => void openBookingConversation() }];
      case 'need_more_time': return booking ? [{ key, label: t('bnNeedMoreTime'), onSelect: () => navigate(`/booking/${booking.id}/visit`) }] : [];
      case 'download_invoice': case 'download_payout_statement': return [{ key, label: downloadLabel, icon: Download, onSelect: () => void handleDownloadInvoice() }];
      case 'contact_local_cooks': return [{ key, label: t('bdContactSupport', { defaultValue: 'Contact Local Cooks' }), onSelect: goToHelp }];
      case 'find_another_time': return findAnotherTimeHref ? [{ key, label: isManagerView ? t('bdhInviteAnotherTime', { chef: chefName }) : t('bdhFindAnotherTime'), href: findAnotherTimeHref, onSelect: () => navigate(findAnotherTimeHref), testId: 'find-another-time' }] : [];
      case 'view_new_request': return newRequestHref ? [{ key, label: t('bnViewNewRequest'), href: newRequestHref, onSelect: () => navigate(newRequestHref), testId: 'view-new-request' }] : [];
      case 'extension_tools': return extTools.map(tool => ({ key: `tool-${tool}`, label: toolLabel(tool), onSelect: () => setExtTool(tool) }));
      case 'change_booking': return [{ key, label: t('bdhChangeBooking'), onSelect: openManagementDialog }];
      case 'manage_refund': return [{ key, label: t('bdhManageRefund'), onSelect: openManagementDialog }];
      case 'fix_record': return [{ key, label: t('fixTitle'), onSelect: () => openFix() }];
      case 'record_left': return [{ key, label: t('bdhOverstayRecordLeft'), icon: LogOut, onSelect: () => openFix('departure') }];
      case 'report_no_show': return [{ key, label: t('bnTheyDidntCome'), onSelect: () => openFix('report_no_show'), testId: 'they-didnt-come' }];
      // The chef contests a missing check-in through the booking's problem report (Local Cooks reviews; it sees the kitchen's answer).
      case 'i_was_there': return [{ key, label: t('bnIWasThere'), onSelect: () => { goToHelp(); setIWasThereOpen(open => open + 1); }, testId: 'i-was-there' }];
      case 'report_damage': return !claimsQuery.data ? [] : alreadyReported
        ? [{ key, label: policyT('dcV2AlreadyReported'), muted: true, href: '/manager/dashboard?view=support' }]
        : [{ key, label: policyT('dcV2Report'), onSelect: () => setClaimOpen(true) }];
    }
  });
  const visibleSecondary = secondaryLinks.slice(0, NOW_SECONDARY_VISIBLE);
  const overflowSecondary = secondaryLinks.slice(NOW_SECONDARY_VISIBLE);
  const visibleKeys = new Set(visibleSecondary.map(link => link.key));

  // ⋯ menu: the full action list, minus whatever is already one tap away (the primary and the visible links).
  const menuItems: Array<{ key: string; label: string; onSelect: () => void; icon: ComponentType<{ className?: string }> }> = [];
  if (isManagerView && booking?.status === 'confirmed') menuItems.push({ key: 'kitchen-cancel', label: policyT('cpKitchenCancel'), icon: CalendarX, onSelect: () => setKitchenCancelOpen(true) });
  if (chefCanCancel && booking?.status === 'confirmed' && !visitStarted) menuItems.push({ key: 'change', label: policyT('chgDialogTitle'), icon: CalendarPlus, onSelect: () => setChangeOpen(true) });
  if (chefCanCancel && booking?.status !== 'pending' && !visibleKeys.has('cancel_request')) menuItems.push({ key: 'cancel', label: policyT('chgCancelBooking'), icon: CalendarX, onSelect: () => setCancelOpen(true) });
  if (managerCanManage && primary !== 'review_cancellation' && !visibleKeys.has('change_booking') && !visibleKeys.has('manage_refund'))
    menuItems.push({ key: 'manage', label: booking?.status === 'cancelled' ? t('bdhManageRefund') : booking?.status === 'confirmed' ? t('bdhChangeBooking') : t('bdhReviewCancellation'), icon: CalendarX, onSelect: openManagementDialog });
  if (isManagerView && visitStarted && ['confirmed', 'completed'].includes(booking?.status || '')) {
    if (primary !== 'review_checkout' && primary !== 'inspect_visit') menuItems.push({ key: 'inspect', label: t('fixInspection'), icon: ClipboardCheck, onSelect: () => navigate(inspectionHref) });
    if (!visibleKeys.has('fix_record') && !visibleKeys.has('record_left')) menuItems.push({ key: 'fix', label: t('fixTitle'), icon: Wrench, onSelect: () => openFix() });
  }
  if (visitBounds && booking?.status === 'confirmed' && upcoming && !visibleKeys.has('add_to_calendar')) menuItems.push({ key: 'calendar', label: t('bdhAddToCalendar'), icon: CalendarPlus, onSelect: addToCalendar });
  if (canDownload && !visibleKeys.has('download_invoice') && !visibleKeys.has('download_payout_statement')) menuItems.push({ key: 'download', label: downloadLabel, icon: Download, onSelect: () => void handleDownloadInvoice() });
  for (const link of overflowSecondary) if (!menuItems.some(item => item.label === link.label)) menuItems.push({ key: `more-${link.key}`, label: link.label, icon: link.icon || MoreHorizontal, onSelect: link.onSelect || (() => { if (link.href) navigate(link.href); }) });
  menuItems.push({ key: 'help', label: t('bdhGetHelp'), icon: LifeBuoy, onSelect: goToHelp });
  const hasBottomBar = !!primary || claimTakesPrimary || messageAllowed;

  // ── Visit details (timeline) ─────────────────────────────────────────────────────────────────────────────────
  const arrivalLabel = (method?: string | null) => !isManagerView ? bt('vrYouCheckedIn')
    : bt(method === 'code' ? 'vrChefCheckedInCode' : method === 'self' ? 'vrChefCheckedInSelf' : method === 'manager' ? 'vrKitchenAddedArrival' : 'vrChefCheckedIn', { chef: chefName });
  // Said once: the manager's in-session sentence carries the check-in time, the chef's submitted sentence the checkout time.
  const omitArrival = isManagerView && phase === 'in_session';
  const omitDeparture = !isManagerView && phase === 'checkout_review';
  const timelineEvents: VisitTimelineEvent[] = (() => {
    if (!booking) return [];
    const rows = hasMultipleVisits ? booking.visits! : [{ id: 0, blockIndex: 0, checkedInAt: booking.checkedInAt ?? null, checkoutRequestedAt: booking.checkoutRequestedAt ?? null,
      checkedOutAt: booking.checkedOutAt ?? null, noShowDetectedAt: booking.noShowDetectedAt ?? null }];
    return rows.flatMap(visit => {
      const prefix = (label: string) => hasMultipleVisits ? bt('vrVisitPrefix', { number: visit.blockIndex + 1, label }) : label;
      const out: VisitTimelineEvent[] = [];
      const left = visit.checkoutRequestedAt || visit.checkedOutAt;
      if (visit.checkedInAt && !omitArrival) out.push({ key: `in-${visit.id}`, label: prefix(arrivalLabel(hasMultipleVisits ? null : booking.checkedInMethod)), at: shortWhen(visit.checkedInAt) });
      if (left && !omitDeparture) out.push({ key: `out-${visit.id}`, label: prefix(isManagerView ? bt('vrChefCheckedOut', { chef: chefName }) : bt('vrYouCheckedOut')), at: shortWhen(left) });
      if (visit.noShowDetectedAt) out.push({ key: `ns-${visit.id}`, label: prefix(bt('vrNoShow')), at: shortWhen(visit.noShowDetectedAt) });
      return out;
    });
  })();
  const claimLines = closedClaims(claims, isManagerView).map(claim => closedClaimLine(claim, isManagerView, bt, bt, lang, tz || 'America/St_Johns'));

  const renderPhotos = (urls: string[], prefix: string, alt: (n: number) => string) => (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {urls.map((url, i) => {
        const proxied = getR2ProxyUrl(url);
        return (
          <a key={`${prefix}-${i}`} href={proxied} target="_blank" rel="noopener noreferrer" className="block">
            <SmartImage src={proxied} alt={alt(i + 1)} className="h-20 w-full rounded-md border object-cover transition-opacity hover:opacity-80"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }} />
          </a>
        );
      })}
    </div>
  );
  const renderChecklist = (items: Array<{ id: string; label: string; checked: boolean }>, label: string) => (
    <div>
      <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground"><CheckCircle2 className="h-3 w-3" /> {label}</p>
      <div className="space-y-1">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-1.5">
            <Checkbox checked={item.checked} disabled className="pointer-events-none h-3 w-3" />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">{index + 1}.</span>
            <span className={`text-xs ${item.checked ? 'text-success' : 'text-destructive line-through'}`}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
  // The check-in method is already on the timeline, so it is not repeated here.
  const visitEvidence = booking && !hasMultipleVisits && (
    booking.checkinNotes || booking.checkoutNotes || booking.checkoutManagerMessage
    || booking.checkinPhotoUrls?.length || booking.checkoutPhotoUrls?.length || booking.checkinChecklistItems?.length || booking.checkoutChecklistItems?.length
  ) ? (
    <details className="group rounded-xl bg-muted/30 px-4 py-1" data-testid="visit-evidence">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium [&::-webkit-details-marker]:hidden">{t('bdhVisitDetails')}</summary>
      <div className="space-y-3 pb-3">
        {booking.checkinNotes && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{booking.checkedInMethod === 'self' ? t('bookingAttendanceChefMessage') : t('bookingAttendanceManagerMessage')}</p>
            <p className="whitespace-pre-wrap text-sm">{booking.checkinNotes}</p>
          </div>
        )}
        {booking.checkoutManagerMessage && <div><p className="text-xs text-muted-foreground">{t('bookingAttendanceManagerMessage')}</p><p className="whitespace-pre-wrap text-sm">{booking.checkoutManagerMessage}</p></div>}
        {booking.checkoutNotes && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{booking.checkoutNotes.startsWith('Message from kitchen manager: ') ? t('bookingAttendanceManagerMessage') : t('bookingAttendanceChefMessage')}</p>
            <p className="whitespace-pre-wrap text-sm">{booking.checkoutNotes}</p>
          </div>
        )}
        {!!booking.checkinChecklistItems?.length && renderChecklist(booking.checkinChecklistItems, t('bdCheckinChecklist'))}
        {!!booking.checkinPhotoUrls?.length && <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Camera className="h-3 w-3" /> {t('bdCheckinPhotos', { count: booking.checkinPhotoUrls.length })}</p>
          {renderPhotos(booking.checkinPhotoUrls, 'ci', n => t('bdCheckinPhotoAlt', { n }))}
        </div>}
        {!!booking.checkoutPhotoUrls?.length && <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Camera className="h-3 w-3" /> {t('bdCheckoutPhotos', { count: booking.checkoutPhotoUrls.length })}</p>
          {renderPhotos(booking.checkoutPhotoUrls, 'co', n => t('bdCheckoutPhotoAlt', { n }))}
        </div>}
        {!!booking.checkoutChecklistItems?.length && renderChecklist(booking.checkoutChecklistItems, t('bdCheckoutChecklist'))}
      </div>
    </details>
  ) : null;
  // Several visits: one row each with its status chip; the times are on the timeline.
  const visitPills = booking && hasMultipleVisits && (booking.status === 'confirmed' || booking.status === 'completed') ? (
    <ul className="flex flex-wrap gap-2" aria-label={t('bdhVisitsList')}>
      {booking.visits?.map(visit => <li key={visit.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-1.5 text-[13px]">
        <span className="tabular-nums">{t('bdVisitNumber', { number: visit.blockIndex + 1, defaultValue: `Visit ${visit.blockIndex + 1}` })} · {timeRange(formatTime(visit.startTime), formatTime(visit.endTime))}</span>
        {getCheckinStatusBadge(visit.checkinStatus)}
      </li>)}
    </ul>
  ) : null;
  const chefNoShow = !isManagerView && phase === 'no_show';
  const showVisitRecord = !!booking && visitStarted && !['pending', 'cancelled'].includes(phase)
    && (isManagerView || timelineEvents.length > 0 || !!visitEvidence || claimLines.length > 0 || chefNoShow || !!visitPills);

  // ── Blocks ───────────────────────────────────────────────────────────────────────────────────────────────────
  const cardClass = 'rounded-2xl border-border/70 p-4 shadow-none sm:p-6';
  const headingClass = 'text-base font-semibold leading-6';
  const withinCodeLead = !!visitBounds && nowMs >= visitBounds.startAt.getTime() - POLL_LEAD_MINUTES * 60_000;
  const chefBeforeArrival = !isManagerView && !!booking && ['confirmed', 'cancellation_requested'].includes(booking.status) && !visitStarted && phase !== 'visit_ended';
  const heroPhoto = !isManagerView ? booking?.kitchen?.photos?.find(Boolean) : null;
  const heroSrc = heroPhoto ? getR2ProxyUrl(heroPhoto) || heroPhoto : null;
  const slotText = bookingTimeSlots.length > 1 ? bookingTimeSlots.join(' · ') : null;
  // The header describes the days still booked; cancelled days stay listed below with their status.
  const keptDays = bookingDays.some(day => day.scheduleState !== 'cancelled') ? bookingDays.filter(day => day.scheduleState !== 'cancelled') : bookingDays;
  const daySpan = keptDays.length ? `${[formatDate(keptDays[0].visitDate!), formatDate(keptDays[keptDays.length - 1].visitDate!)].filter((v, i, all) => all.indexOf(v) === i).join(' – ')} · ${policyT('mdSelectedDays', { count: keptDays.length })}` : '';
  // Multi-day, once today's day is checked out: point the chef at the next booked day.
  const nextDay = datedBooking && booking?.status === 'confirmed' && (!headerDay || ['checkout_requested', 'checked_out'].includes(headerDay.checkinStatus ?? ''))
    ? keptDays.find(day => day.scheduleState === 'active' && (day.checkinStatus ?? 'not_checked_in') === 'not_checked_in' && day.id !== headerDay?.id
      && (!headerDay?.visitDate || day.visitDate! > headerDay.visitDate)) : undefined;
  const whenLine = datedBooking && bookingDays.length ? daySpan : booking ? [
    visitBounds ? new Intl.DateTimeFormat(lang, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(visitBounds.startAt)
      : new Date(`${bookingStartDateKey(booking) ?? booking.bookingDate.slice(0, 10)}T12:00:00Z`).toLocaleDateString(lang, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }),
    slotText || timeRange(formatTime(booking.startTime), formatTime(booking.endTime)),
    formatBookedDuration(calculateMinutes(), lang),
    zoneName || null,
  ].filter(Boolean).join(' · ') : '';
  const mapsHref = booking?.location?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.location.address)}` : null;

  const nowCard = booking && (
    <BookingNowCard
      reference={bookingReference(booking.referenceCode, booking.id)}
      bookedOn={t('bdBookedOn', { date: formatShortDate(booking.createdAt) })}
      title={isManagerView ? chefName : kitchenName}
      heroImage={heroSrc}
      leading={isManagerView ? <Avatar className="h-12 w-12 shrink-0"><AvatarFallback className="bg-muted text-sm font-semibold">{initials(chefName)}</AvatarFallback></Avatar> : undefined}
      subtitle={isManagerView ? <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{t('bdhKitchenSession', { kitchen: kitchenName })}</p>
        : booking.location && (mapsHref ? (
          <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="-my-[13px] inline-flex max-w-full items-start gap-1 py-[13px] text-[13px] leading-[18px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{booking.location.address}</span>
          </a>
        ) : <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{booking.location.name}</p>)}
      actions={<>
        <div className="hidden items-center gap-2 sm:flex" data-testid="header-actions">
          {messageButton()}
          {!narrow && primaryButton('header-primary-action')}
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={t('bdhMoreActions')}>
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {menuItems.map(item => (
              <DropdownMenuItem key={item.key} onSelect={item.onSelect} className="min-h-11 gap-2">
                <item.icon className="h-4 w-4 text-muted-foreground" />{item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
      whenLine={whenLine}
      pill={{ label: proposal ? t(isManagerView ? 'paPillKitchen' : 'paPillChef') : t(now.pill.key), tone: now.pill.tone }}
      sentence={proposal ? t(isManagerView ? 'paSentenceKitchen' : 'paSentenceChef', { kitchen: kitchenName, chef: chefName }) : now.sentence}
      sentenceExtra={!isManagerView && nextDay ? (
        <p className="text-sm font-medium" data-testid="booking-next-day">{t('mdNextDay', { number: keptDays.indexOf(nextDay) + 1, total: keptDays.length,
          date: formatDate(nextDay.visitDate!), time: formatKitchenClock(nextDay.startTime) })}</p>
      ) : isManagerView && booking.runningLate && booking.status === 'confirmed' && !visitStarted && visitBounds && nowMs < visitBounds.endAt.getTime() ? (
        <p className="text-sm font-medium text-sky-900" data-testid="booking-running-late">
          {t('rlManagerLine', { chef: chefName, duration: t(`rlDurationShort${booking.runningLate.minutes}`), time: clockTime(booking.runningLate.reportedAt) })}
          {booking.runningLate.note && <span className="block text-xs font-normal text-muted-foreground">{t('rlManagerNote', { note: booking.runningLate.note })}</span>}
        </p>
      ) : undefined}
      attention={<>
        {/* "Can't get in" / safety reports surface here while the visit is on; the support list below keeps the thread. */}
        {proposal && <PartialAcceptanceCard bookingId={booking.id} proposal={proposal} manager={isManagerView} kitchenName={kitchenName} chefName={chefName}
          timezone={booking.location?.timezone || undefined} withdrawing={isUpdatingStatus}
          onChanged={async () => { await reloadBookingDetails(); await queryClient.invalidateQueries(); }}
          onWithdraw={isManagerView ? () => void handleApprovalSubmit({ bookingId: booking.id, status: 'cancelled' }) : undefined} />}
        <OpenProblemAlert bookingId={booking.id} role={isManagerView ? 'manager' : 'chef'} chefName={chefName} kitchenName={kitchenName}
          timezone={tz || 'America/St_Johns'} active={booking.status === 'confirmed' && !!visitBounds && nowMs < visitBounds.endAt.getTime()}
          checkedIn={!!booking.checkinStatus && booking.checkinStatus !== 'not_checked_in'} messageButton={messageButton()} onViewReport={goToHelp} />
        {now.attention.includes('changes') && <KitchenBookingChanges variant="now" timezone={booking.location?.timezone} key={`changes-${booking.id}-${changesVersion}`} bookingId={booking.id} manager={isManagerView} counterpart={isManagerView ? chefName : kitchenName}
          onChanged={async () => { await reloadBookingDetails(); await queryClient.invalidateQueries(); }} />}
        {/* A payable claim comes first: unpaid after a final decision, it pauses new bookings. */}
        {now.attention.includes('claims') && claims && <NowClaimRows claims={claims} manager={isManagerView} chefName={chefName} timezone={tz || 'America/St_Johns'}
          allowPrimary={claimTakesPrimary && !narrow} payInBarFor={narrow && claimTakesPrimary ? payableClaim?.id : null} payingId={payingClaimId} onPayingChange={setPayingClaimId} onChanged={() => { void claimsQuery.refetch(); void reloadBookingDetails(); }} />}
        {now.attention.includes('extensions') && ['confirmed', 'completed'].includes(booking.status) && (
          <SessionExtensionsCard variant="now" key={`extra-time-${booking.id}`} bookingId={booking.id} manager={isManagerView} chefName={chefName} onChanged={reloadBookingDetails}
            tool={extTool} onToolChange={setExtTool} onToolsChange={setExtTools} allowPrimary={!primary && !claimTakesPrimary && !narrow}
            refreshKey={[booking.status, booking.checkinStatus, booking.endTime, ...(booking.visits || []).map(visit => visit.checkinStatus)].join('|')} />
        )}
      </>}
      body={<>
        {primary === 'answer_attendance' && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('bnDidTheyCome')} data-testid="attendance-answer">
            <Button type="button" variant="outline" className="min-h-11" data-testid="they-came" onClick={() => openFix('report_attended')}>{t('bnTheyCame')}</Button>
            <Button type="button" variant="outline" className="min-h-11" data-testid="they-didnt-come" onClick={() => openFix('report_no_show')}>{t('bnTheyDidntCome')}</Button>
          </div>
        )}
        {/* Multi-day: say every time that each day has its own check-in, also once arrival details are out. */}
        {now.body === 'preparation' && chefBeforeArrival && (booking.location?.instructionsReleased === false || keptDays.length > 1) && (
          <p className="rounded-xl bg-muted/30 px-4 py-3 text-sm" data-testid="now-body">{t(keptDays.length > 1 ? (booking.arrivalMode === 'self' ? 'bnWhatToExpectDaysSelf' : 'bnWhatToExpectDays') : booking.arrivalMode === 'self' ? 'bnWhatToExpectSelf' : 'bnWhatToExpect')}</p>
        )}
        {now.body === 'preparation' && chefBeforeArrival && booking.location?.instructionsReleased !== false && (
          <ClampedBlock showAll={t('bnShowAll')} showLess={t('bnShowLess')}>
            <BookingPreparation bookingStatus={booking.status} arrivalInstructions={booking.location?.arrivalInstructions}
              instructionsReleased={booking.location?.instructionsReleased}
              // The sentence already says when arrival details arrive; the overview doesn't repeat it.
              instructionsReleaseAt={detailsReleaseAt && now.sentence.includes(detailsReleaseAt) ? null : booking.location?.instructionsReleaseAt}
              // Multi-day: the 'each day has its own check-in' line above already covers how arrival works.
              arrivalMode={keptDays.length > 1 ? null : booking.arrivalMode} timezone={booking.location?.timezone} visitStartAt={visitBounds?.startAt ?? null} />
          </ClampedBlock>
        )}
        {booking.status === 'confirmed' && (isManagerView && datedBooking || now.body === 'code' && !hasArrival) && (
          // The code panel brings its own frame; no second box around it.
          <div data-testid="now-body">
            <VisitCodePanel key={`visit-code-${booking.id}`} bookingId={booking.id} bookingStatus={booking.status} embedded collapsed={!withinCodeLead}
              visitEnded={false} customerName={chefName} kitchenName={booking.kitchen?.name}
              timezone={booking.location?.timezone} bookingDate={booking.bookingDate} operatingWindowStartTime={booking.operatingWindowStartTime}
              startTime={booking.startTime} endTime={booking.endTime} visits={datedBooking ? bookingDays : booking.visits} onChanged={reloadBookingDetails} />
          </div>
        )}
        {!isManagerView && (runningLateOpen || runningLateSent) && (
          <RunningLateCard inline open={lateOpen} onOpenChange={setLateOpen} bookingId={booking.id} kitchenName={kitchenName} startAt={visitBounds?.startAt ?? null} endAt={visitBounds?.endAt ?? null}
            timezone={booking.location?.timezone || 'America/St_Johns'} status={booking.status} checkedIn={visitStarted} runningLate={booking.runningLate}
            onChanged={reloadBookingDetails} />
        )}
      </>}
      secondary={visibleSecondary}
      footnote={isManagerView && phase === 'time_ended_in_session' ? <p className="-mt-2 text-[13px] leading-[18px] text-muted-foreground" data-testid="overstay-hint">{t('bnOverstayHint')}</p> : undefined}
      labels={{ header: t('bdhHeaderLabel'), secondary: t('bnMoreForNow') }}
    />
  );

  // The manager's Fix dialog lives in the attendance panel inside Visit details (mounted even while collapsed).
  const visitRecord = showVisitRecord && booking && (
    <BookingVisitRecord title={bt('vrTitle')} timelineLabel={bt('vrTimeline')} emptyText={bt('vrEmpty')} events={timelineEvents} defaultOpen={chefNoShow}
      extensions={<>{visitPills}{['confirmed', 'completed'].includes(booking.status) && <SessionExtensionsCard variant="record" key={`extra-time-record-${booking.id}`} bookingId={booking.id} manager={isManagerView} chefName={chefName}
        refreshKey={[booking.status, booking.checkinStatus, booking.endTime].join('|')} />}</>}
      claimLines={claimLines}
      evidence={visitEvidence}
      attendance={<BookingAttendancePanel key={`${booking.id}-${isManagerView}`} bookingId={booking.id} manager={isManagerView} onSaved={reloadBookingDetails} timezone={booking.location?.timezone}
        chefName={chefName} closeout={booking.closeout} embedded
        {...(isManagerView ? { fixOpen, onFixOpenChange: setFixOpen, fixAction } : {})}
        visitDetails={booking.visits?.length ? booking.visits : [{ ...booking, id: undefined }]} />}
      fixLabel={isManagerView && !visibleKeys.has('fix_record') && !visibleKeys.has('record_left') ? t('fixTitle') : undefined}
      onFix={isManagerView ? () => openFix() : undefined} />
  );

  const feedback = booking && ['completed', 'no_show', 'issue'].includes(phase) && (
    <BookingFeedbackCard compact bookingId={booking.id} role={isManagerView ? 'manager' : 'chef'} otherPartyName={isManagerView ? chefName : kitchenName} timezone={booking.location?.timezone || 'America/St_Johns'} />
  );

  const latitude = booking?.location?.latitude, longitude = booking?.location?.longitude;
  const hasCoordinates = typeof latitude === 'number' && typeof longitude === 'number';
  // Contact card: the hero already shows who (name, photo/initials) and Message, so this holds only the ways to reach them.
  const contactPhone = booking ? (isManagerView ? booking.chef?.phone : booking.kitchenContact?.phone) : null;
  const contactEmail = booking ? (isManagerView ? booking.chef?.username : booking.kitchenContact?.email) : null;
  const locationLine = !isManagerView && booking?.location?.name && booking.location.name !== kitchenName ? booking.location.name : null;
  const hasContact = (!!contactPhone && !!booking && contactVisible(booking.status)) || !!contactEmail || (!isManagerView && (!!mapsHref || !!locationLine));
  const personCard = booking && hasContact && (
    <section aria-labelledby="booking-person-title" data-testid="person-card">
      <Card className={cardClass}>
        <h2 id="booking-person-title" className={headingClass}>{isManagerView ? t('bdhChefLabel') : t('bdhKitchenLabel')}</h2>
        {locationLine && <p className="mt-0.5 text-sm text-muted-foreground">{locationLine}</p>}
        <div className="mt-2 space-y-1">
          {(() => {
            const phone = contactPhone;
            return phone && contactVisible(booking.status) ? (
              <div data-testid="contact-phone">
                <a href={`tel:${phone}`} className="inline-flex min-h-11 items-center text-sm font-medium tabular-nums underline underline-offset-4">{formatContactPhone(phone)}</a>
                <p className="text-[13px] leading-[18px] text-muted-foreground">{t('bdhSafetyHelper')}</p>
              </div>
            ) : null;
          })()}
          {(() => {
            const email = contactEmail;
            return email ? <a href={`mailto:${email}`} className="flex min-h-11 items-center break-all text-[13px] text-muted-foreground underline-offset-4 hover:underline">{email}</a> : null;
          })()}
          {/* Where (chef, Airbnb pattern): the map card (address + Get directions in its footer) when the kitchen can be
              placed — the same component as the listing; otherwise the full address and a directions link. */}
          {!isManagerView && booking.location?.address && (
            <div className="pt-1" data-testid="kitchen-where">
              {hasCoordinates ? (
                <Suspense fallback={<Skeleton className="h-[188px] w-full rounded-xl" />}>
                  <LocationMap address={booking.location.address} name={kitchenName} latitude={latitude} longitude={longitude} heightClassName="h-[140px]" />
                </Suspense>
              ) : (
                <div className="space-y-1">
                  <p className="flex items-start gap-1.5 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="select-all">{booking.location.address}</span></p>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking.location.address)}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-[13px] font-medium underline underline-offset-4">{t('bnGetDirections')}</a>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </section>
  );

  const storageRows = allStorageBookings.map(storage => ({ id: storage.id, name: storage.storageListing?.name || `Storage #${storage.storageListingId}`,
    detail: storage.startDate ? `${formatShortDate(storage.pricingModel === 'hourly' ? storage.startDate : storage.startDate.slice(0, 10))} – ${formatShortDate(storage.pricingModel === 'hourly' ? storage.endDate : storage.endDate.slice(0, 10))}` : null,
    price: formatCurrency(storage.totalPrice), struck: isItemVoided(storage) || isItemRefunded(storage) || storage.status === 'cancelled', chip: itemChip(storage, true) }));
  // Multi-day: the same equipment can be on several days, so each row names its day, in day order.
  const equipmentDay = (equipment: { kitchenBookingVisitId?: number | null }) => datedBooking ? bookingDays.find(visit => visit.id === equipment.kitchenBookingVisitId)?.visitDate ?? null : null;
  const equipmentRows = [...allEquipmentBookings].sort((a, b) => (equipmentDay(a) ?? '').localeCompare(equipmentDay(b) ?? '')).map(equipment => ({ id: equipment.id, name: equipment.equipmentListing?.equipmentType || `Equipment #${equipment.equipmentListingId}`,
    detail: [(date => date ? formatShortDate(date) : null)(equipmentDay(equipment)),
      equipment.equipmentListing?.brand].filter(Boolean).join(' · ') || null, price: formatCurrency(equipment.totalPrice),
    struck: isItemVoided(equipment) || isItemRefunded(equipment) || equipment.status === 'cancelled', chip: itemChip(equipment, false) }));
  const addOns = booking && (storageRows.length > 0 || equipmentRows.length > 0) && (
    <section aria-labelledby="booking-addons-title">
      <Card className={`${cardClass} space-y-4`}>
        <h2 id="booking-addons-title" className={headingClass}>{t('bdhAddOns')}</h2>
        <StorageRows title={t('bdStorageSection')} rows={storageRows} />
        <EquipmentRows title={t('bdEquipmentSection')} rows={equipmentRows} actions={id => {
          const equipment = allEquipmentBookings.find(item => item.id === id);
          return isManagerView && equipment && booking.paymentDecision?.state !== 'pending' && equipment.status === 'cancellation_requested' && booking.status === 'confirmed' && <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="min-h-11" disabled={itemCancellationPending} onClick={() => void reviewEquipmentCancellation(id, true)}>{t('bdAcceptCancellation', { defaultValue: 'Accept cancellation' })}</Button>
            <Button variant="outline" size="sm" className="min-h-11" disabled={itemCancellationPending} onClick={() => void reviewEquipmentCancellation(id, false)}>{t('bdDeclineCancellation', { defaultValue: 'Decline cancellation' })}</Button>
          </div>;
        }} />
      </Card>
    </section>
  );

  const note = booking?.specialNotes && (
    <section aria-labelledby="booking-note-title">
      <Card className={cardClass}>
        <h2 id="booking-note-title" className={`${headingClass} mb-3`}>{isManagerView ? t('bdhNoteFrom', { name: chefName }) : t('bdhYourNote')}</h2>
        <blockquote className="whitespace-pre-wrap border-l-2 pl-4 text-sm leading-relaxed text-foreground/80">{booking.specialNotes}</blockquote>
      </Card>
    </section>
  );

  const breakdown = booking && (<>
    {booking.paymentStatus === 'failed' && booking.status === 'cancelled' ? (
      <div className="flex justify-between text-sm" data-testid="not-charged-line">
        <span className="text-muted-foreground">{cap(t('bdStatusNotCharged'))}</span>
        <span className="tabular-nums text-muted-foreground line-through">{formatCurrency(booking.paymentTransaction?.amount || totals.subtotal)}</span>
      </div>
    ) : (<>
      {statement && isManagerView && <h4 className="text-xs font-semibold text-muted-foreground">{t('bdChefPaidHeading')}</h4>}
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{ct('sweepLabel34')}</span>
        <span className="tabular-nums">{formatCurrency(totals.kitchen > 0 ? totals.kitchen : booking.totalPrice)}</span>
      </div>
      {allStorageTotal > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("bdStorageLine")}</span>
          <div className="text-right">
            {rejectedStorageTotal > 0 && rejectedStorageTotal < allStorageTotal && <span className="mr-2 text-xs tabular-nums text-muted-foreground line-through">{formatCurrency(allStorageTotal)}</span>}
            <span className={`tabular-nums ${rejectedStorageTotal > 0 && rejectedStorageTotal === allStorageTotal ? "text-muted-foreground line-through" : ""}`}>
              {rejectedStorageTotal === allStorageTotal ? formatCurrency(allStorageTotal) : formatCurrency(totals.storage)}
            </span>
          </div>
        </div>
      )}
      {allEquipmentTotal > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("bdEquipmentLine")}</span>
          <div className="text-right">
            {rejectedEquipmentTotal > 0 && rejectedEquipmentTotal < allEquipmentTotal && <span className="mr-2 text-xs tabular-nums text-muted-foreground line-through">{formatCurrency(allEquipmentTotal)}</span>}
            <span className={`tabular-nums ${rejectedEquipmentTotal > 0 && rejectedEquipmentTotal === allEquipmentTotal ? "text-muted-foreground line-through" : ""}`}>
              {rejectedEquipmentTotal === allEquipmentTotal ? formatCurrency(allEquipmentTotal) : formatCurrency(totals.equipment)}
            </span>
          </div>
        </div>
      )}
      {statement ? extraCharges.map(line => <div key={line.id} data-testid="extra-charge-line">{moneyRow(chargeLabel(line), line.subtotalCents ?? line.amountCents, { muted: true })}</div>) : (
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{t("bdSubtotal")}</span>
        <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
      </div>)}
      {statement ? (<>
        {statement.tax > 0 && moneyRow(t('bdHstPercent', { percent: pricingBreakdownInput!.kitchenHstRatePercent ?? 0 }), statement.tax, { muted: true })}
        {moneyRow(t('bdServiceFeeLine'), statement.serviceFee, { muted: true, sub: isManagerView ? t('bdServiceFeeChefPaid') : undefined })}
        {moneyRow(statement.held ? t(isManagerView ? 'bdChefCardHold' : 'bnCardHold') : t('bdhTotalPaid'), statement.paid, { total: true, testId: 'statement-total-paid' })}
        {statement.refunded > 0 && moneyRow(isManagerView ? t('bdRefundedToChefLine') : t('bdRefundedLine'), -statement.refunded, { testId: 'statement-refunded',
          sub: goodwillRefund > 0 ? t('bdGoodwillIncluded', { amount: formatCurrency(goodwillRefund) }) : undefined })}
        {!isManagerView && statement.refunded > 0 && moneyRow(t('bdAfterRefunds'), statement.paid - statement.refunded, { total: true, testId: 'statement-after-refunds' })}
        {isManagerView && (<div className="space-y-1 pt-3" data-testid="statement-payout">
          <h4 className="text-xs font-semibold text-muted-foreground">{t('bdYourPayout')}</h4>
          {moneyRow(t('bdYourBookingAmount'), statement.gross, { sub: t('bdYourBookingAmountSub') })}
          {statement.cardFees > 0 && moneyRow(pricingBreakdownInput!.paymentProcessorFeeIsEstimate ? t('bdEstCardFees') : t('bdCardFees'), -statement.cardFees)}
          {statement.refundShare > 0 && moneyRow(t('bdKitchenRefundShare'), -statement.refundShare)}
          {statement.adjustment !== 0 && moneyRow(t('bdPayoutAdjustment'), statement.adjustment)}
          {moneyRow(payoutTitle, statement.payout, { total: true })}
          {statement.tax > 0 && <p className="text-xs text-muted-foreground">{t('bdHstIncludedNote', { amount: formatCurrency(statement.tax) })}</p>}
        </div>)}
      </>) : booking.paymentTransaction && pricingBreakdownInput && (
        isManagerView ? (
          proposal ? null : (
          <KitchenPayoutStatementBreakdown
            {...pricingBreakdownInput}
            currency={booking.currency || "CAD"}
            title={payoutTitle}
            showProcessorFee={pricingBreakdownInput.showPaymentProcessorFee}
            chargeLabel={t("bdTotalCharged", { defaultValue: "Total charged" })}
            processingFeeLabel={pricingBreakdownInput.paymentProcessorFeeIsEstimate ? t("bdEstProcessingFee", { defaultValue: "Est. processing fee" }) : t("bdProcessingFee")}
            platformFeeLabel={t("bdLocalCooksServiceFee", { percent: Math.round((pricingBreakdownInput.platformFeeRate || 0) * 100), defaultValue: "Service fee ({percent}%)" })}
            platformFeeChefPaidLabel={t("wfbChefServiceFee")}
            platformFeeInfo={<ServiceFeeInfoPopover iconClassName="h-3 w-3" />}
            refundLabel={t("bdKitchenRefundShare")}
            hstLabel={t("bdHstPercent", { percent: pricingBreakdownInput.kitchenHstRatePercent ?? 0 })}
            hstCollectedLabel={t("bdHstCollectedLine")}
          />
          )
        ) : (
          <ChefBookingReceiptBreakdown
            {...pricingBreakdownInput}
            currency={booking.currency || "CAD"}
            totalLabel={chefTotalLabel}
            platformFeeLabel={t("bdLocalCooksServiceFee", { percent: Math.round((pricingBreakdownInput.platformFeeRate || 0) * 100), defaultValue: "Service fee ({percent}%)" })}
          />
        )
      )}
    </>)}
    {!statement && extraCharges.length > 0 && paymentHeadline && (
      <div className="space-y-2 border-t pt-3" data-testid="extra-charges">
        {extraCharges.map(line => (
          <div key={line.id} className="flex justify-between gap-3 text-sm" data-testid="extra-charge-line">
            <span className="text-muted-foreground">{line.kind === 'damage_claim' ? t('bnChargeDamage')
              : line.kind === 'kitchen_change' ? t('bnChargeBookingChange')
              : line.kind === 'extra_time' ? t('bnChargeExtraTime')
              : line.minutes ? t('bnChargeExtension', { length: formatBookedDuration(line.minutes, lang) }) : t('bnChargeExtensionNoLength')}
              {line.refundedCents > 0 && <span className="block text-xs">{t('bnChargeRefunded', { amount: formatCurrency(line.refundedCents) })}</span>}</span>
            <span className="tabular-nums">{formatCurrency(extraCents(line))}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3 text-sm font-medium" data-testid="extra-charges-total">
          <span>{isManagerView ? t('bnPayoutAllCharges') : t('bnPaidAllCharges')}</span>
          <span className="tabular-nums">{formatCurrency(paymentHeadline.cents)}</span>
        </div>
        <p className="text-xs text-muted-foreground">{isManagerView ? t('bnExtraStatementNote') : t('bnExtraReceiptsNote')}</p>
      </div>
    )}
    {!statement && !isManagerView && goodwillRefund > 0 && (
      <div className="flex items-center justify-between gap-2 text-sm text-warning" data-testid="goodwill-line">
        <span>{t("bdGoodwillLine", { amount: formatCurrency(goodwillRefund) })}</span>
      </div>
    )}
    {!statement && !isManagerView && refundAmount + extraRefundedCents - goodwillRefund > 0 && (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1 text-warning">
          {t("bdRefundedLine")}
          <StripeProcessingFeeRefundInfo iconClassName="h-3 w-3" beforeConfirmation={booking.status === 'pending'} />
        </span>
        <span className="tabular-nums text-warning">−{formatCurrency(refundAmount + extraRefundedCents - goodwillRefund)}</span>
      </div>
    )}
  </>);

  const statusSource = booking ? paymentStatusSource({ manager: isManagerView, payoutAfterVisit: booking.payout?.timing === 'after_closeout', paymentStatus: booking.paymentStatus, bookingStatus: booking.status }) : 'message';
  const downloadInNow = visibleKeys.has('download_invoice') || visibleKeys.has('download_payout_statement');
  const paymentCard = booking && (
    <BookingPaymentCard
      title={t('bdPaymentSection')}
      headline={paymentHeadline ? { label: paymentHeadline.label, amount: formatCurrency(paymentHeadline.cents) } : null}
      refundRequest={isManagerView ? <RefundRequestStatus request={booking.paymentTransaction?.metadata?.fullRefundRequest} /> : undefined}
      // While the chef answers a new total, the payout (and when it's sent) isn't known yet.
      payoutLine={statusSource === 'payout' && booking.payout && !proposal ? <KitchenPayoutStatus variant="line" payout={booking.payout} timezone={booking.location?.timezone} currency={booking.currency || 'CAD'} chefName={chefName}
        stage={['cancelled', 'no_show', 'no_checkin', 'issue', 'completed', 'pending', 'cancellation_requested'].includes(phase) ? 'closed' : ['checkout_review', 'visit_ended'].includes(phase) ? (inspectionCanRespond ? 'inspect' : 'closed') : 'before_checkout'} /> : undefined}
      status={paymentMessage}
      moreInfoLabel={t('bdPaymentMoreInfo', { defaultValue: 'More about payment status' })}
      pendingDecision={booking.paymentDecision?.state === 'pending' ? <p>{t('bdRecordedDecisionAmount', { amount: formatCurrency(booking.paymentDecision.amount || 0) })}</p> : undefined}
      breakdown={breakdown}
      breakdownOpen={!paymentHeadline}
      breakdownLabels={{ show: t('bdhShowBreakdown'), hide: t('bdhHideBreakdown') }}
      actions={((canDownload && !downloadInNow) || showRefundReview || bookingDocuments) ? <>
        {bookingDocuments && <BookingReceipts data={bookingDocuments} role={isManagerView ? 'manager' : 'chef'} timezone={booking.location?.timezone || undefined}
          formatCurrency={formatCurrency} onError={message => toast({ title: t('bdDownloadFailedTitle'), description: message, variant: 'destructive' })} />}
        {canDownload && !downloadInNow && !bookingDocuments && (
          <Button onClick={handleDownloadInvoice} disabled={isDownloading} variant="outline" className="min-h-11 w-full">
            {isDownloading ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />{t("bdGenerating")}</> : <><Download className="mr-1.5 h-4 w-4" />{downloadLabel}</>}
          </Button>
        )}
        {showRefundReview && (
          <button type="button" className="min-h-11 text-left text-[13px] font-medium underline underline-offset-4" onClick={() => { setCancellationRefundScope(undefined); setCancellationRefundOpen(true); }}>{t('detailsCopy17')}</button>
        )}
      </> : undefined}
    />
  );

  const cancellationCard = booking && !isManagerView && (chefCanCancel || datedBooking) && ['pending', 'confirmed'].includes(booking.status) && (
    <BookingCancellationCard multiDay={datedBooking} frozenPolicy={booking.cancellationPolicySnapshot} createdAt={booking.createdAt} bookingId={booking.id} status={booking.status} canCancel={chefCanCancel} onCancel={() => setCancelOpen(true)}
      onChange={booking.status === 'confirmed' && !visitStarted ? () => setChangeOpen(true) : undefined}
      deadlineText={cancellationDeadlineText} deadlinePassed={!paidCancellationAvailable}
      extraTimeNote={Number(booking.extraTimeRateCents) > 0 ? bt('bpsExtraTimeRate', { amount: formatCurrency(booking.extraTimeRateCents) }) : undefined} />
  );

  const history = booking && (
    <BookingHistoryPanel timezone={booking.location?.timezone} id={booking.id} reference={booking.referenceCode} role={isManagerView ? 'manager' : 'chef'} cancelCause={cancelCause} chefName={booking.chef?.fullName || booking.chef?.username || null} version={booking.updatedAt || booking.createdAt} limit={3} days={bookingDays} />
  );

  const help = booking && (
    <Card id="booking-support" className={`scroll-mt-24 ${cardClass}`}>
      <h2 className={`${headingClass} mb-2`}>{t('bdContactSupport', { defaultValue: 'Contact Local Cooks' })}</h2>
      <p className="text-[13px] leading-[18px] text-muted-foreground">{t('bdContactSupportHint', { defaultValue: 'Need help with your booking or payment?' })}</p>
      <div className="mt-3 space-y-1 text-sm">
        <a className="flex min-h-11 min-w-0 items-center gap-2 text-foreground underline-offset-4 hover:underline" href={localCooksSupportHref({ bookingId: booking.id, bookingReference: booking.referenceCode, role: isManagerView ? "manager" : "chef", situation: "Booking or payment help" })}><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-all">support@localcooks.ca</span></a>
        <a className="flex min-h-11 items-center gap-2 text-foreground underline-offset-4 hover:underline" href="tel:+17096318480"><Phone className="h-4 w-4 shrink-0 text-muted-foreground" />+1 (709) 631-8480</a>
      </div>
      <CommitmentProblems kind="booking" id={booking.id} role={isManagerView ? 'manager' : 'chef'} canReport embedded
        intent={!isManagerView && iWasThereOpen ? { openToken: iWasThereOpen, title: t('bnIWasThereTitle'), hint: t('bnIWasThereHint', { kitchen: kitchenName }), label: t('bnIWasThereLabel'), category: 'attendance' } : undefined} />
    </Card>
  );

  const bookingContent = booking && (
    <TooltipProvider>
    <div className={`mx-auto min-w-0 max-w-[1080px] ${hasBottomBar ? 'pb-28 sm:pb-0' : ''}`}>
      <KitchenCausedCancellation bookingId={booking.id} open={kitchenCancelOpen} onOpenChange={setKitchenCancelOpen} onChanged={reloadBookingDetails} />
      <CancellationRefundReview bookingId={booking.id} manager={isManagerView} scope={cancellationRefundScope} open={cancellationRefundOpen} onOpenChange={setCancellationRefundOpen} onChanged={reloadBookingDetails} />
      {isManagerView && claimWindowOpen && <ManagerDamageClaimEntry mode="secondary" open={claimOpen} onOpenChange={setClaimOpen} bookingId={booking.id} chefName={chefName}
        visits={unreportedVisits} onFiled={() => void claimsQuery.refetch()} />}
      {!isManagerView && booking.status === 'confirmed' && (
        <ChangeBookingDialog bookingId={booking.id} kitchenId={booking.kitchenId} kitchenName={kitchenName} timezone={booking.location?.timezone}
          open={changeOpen} onOpenChange={setChangeOpen} onChanged={async () => { setChangesVersion(v => v + 1); await reloadBookingDetails(); await queryClient.invalidateQueries(); }} />
      )}
      {!isManagerView && (
        <BookingCancellationChooser hideTrigger open={cancelOpen} onOpenChange={setCancelOpen} visitActive={visitActive} bookingId={booking.id} status={booking.status} paymentStatus={booking.paymentStatus}
          summary={{ kitchenName, reference: booking.referenceCode || undefined,
            schedule: datedBooking && bookingDays.length
              ? daySpan
              : `${formatDate(bookingStartDateKey(booking) ?? booking.bookingDate)}\n${bookingTimeSlots.join(', ')} · ${friendlyTimezoneName(booking.location?.timezone, i18n.language)}`,
            // Everything the chef paid on this booking (a paid change is its own charge), as the page's "Total paid".
            amount: booking.paymentTransaction ? formatCurrency(booking.paymentTransaction.amount + extraTotalCents) : undefined }}
          cancellationDeadline={cancellationDeadlineText}
          decisionPending={booking.paymentDecision?.state === 'pending'} declined={!!booking.cancellationRequestDeclinedAt}
          paidCancellationAvailable={paidCancellationAvailable}
          visits={booking.visits} scheduleRevision={booking.scheduleRevision ?? 0} dayMoney={booking.dayMoney}
          items={[...(booking.storageBookings || []).map(item => ({ id: item.id, kind: 'storage' as const,
            name: item.storageListing?.name || `Storage #${item.id}`, status: item.status, dates: `${formatShortDate(item.startDate)} – ${formatShortDate(item.endDate)}` })),
            ...allEquipmentBookings.map(item => ({ id: item.id, kind: 'equipment' as const,
              name: item.equipmentListing?.equipmentType || `Equipment #${item.id}`, status: item.status,
              ...(datedBooking ? { dates: (day => day?.visitDate ? formatShortDate(day.visitDate) : undefined)(bookingDays.find(visit => visit.id === (item as { kitchenBookingVisitId?: number | null }).kitchenBookingVisitId)) } : {}) }))]}
          onChanged={async () => { await reloadBookingDetails(); await queryClient.invalidateQueries(); }} />
      )}

      {/* Wide screens: the Now card, then a main column and a sidebar of at most three cards. Narrow: one column in §2.1 order. */}
      <div className="space-y-5">
        {nowCard}
        {/* A pending request's days are listed once, in the review above; day cards (check-in, payouts) start once it's accepted. */}
        {datedBooking && booking && !(isManagerView && booking.status === 'pending') && (isManagerView ? <ManagerBookingDays bookingId={booking.id} revision={booking.scheduleRevision!} visits={bookingDays} money={booking.dayMoney} payout={booking.payout}
          timezone={booking.location?.timezone || 'America/St_Johns'} status={booking.status} onChanged={reloadBookingDetails} />
          : <BookingDayList bookingId={booking.id} visits={bookingDays} timezone={booking.location?.timezone || 'America/St_Johns'} status={booking.status} money={booking.dayMoney}
            notOffered={proposal?.declinedVisitIds} />)}
        {wide ? (
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-2 min-w-0 space-y-5">{visitRecord}{feedback}{personCard}{addOns}{note}{history}</div>
            <div className="min-w-0 space-y-5">{paymentCard}{cancellationCard}{help}</div>
          </div>
        ) : (
          <div className="space-y-4">{paymentCard}{visitRecord}{feedback}{personCard}{addOns}{note}{cancellationCard}{history}{help}</div>
        )}
      </div>

      {/* ── Mobile: primary + Message stay in reach (on narrow screens the primary lives here, not in the card) ── */}
      {hasBottomBar && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/80 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-md sm:hidden" role="region" aria-label={t('bdhMobileActions')} data-testid="mobile-action-bar">
          <div className="mx-auto flex max-w-md gap-2">
            {messageButton('flex-1')}
            {narrow && primaryButton('mobile-primary-action', 'flex-1')}
            {narrow && claimTakesPrimary && payableClaim && (
              <Button type="button" className="min-h-11 flex-1" data-testid="mobile-primary-action" data-primary-action="true" onClick={() => setPayingClaimId(payableClaim.id)}>
                {bt('dcV2Pay', { amount: formatCurrency(payableClaim.amountCents) })}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );

  const bookingBreadcrumbs = useMemo(
    () => [
      {
        label: t("shellMyBookings"),
        onClick: () => navigate("/dashboard?view=bookings"),
        navId: "bookings" as const,
      },
      { label: booking ? t("bdBookingRef", { id: booking.id }) : t("bdBookingDetails") },
    ],
    [t, navigate, booking]
  );

  const inShell = useChefShellChrome({
    activeView: "bookings",
    onViewChange: handleViewChange,
    breadcrumbs: bookingBreadcrumbs,
  });

  // Render with appropriate layout
  if (isManagerView) {
    return (
      <ManagerBookingLayout
        bookingLocationId={booking?.location?.id ?? booking?.kitchen?.locationId ?? null}
        breadcrumbs={[
          { label: t("bkMyBookings"), onClick: () => window.history.back() },
          { label: booking ? t("bdBookingRef", { id: booking.id }) : t("bdBookingDetails") }
        ]}
      >
        {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
        <BookingActionDialog
          open={actionDialogOpen}
          onOpenChange={setActionDialogOpen}
          booking={bookingForAction}
          isLoading={isUpdatingStatus}
          onSubmit={handleApprovalSubmit}
        />
        <BookingManagementDialog
          open={managementDialogOpen}
          onOpenChange={(open) => {
            setManagementDialogOpen(open);
          }}
          booking={bookingForManagement}
          mode={booking?.status === 'confirmed' ? 'change' : 'manage'}
          isProcessing={isManagementProcessing}
          onSubmit={handleManagementSubmit}
          onChanged={reloadBookingDetails}
        />
      </ManagerBookingLayout>
    );
  }

  const chefBody = (
    <>
      {isLoading ? loadingContent : (error || !booking) ? errorContent : bookingContent}
    </>
  );

  if (inShell) return chefBody;

  return (
    <ChefDashboardLayout
      activeView="bookings"
      onViewChange={handleViewChange}
      breadcrumbs={bookingBreadcrumbs}
    >
      {chefBody}
    </ChefDashboardLayout>
  );
}
