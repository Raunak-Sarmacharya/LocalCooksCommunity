import { ct } from '@/i18n/chef-ns';
import { ClockCloseoutSummary } from "@/components/booking/ClockCloseoutSummary";
import { bookingStatusLabel } from "@/components/booking/booking-status-label";
import { CancellationRefundReview } from '@/components/booking/CancellationRefundReview';
import BookingPreparation from "@/components/booking/BookingPreparation";
import { KitchenBookingChanges } from '@/components/booking/KitchenBookingChanges';
import { BookingCancellationChooser } from '@/components/booking/BookingCancellationChooser';
import { BookingRefundPolicyNotice } from '@/components/booking/BookingRefundPolicyNotice';
import { BookingHistoryPanel } from '@/components/booking/BookingHistoryPanel';
import { BookingFeedbackCard } from '@/components/booking/BookingFeedbackCard';
import { CommitmentProblems } from '@/components/support/CommitmentProblems';
import { bookingChangeSchedule, kitchenRescheduleCutoff } from '@shared/kitchen-booking-change';
import { StorageIcon as Package, EquipmentIcon as Wrench } from "@/components/ui/inventory-icons";
import { logger } from "@/lib/logger";
import { calendarDateForBookingTime, getHourlySlotStarts, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { useState, useEffect, useMemo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { formatTime as formatKitchenClock } from "@/lib/formatters";
import { useLocation, useRoute } from "wouter";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import ManagerBookingLayout from "@/layouts/ManagerBookingLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { InfoChip } from "@/components/chef/info-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatPhoneForDisplay, normalizePhoneNumber } from "@shared/phone-validation";
import { ArrowLeft, MapPin, FileText, Download, Loader2, CheckCircle2, XCircle, AlertCircle, Phone, Mail, Receipt, Info, LogIn, LogOut, Camera, FileWarning, Clock, MoreHorizontal, MessageSquare, CalendarPlus, CalendarX, ClipboardCheck, LifeBuoy } from "lucide-react";
import { arrivalRecorded, bookingHeaderPhase, bookingPillTone, bookingPrimaryAction, canCancelOrChange, canMessage, contactVisible, initials, sentence, timeRange, type BookingHeaderPhase } from "@/lib/booking-header-state";
import { bookingCancelCause } from '@/lib/booking-cancel-cause';
import { bookingReference } from '@/lib/booking-reference';
import { calendarDateKey } from '@/lib/calendar-date';
import { bookingIcs, downloadBookingIcs } from "@/lib/booking-ics";
import { buildChefBookingReceiptBreakdown, buildKitchenPayoutStatementBreakdown } from "@shared/booking-pricing-breakdown";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { BookingActionDialog, type BookingForAction } from "@/components/manager/bookings/BookingActionDialog";
import { BookingManagementDialog, type BookingForManagement, type ManagementSubmitParams } from "@/components/manager/bookings/BookingManagementDialog";
import { BookingAttendancePanel } from "@/components/booking/BookingAttendancePanel";
import { VisitCodePanel } from "@/components/manager/bookings/VisitCodePanel";
import { ManagerInSessionBadge, inSessionEnds } from "@/components/manager/bookings/ManagerInSessionBadge";
import { bookingResponseDeadline, formatResponseDeadline } from '@/lib/booking-response-deadline';
import { createBookingDateTime, friendlyTimezoneName } from '@shared/timezone-utils';
import { StripeProcessingFeeRefundInfo } from "@/components/booking/StripeProcessingFeeRefundInfo";
import { ServiceFeeInfoPopover } from "@/components/booking/ServiceFeeInfoPopover";
import { SmartImage } from "@/components/ui/smart-image";
import { tt } from "@/i18n/common-ns";
import { mt } from "@/i18n/manager";
import { ChefBookingReceiptBreakdown, KitchenPayoutStatementBreakdown } from "@/components/booking/BookingPricingBreakdown";
import { CheckinPolicyTimesCard } from "@/components/booking/CheckinPolicyTimesCard";
import { RefundRequestStatus, type FullRefundRequest } from "@/components/booking/RefundRequestStatus";

interface BookingDetails {
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
  paymentDecision?: { state?: string; amount?: number; target?: string; actorId?: number | null } | null;
  cancellationPolicyHours?: number;
  cancellationRequestDeclinedAt?: string | null;
  specialNotes?: string;
  totalPrice?: number;
  hourlyRate?: number;
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
    status: string;
    stripeProcessingFee?: number;
    /** Pre-capture estimate from platform_settings (when stripeProcessingFee is 0) */
    estimatedStripeProcessingFee?: number;
    estimatedManagerPayout?: number;
    paidAt?: string;
    refundAmount?: number;
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
  visits?: Array<{ id: number; updatedAt: string; blockIndex: number; startTime: string; endTime: string; checkinStatus: string; checkedInAt: string | null; checkoutRequestedAt: string | null; checkedOutAt: string | null; checkoutApprovedAt: string | null; noShowDetectedAt: string | null; checkoutManagerMessage?: string | null }>;
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
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [cancellationRefundScope, setCancellationRefundScope] = useState<{ kind: 'storage' | 'equipment'; id: number } | undefined>();
  const [cancellationRefundOpen, setCancellationRefundOpen] = useState(false);
  const [managementDialogOpen, setManagementDialogOpen] = useState(false);
  const [isManagementProcessing, setIsManagementProcessing] = useState(false);
  const [itemCancellationPending, setItemCancellationPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [codeShowsArrival, setCodeShowsArrival] = useState(false);
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
        });

        if (!response.ok) {
          // A manager who opened a chef link (e.g. a shared URL) belongs on the manager page for this booking.
          if (!isManagerView && (response.status === 403 || response.status === 404)) {
            const asManager = await fetch(`/api/manager/bookings/${bookingId}/details`, { credentials: "include", headers }).catch(() => null);
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
      const response = await fetch(endpoint, { credentials: "include", headers });
      if (!response.ok) return;
      const data = await response.json();
      setBooking(data);
    } catch (err) {
      logger.error("Error reloading booking details:", err);
    }
  };

  const reviewEquipmentCancellation = async (id: number, accept: boolean) => {
    if (!booking || !isManagerView) return;
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

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00Z` : dateStr);
    return date.toLocaleDateString(i18n.language, {
      timeZone: booking?.location?.timezone || undefined,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatEventTimestamp = (dateStr: string) => new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short', hour12: true,
    timeZone: booking?.location?.timezone || undefined,
  }).format(new Date(dateStr));

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
  const responseDeadlineText = responseDeadline ? formatResponseDeadline(responseDeadline, i18n.language, booking?.location?.timezone || undefined) : null;

  const paymentMessage = (() => {
    if (!booking) return null;
    if (booking.paymentDecision?.state === 'pending') return { summary: t('bdPaymentRecovery'), detail: t('bdPaymentRecovery') };
    const status = booking.paymentStatus;
    if (status === 'authorized') return { summary: isManagerView ? t('bdPaymentHeldSummaryManager') : t('bdPaymentHeldSummary', { defaultValue: 'Your payment is on hold.' }), detail: t(isManagerView ? 'bdPaymentHeldManager' : 'bdPaymentHeldChef') };
    if (status === 'failed' && booking.status === 'cancelled') return { summary: isManagerView ? t('bdAuthVoidedSummaryManager') : t('bdAuthVoidedSummary', { defaultValue: 'Your payment hold was released.' }), detail: t(isManagerView ? 'bdAuthVoidedManager' : 'bdAuthVoidedChef') };
    if (status === 'refunded' || status === 'partially_refunded') return {
      summary: status === 'refunded' ? t('bdRefundedSummary', { defaultValue: 'Your payment was refunded.' }) : t('bdPartialRefundSummary', { defaultValue: 'Part of your payment was refunded.' }),
      detail: `${booking.paymentTransaction?.refundAmount ? (isManagerView ? t('bdRefundedToChef', { amount: formatCurrency(booking.paymentTransaction.refundAmount) }) : t('bdRefundedYou', { amount: formatCurrency(booking.paymentTransaction.refundAmount) })) : t('bdRefundAmountUnavailable', { defaultValue: 'The refund amount is not yet available.' })}${booking.paymentTransaction?.refundedAt ? ` ${t('bdRefundedOn', { date: formatShortDate(booking.paymentTransaction.refundedAt) })}` : ''}${booking.paymentTransaction?.refundReason && isManagerView ? ` ${t('bdRefundReason', { reason: booking.paymentTransaction.refundReason })}` : ''}`,
    };
    if (status === 'paid' && booking.status === 'cancelled') return { summary: t('bdCancelledPaidSummary', { defaultValue: 'Your booking was cancelled after payment.' }), detail: t(isManagerView ? 'bdBookingCancelledManager' : 'bdBookingCancelledChef') };
    if (status === 'paid') return { summary: isManagerView ? t('bdPaidSummaryManager') : t('bdPaidSummary', { defaultValue: 'Your payment was collected.' }), detail: t('bdPaymentCapturedInfo', { defaultValue: 'Your payment has been captured for this booking.' }) };
    if (status === 'processing') return { summary: t('bdProcessingSummary', { defaultValue: 'Your payment is processing.' }), detail: t('bdPaymentProcessingInfo', { defaultValue: 'Your payment is being processed. This page will show the final status once it is available.' }) };
    if (status === 'pending') return { summary: t('bdPendingSummary', { defaultValue: 'Your payment is pending.' }), detail: t('bdPaymentPendingInfo', { defaultValue: 'Payment has not been completed yet.' }) };
    if (status === 'failed') return { summary: t('bdPaymentFailedInfo', { defaultValue: 'Payment failed.' }), detail: t('bdPaymentFailedDetail', { defaultValue: 'The payment could not be completed. Contact Local Cooks if you need help.' }) };
    if (status === 'canceled') return { summary: t('bdCanceledSummary', { defaultValue: 'Your payment was canceled.' }), detail: t('bdPaymentCanceledInfo', { defaultValue: 'The payment was canceled before it was completed.' }) };
    return { summary: t('bdUnknownPaymentSummary', { defaultValue: 'Payment status is unavailable.' }), detail: t('bdUnknownPaymentDetail', { defaultValue: 'Contact Local Cooks if you need help with this payment.' }) };
  })();

  const calculateDuration = () => {
    if (!booking) return 0;
    if (booking.durationHours) return booking.durationHours;
    if (booking.selectedSlots && booking.selectedSlots.length > 0) {
      return booking.selectedSlots.length;
    }
    return getHourlySlotStarts(booking.startTime, booking.endTime).length;
  };

  // ── Payment state helpers ─────────────────────────────────────────────────
  // VOID = auth was cancelled before capture (paymentStatus='failed') — never charged
  // REFUND = payment was captured then refunded (paymentStatus='refunded') — money returned
  const isRefunded = booking?.paymentStatus === 'refunded';
  const isPartiallyRefunded = booking?.paymentStatus === 'partially_refunded';
  const hasRefund = isRefunded || isPartiallyRefunded;
  const refundAmount = booking?.paymentTransaction?.refundAmount || 0;

  // Helper: item was voided (never charged — exclude from totals)
  const isItemVoided = (item: { paymentStatus?: string; status: string }) =>
    item.paymentStatus === 'failed';

  // Helper: item was refunded (was charged, then money returned — include in totals, show as refunded)
  const isItemRefunded = (item: { paymentStatus?: string; status: string }) =>
    item.paymentStatus === 'refunded' && item.status === 'cancelled';


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
    const equipmentTotal = booking.equipmentBookings?.reduce((sum, e) => {
      if (e.paymentStatus === 'failed') return sum; // Voided — never charged
      return sum + (e.totalPrice || 0);
    }, 0) || 0;

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
      refundAmountCents: booking.paymentTransaction?.refundAmount || 0,
      hourlyRateCents: booking.hourlyRate,
      bookedHours: booking.durationHours,
      showPaymentProcessorFee: stripeFee > 0,
      paymentProcessorFeeIsEstimate: feesAreEstimated,
      showPlatformFeeLine: serviceFee > 0,
    };
  }, [booking, totals]);

  // Show ALL storage/equipment bookings including rejected ones for full audit trail
  const allStorageBookings = booking?.storageBookings || [];
  const allEquipmentBookings = booking?.equipmentBookings || [];

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
    transactionAmount: booking.paymentTransaction?.amount,
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
      })),
    paymentStatus: booking.paymentStatus,
  } : null;

  const handleApprovalSubmit = async (params: {
    bookingId: number;
    status: 'confirmed' | 'cancelled';
    storageActions?: Array<{ storageBookingId: number; action: string }>;
    equipmentActions?: Array<{ equipmentBookingId: number; action: string }>;
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
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update booking`);
      }

      const responseData = await response.json().catch(() => ({}));

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
        (booking.paymentTransaction?.refundAmount || 0),
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
            const refundRes = await fetch(
              `/api/manager/revenue/transactions/${bookingForManagement.transactionId}/refund`,
              {
                method: 'POST', headers, credentials: "include",
                body: JSON.stringify({
                  amount: params.refundAmountCents,
                  reason: ct('sweepText34'),
                }),
              },
            );
            if (!refundRes.ok) {
              const d = await refundRes.json().catch(() => ({}));
              throw new Error(d.error || t('detailsCopy12'));
            }
            toast({
              title: t("bdItemsCancelledToast"),
              description: t("bdRefundProcessedDesc", {
                amount: `$${(params.refundAmountCents / 100).toFixed(2)}`,
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
                reason: ct('sweepText35'),
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
  const itemChip = (item: { status: string; paymentStatus?: string }, storage: boolean) => {
    const voided = isItemVoided(item), refunded = isItemRefunded(item);
    if (storage && item.status === 'completed') return <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>{cap(t('bdStatusCleared'))}</InfoChip>;
    if (refunded) return <InfoChip variant="warning" icon={<Receipt className="h-2.5 w-2.5" />}>{cap(t('bdStatusRefunded'))}</InfoChip>;
    if (voided) return <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>{cap(t('bdStatusNotCharged'))}</InfoChip>;
    if (item.status === 'cancelled') return <InfoChip variant="outline" icon={<XCircle className="h-2.5 w-2.5" />}>{cap(t('bdStatusCancelled'))}</InfoChip>;
    if (item.status === 'confirmed' || item.status === 'active') return <InfoChip variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>{cap(t('bdStatusConfirmed'))}</InfoChip>;
    return <InfoChip variant="warning" icon={<AlertCircle className="h-2.5 w-2.5" />}>
      {item.status === 'pending' ? cap(t('bdStatusPending')) : item.status === 'expired' ? cap(t('bdStatusExpired')) : bookingStatusLabel(item.status, t)}
    </InfoChip>;
  };
  const payoutTitle = booking?.paymentStatus === 'authorized' ? t('bdEstimatedPayout', { defaultValue: 'Estimated payout' }) : t('bdYourPayout', { defaultValue: 'Your payout' });
  const chefTotalLabel = booking?.paymentStatus === 'authorized' ? t('bdAmountAuthorized') : t('bdAmountCharged');
  // Headline figure reuses the same shared breakdown builders the itemized list renders (display only).
  const paymentHeadline = (() => {
    if (!booking?.paymentTransaction || !pricingBreakdownInput || booking.paymentDecision?.state === 'pending'
      || (booking.paymentStatus === 'failed' && booking.status === 'cancelled')) return null;
    if (isManagerView) return { label: payoutTitle, cents: buildKitchenPayoutStatementBreakdown(pricingBreakdownInput).kitchenNetPayoutCents, struck: false };
    return { label: booking.paymentStatus === 'authorized' ? t('bdhOnHold') : t('bdhTotalPaid'), cents: buildChefBookingReceiptBreakdown(pricingBreakdownInput).totalPaidCents, struck: false };
  })();
  const renderChefCheckinPolicy = (startTime: string) => {
    if (!booking || isManagerView || booking.checkinWindowMinutesBefore == null || booking.noShowGraceMinutes == null) return null;
    return (
      <CheckinPolicyTimesCard
        className="border-t pt-4"
        showIntro={false}
        layout="responsive"
        bookingDate={booking.bookingDate}
        startTime={startTime}
        operatingWindowStartTime={booking.operatingWindowStartTime || booking.startTime}
        timezone={booking.location?.timezone}
        checkinWindowMinutesBefore={booking.checkinWindowMinutesBefore}
        noShowGraceMinutes={booking.noShowGraceMinutes}
      />
    );
  };

  // Main booking content
  const hasMultipleVisits = (booking?.visits?.length ?? 0) > 1;
  const tz = booking?.location?.timezone || undefined;
  const lang = i18n.language;
  const inspectionDue = booking?.closeout?.visits?.[0]?.inspection?.deadline;
  const inspectionDueText = inspectionDue ? formatEventTimestamp(inspectionDue) : null;
  const inspectionCanRespond = !!booking?.closeout?.visits?.some(visit => visit.inspection.canRespond);
  // The kitchen's review window is still open (due or not yet due).
  const inspectionOpen = !!booking?.closeout?.visits?.some(visit => ['not_due', 'due'].includes(visit.inspection.outcome));
  const visitBounds = (() => {
    if (!booking || !tz) return null;
    try {
      const day = booking.bookingDate.split('T')[0];
      const startAt = createBookingDateTime(calendarDateForBookingTime(day, booking.startTime, booking.operatingWindowStartTime), booking.startTime, tz);
      const endAt = createBookingDateTime(calendarDateForBookingTime(day, booking.endTime, booking.operatingWindowStartTime, booking.startTime), booking.endTime, tz);
      return { startAt, endAt, opensAt: new Date(startAt.getTime() - (booking.checkinWindowMinutesBefore ?? 15) * 60_000) };
    } catch { return null; }
  })();
  const phase: BookingHeaderPhase = booking ? bookingHeaderPhase({
    status: booking.status, checkinStatus: booking.checkinStatus, visits: booking.visits, closeoutPhase: booking.closeout?.phase,
    inspectionCanRespond, startAt: visitBounds?.startAt, endAt: visitBounds?.endAt, checkinOpensAt: visitBounds?.opensAt, timezone: tz,
  }) : 'confirmed';
  const primary = bookingPrimaryAction(phase, isManagerView, inspectionCanRespond);
  const cancelCause = booking ? bookingCancelCause({ status: booking.status, chefId: booking.chefId, paymentDecision: booking.paymentDecision }) : null;
  const findAnotherTimeHref = booking && !isManagerView && cancelCause === 'declined' && (booking.location?.id ?? booking.kitchen?.locationId)
    ? `/book/${booking.location?.id ?? booking.kitchen?.locationId}?kitchenId=${booking.kitchenId}` : null;
  const chefName = booking?.chef?.fullName || booking?.chef?.username || t('bdhChefFallback');
  const kitchenName = booking?.kitchen?.name || t('bdKitchenBookingFallback');
  const visitActive = !!booking && (['checked_in', 'checkout_requested'].includes(booking.checkinStatus || '') || (booking.visits || []).some(visit => ['checked_in', 'checkout_requested'].includes(visit.checkinStatus)));
  const visitStarted = !!booking && (['in_booked_time', 'booked_time_ended', 'ended'].includes(booking.closeout?.phase || '')
    || ![null, undefined, '', 'not_checked_in'].includes(booking.checkinStatus) || booking.status === 'completed'
    || (booking.visits || []).some(visit => visit.checkinStatus !== 'not_checked_in'));
  const visitOver = ['checkout_review', 'visit_ended', 'completed', 'no_show', 'issue'].includes(phase);
  const shortWhen = (value: Date | string) => {
    try { return new Intl.DateTimeFormat(lang, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value)); }
    catch { return ''; }
  };
  const clockTime = (value: Date | string) => {
    try { return new Intl.DateTimeFormat(lang, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value)); }
    catch { return ''; }
  };
  const cancellationCutoff = (() => {
    if (!booking) return null;
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

  const nextStep = (() => {
    if (!booking) return '';
    const chef = chefName;
    switch (phase) {
      case 'pending':
        if (responseDeadlineText) return isManagerView ? t('bdManagerRespondBy', { deadline: responseDeadlineText }) : t('bdRequestSentBanner', { kitchen: kitchenName, deadline: responseDeadlineText });
        return isManagerView ? t('bdhNextManagerPending') : t('bdhNextChefPending', { kitchen: kitchenName });
      case 'cancellation_requested': return isManagerView ? t('bdhNextManagerCancellationRequested', { chef }) : t('cancelCopy07');
      case 'cancelled':
        if (cancelCause === 'declined' || cancelCause === 'expired' || cancelCause === 'withdrawn') {
          return t(`bdhNext${isManagerView ? 'Manager' : 'Chef'}_${cancelCause}`, { chef, kitchen: kitchenName });
        }
        return isManagerView ? t('bdhNextManagerCancelled') : t('bdhNextChefCancelled');
      case 'confirmed': case 'today': {
        if (isManagerView) return phase === 'today' && visitBounds ? t('bdhNextManagerToday', { chef, time: clockTime(visitBounds.startAt) }) : t('bdhNextManagerUpcoming', { chef });
        const releaseAt = booking.location?.instructionsReleaseAt;
        if (booking.location?.instructionsReleased === false && releaseAt && Date.parse(releaseAt) > Date.now()) return t('bdhNextChefDetailsAt', { time: shortWhen(releaseAt) });
        return visitBounds ? t('bdhNextChefDetailsReady', { time: shortWhen(visitBounds.opensAt) }) : t('bdhNextChefConfirmed');
      }
      case 'checkin_open':
        if (!isManagerView) return t('bdhNextChefCheckinOpen');
        return visitBounds && Date.now() < visitBounds.startAt.getTime() ? t('bdhNextManagerToday', { chef, time: clockTime(visitBounds.startAt) }) : t('bdhNextManagerNotArrived', { chef });
      case 'in_session':
        return isManagerView ? t('bdhNextManagerInSession', { chef, time: visitBounds ? clockTime(visitBounds.endAt) : '' })
          : t('bdhNextChefInSession', { time: visitBounds ? clockTime(visitBounds.endAt) : '' });
      case 'time_ended_in_session': return isManagerView ? t('bdhNextManagerTimeEnded', { chef }) : t('bdhNextChefTimeEnded');
      case 'checkout_review':
        if (isManagerView) return inspectionDueText ? t('bdhNextManagerReviewBy', { chef, time: inspectionDueText }) : t('bdhNextManagerReview', { chef });
        return inspectionDueText && inspectionOpen ? t('bdVisitCompleteReview', { time: inspectionDueText }) : t('bdVisitComplete');
      case 'visit_ended':
        if (isManagerView) return inspectionCanRespond && inspectionDueText ? t('bdhNextManagerInspectBy', { time: inspectionDueText }) : t('bdhNextManagerMissed');
        return t('bdhNextChefMissed');
      case 'completed': return isManagerView ? t('bdhNextManagerCompleted')
        : inspectionDueText && inspectionOpen && booking.status !== 'completed' ? t('bdVisitCompleteReview', { time: inspectionDueText }) : t('bdVisitComplete');
      case 'no_show': return isManagerView ? t('bdhNextManagerNoShow') : t('kciStatusNoShow');
      case 'issue': return isManagerView ? t('bdhNextManagerIssue') : t('bdhNextChefIssue');
    }
  })();
  const pillKey = phase === 'cancelled' && (cancelCause === 'declined' || cancelCause === 'expired') ? `bdhPill_${cancelCause}`
    : phase === 'checkout_review' && !isManagerView ? 'bdhPill_checkout_submitted'
    : phase === 'checkin_open' ? 'bdhPill_today' : phase === 'time_ended_in_session' ? 'bdhPill_in_session' : `bdhPill_${phase}`;
  const pillTone = bookingPillTone(phase);
  const pillClass: Record<typeof pillTone, string> = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900', blue: 'border-sky-200 bg-sky-50 text-sky-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900', purple: 'border-violet-200 bg-violet-50 text-violet-900',
    neutral: 'border-border bg-muted text-foreground', grey: 'border-border bg-muted text-muted-foreground', red: 'border-red-200 bg-red-50 text-red-900',
  };
  const dotClass: Record<typeof pillTone, string> = {
    amber: 'bg-amber-500', blue: 'bg-sky-500', green: 'bg-emerald-500', purple: 'bg-violet-500', neutral: 'bg-foreground/60', grey: 'bg-muted-foreground', red: 'bg-red-500',
  };

  const whenLine = booking ? [
    visitBounds ? new Intl.DateTimeFormat(lang, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(visitBounds.startAt)
      : new Date(`${booking.bookingDate.slice(0, 10)}T12:00:00Z`).toLocaleDateString(lang, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }),
    timeRange(formatTime(booking.startTime), formatTime(booking.endTime)),
    t('bdHours', { count: calculateDuration() }),
    tz ? friendlyTimezoneName(tz, lang) : null,
  ].filter(Boolean).join(' · ') : '';
  const mapsHref = booking?.location?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.location.address)}` : null;

  const primaryLabel = primary === 'review_request' ? t('bdTakeAction') : primary === 'review_cancellation' ? t('bdhReviewCancellation')
    : primary === 'review_checkout' ? t('bdhReviewCheckout') : primary === 'inspect_visit' ? t('fixInspection') : primary === 'open_visit' ? (phase === 'in_session' || phase === 'time_ended_in_session' ? t('bdhCheckOut') : t('bdhOpenVisit')) : '';
  const runPrimary = () => {
    if (!booking) return;
    if (primary === 'review_request') openActionDialog();
    else if (primary === 'review_cancellation') openManagementDialog();
    else if (primary === 'review_checkout' || primary === 'inspect_visit') navigate(inspectionHref);
    else if (primary === 'open_visit') navigate(`/booking/${booking.id}/visit`);
  };
  const primaryButton = (testId: string, className?: string) => primary && (
    <Button type="button" className={className} data-testid={testId} data-primary-action="true" onClick={runPrimary}
      disabled={(primary === 'review_request' && isUpdatingStatus) || (primary === 'review_cancellation' && isManagementProcessing)}>
      {(primary === 'review_request' && isUpdatingStatus) || (primary === 'review_cancellation' && isManagementProcessing) ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
      {primaryLabel}
    </Button>
  );
  const messageAllowed = !!booking && canMessage(booking.status);
  const messageLabel = openingConversation ? t('detailsCopy18') : isManagerView ? t('detailsCopy19') : t('detailsCopy20');
  const messageButton = (className?: string) => messageAllowed && (
    <Button type="button" variant="outline" className={className} onClick={() => void openBookingConversation()} disabled={openingConversation}>
      <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden />{messageLabel}
    </Button>
  );
  const goToHelp = () => document.getElementById('booking-support')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const menuItems: Array<{ key: string; label: string; onSelect: () => void; icon: ComponentType<{ className?: string }> }> = [];
  if (chefCanCancel) menuItems.push({ key: 'cancel', label: t('bdhCancelOrChange'), icon: CalendarX, onSelect: () => setCancelOpen(true) });
  if (managerCanManage) menuItems.push({ key: 'manage', label: booking?.status === 'cancelled' ? t('bdhManageRefund') : t('bdhCancelOrChange'), icon: CalendarX, onSelect: openManagementDialog });
  if (isManagerView && visitStarted && ['confirmed', 'completed'].includes(booking?.status || '')) {
    if (primary !== 'review_checkout' && primary !== 'inspect_visit') menuItems.push({ key: 'inspect', label: t('fixInspection'), icon: ClipboardCheck, onSelect: () => navigate(inspectionHref) });
    menuItems.push({ key: 'fix', label: t('fixTitle'), icon: Wrench, onSelect: () => setFixOpen(true) });
  }
  if (canDownload) menuItems.push({ key: 'download', label: isManagerView ? t('bdDownloadPayoutStatement') : t('bdDownloadReceipt'), icon: Download, onSelect: () => void handleDownloadInvoice() });
  menuItems.push({ key: 'help', label: t('bdhGetHelp'), icon: LifeBuoy, onSelect: goToHelp });
  const hasBottomBar = !!primary || messageAllowed;

  const addToCalendar = () => {
    if (!booking || !visitBounds) return;
    const ics = bookingIcs({ uid: `booking-${booking.id}`, title: t('bdhCalendarTitle', { kitchen: kitchenName }), start: visitBounds.startAt, end: visitBounds.endAt,
      location: [booking.location?.name, booking.location?.address].filter(Boolean).join(', '), description: booking.referenceCode || undefined });
    downloadBookingIcs(`LocalCooks-${booking.referenceCode || booking.id}.ics`, ics);
  };

  const renderVisitRows = () => booking && hasMultipleVisits && (booking.status === 'confirmed' || booking.status === 'completed') && (
    <ul className="divide-y rounded-xl border" aria-label={t('bdhVisitsList')}>
      {booking.visits?.map(visit => (
        <li key={visit.id} className="space-y-1 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{t('bdVisitNumber', { number: visit.blockIndex + 1, defaultValue: `Visit ${visit.blockIndex + 1}` })}: <span className="tabular-nums">{timeRange(formatTime(visit.startTime), formatTime(visit.endTime))}</span></p>
            {getCheckinStatusBadge(visit.checkinStatus)}
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {visit.checkedInAt && <p>{t('bdCheckedInAt')}: {formatEventTimestamp(visit.checkedInAt)}</p>}
            {visit.checkoutRequestedAt && <p>{t('bdCheckoutRequested')}: {formatEventTimestamp(visit.checkoutRequestedAt)}</p>}
            {visit.checkedOutAt && <p>{t('bdCheckedOutCleared')}: {formatEventTimestamp(visit.checkedOutAt)}</p>}
            {visit.checkinStatus === 'checkout_claim_filed' && visit.checkoutApprovedAt && <p>{t('bdCiClaimFiled')}: {formatEventTimestamp(visit.checkoutApprovedAt)}</p>}
            {visit.checkoutManagerMessage && <p>{t('bookingAttendanceManagerMessage')}: {visit.checkoutManagerMessage}</p>}
            {visit.noShowDetectedAt && <p>{t('bdNoShowDetected')}: {formatEventTimestamp(visit.noShowDetectedAt)}</p>}
          </div>
          {!isManagerView && visit.checkinStatus === 'not_checked_in' && phase !== 'visit_ended' && renderChefCheckinPolicy(visit.startTime)}
        </li>
      ))}
    </ul>
  );

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
  const visitEvidence = booking && !hasMultipleVisits && (
    booking.checkinNotes || booking.checkoutNotes || booking.checkoutManagerMessage || booking.checkedInMethod
    || booking.checkinPhotoUrls?.length || booking.checkoutPhotoUrls?.length || booking.checkinChecklistItems?.length || booking.checkoutChecklistItems?.length
  ) ? (
    <details className="rounded-xl border p-3" data-testid="visit-evidence">
      <summary className="cursor-pointer text-sm font-medium">{t('bdhVisitDetails')}</summary>
      <div className="mt-3 space-y-3">
        {booking.checkedInAt && booking.checkedInMethod && (
          <p className="text-xs text-muted-foreground">{booking.checkedInMethod === 'self' ? t(isManagerView ? 'bdViaSelfManager' : 'bdViaSelf') : t('bdVia', { method: booking.checkedInMethod })}</p>
        )}
        {booking.checkinNotes && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{booking.checkedInMethod === 'self' ? t('bookingAttendanceChefMessage') : t('bookingAttendanceManagerMessage')}</p>
            <p className="whitespace-pre-wrap text-sm">{booking.checkinNotes}</p>
          </div>
        )}
        {booking.checkoutManagerMessage && <div><p className="text-xs text-muted-foreground">{t('bookingAttendanceManagerMessage')}</p><p className="whitespace-pre-wrap text-sm">{booking.checkoutManagerMessage}</p></div>}
        {booking.checkoutNotes && (
          <div className="rounded-lg border bg-muted/30 p-3">
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

  // Visit card: hidden when it could only hold an empty state (before confirmation, or a cancellation with no visit).
  const showVisitCard = !!booking && booking.status !== 'pending' && !(booking.status === 'cancelled' && !visitStarted);
  const chefBeforeArrival = !isManagerView && !!booking && ['confirmed', 'cancellation_requested'].includes(booking.status)
    && !visitStarted && phase !== 'visit_ended';
  const chefInSession = !isManagerView && (phase === 'in_session' || phase === 'time_ended_in_session');

  const sectionClass = 'rounded-2xl border bg-card p-5 sm:p-6';
  const headingClass = 'text-base font-semibold leading-6';
  const bookingContent = booking && (
    <TooltipProvider>
    <div className={`mx-auto max-w-5xl min-w-0 ${hasBottomBar ? 'pb-24 sm:pb-0' : ''}`}>
      {/* ── Header: who, when, one status, one next step, actions ── */}
      <header className={`${sectionClass} mb-6`} aria-label={t('bdhHeaderLabel')} data-testid="booking-header">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="font-mono font-medium text-foreground">{bookingReference(booking.referenceCode, booking.id)}</span>
          <span aria-hidden>·</span>
          <span>{t('bdBookedOn', { date: formatShortDate(booking.createdAt) })}</span>
        </p>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {isManagerView && (
              <Avatar className="h-12 w-12 shrink-0"><AvatarFallback className="bg-muted text-sm font-semibold">{initials(chefName)}</AvatarFallback></Avatar>
            )}
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-semibold tracking-tight" data-testid="booking-who">{isManagerView ? chefName : kitchenName}</h1>
              {isManagerView ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{t('bdhKitchenSession', { kitchen: kitchenName })}</p>
              ) : booking.location && (
                mapsHref ? (
                  <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex max-w-full items-start gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{booking.location.address}</span>
                  </a>
                ) : <p className="mt-0.5 text-sm text-muted-foreground">{booking.location.name}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex" data-testid="header-actions">
              {messageButton()}
              {primaryButton('header-primary-action')}
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10" aria-label={t('bdhMoreActions')}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {menuItems.map(item => (
                  <DropdownMenuItem key={item.key} onSelect={item.onSelect} className="gap-2">
                    <item.icon className="h-4 w-4 text-muted-foreground" />{item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="mt-4 text-base font-medium tabular-nums sm:text-lg" data-testid="booking-when">{whenLine}</p>
        <div className="mt-3 flex flex-col items-start gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${pillClass[pillTone]}`} data-testid="booking-status-pill" data-tone={pillTone}>
            <span className={`h-1.5 w-1.5 rounded-full ${dotClass[pillTone]}`} aria-hidden />{t(pillKey)}
          </span>
          <p role="status" className="text-sm leading-relaxed text-foreground/80" data-testid="booking-next-step">{sentence(nextStep)}</p>
          {findAnotherTimeHref && (
            <a href={findAnotherTimeHref} onClick={(event) => { event.preventDefault(); navigate(findAnotherTimeHref); }} className="text-sm font-medium text-foreground underline underline-offset-4" data-testid="find-another-time">{t('bdhFindAnotherTime')}</a>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <CancellationRefundReview bookingId={booking.id} manager={isManagerView} scope={cancellationRefundScope} open={cancellationRefundOpen} onOpenChange={setCancellationRefundOpen} onChanged={reloadBookingDetails} />
          <KitchenBookingChanges timezone={booking.location?.timezone} key={booking.id} bookingId={booking.id} manager={isManagerView} onChanged={async () => { await reloadBookingDetails(); await queryClient.invalidateQueries(); }} />

          {/* ── Visit ── */}
          {showVisitCard && (
            <section className={`${sectionClass} space-y-4`} aria-labelledby="booking-visit-title" data-testid="visit-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="booking-visit-title" className={headingClass}>{isManagerView ? t('bdhVisitTitle') : t('bdhYourVisitTitle')}</h2>
                {!isManagerView && primary !== 'open_visit' && ['confirmed', 'cancellation_requested'].includes(booking.status) && !visitOver && (
                  <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/booking/${booking.id}/visit`)}>{t('bdhOpenVisit')}</Button>
                )}
              </div>
              {isManagerView && inSessionEnds(booking).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {inSessionEnds(booking).map(session => {
                    const visit = session.visitId ? booking.visits?.find(row => row.id === session.visitId) : undefined;
                    return <ManagerInSessionBadge key={session.visitId ?? 'booking'} endsAt={session.endsAt} timezone={booking.location?.timezone}
                      label={visit && (booking.visits?.length || 0) > 1 ? t('bdVisitNumber', { number: visit.blockIndex + 1, defaultValue: `Visit ${visit.blockIndex + 1}` }) : undefined} />;
                  })}
                </div>
              )}
              {(visitStarted || isManagerView) && (
                <BookingAttendancePanel key={`${booking.id}-${isManagerView}`} bookingId={booking.id} manager={isManagerView} onSaved={reloadBookingDetails} timezone={booking.location?.timezone}
                  chefName={chefName} closeout={booking.closeout} embedded
                  {...(isManagerView ? { fixOpen, onFixOpenChange: setFixOpen, hideArrivalStatus: codeShowsArrival } : {})}
                  visitDetails={booking.visits?.length ? booking.visits : [{ ...booking, id: undefined }]} />
              )}
              {isManagerView && ['confirmed', 'completed'].includes(booking.status) && (
                <VisitCodePanel key={`visit-code-${booking.id}`} bookingId={booking.id} bookingStatus={booking.status} embedded onArrivalShown={setCodeShowsArrival}
                  visitEnded={visitOver || booking.closeout?.phase === 'ended'}
                  customerName={chefName} kitchenName={booking.kitchen?.name}
                  timezone={booking.location?.timezone} bookingDate={booking.bookingDate} operatingWindowStartTime={booking.operatingWindowStartTime}
                  startTime={booking.startTime} endTime={booking.endTime} visits={booking.visits} onChanged={reloadBookingDetails} />
              )}
              {chefBeforeArrival && (
                <BookingPreparation bookingStatus={booking.status} arrivalInstructions={booking.location?.arrivalInstructions}
                  instructionsReleased={booking.location?.instructionsReleased} instructionsReleaseAt={booking.location?.instructionsReleaseAt}
                  arrivalMode={booking.arrivalMode} timezone={booking.location?.timezone}
                  visitStartAt={visitBounds?.startAt ?? null} />
              )}
              {chefInSession && (
                <BookingPreparation inSession bookingStatus={booking.status} departureInstructions={booking.location?.departureInstructions}
                  instructionsReleased={booking.location?.instructionsReleased} instructionsReleaseAt={booking.location?.instructionsReleaseAt} />
              )}
              {chefBeforeArrival && !hasMultipleVisits && renderChefCheckinPolicy(booking.startTime)}
              {visitStarted && <ClockCloseoutSummary closeout={booking.closeout} manager={isManagerView} embedded hideInspectionDeadline hideFinished={chefInSession} />}
              {renderVisitRows()}
              {visitEvidence}
            </section>
          )}

          <BookingFeedbackCard bookingId={booking.id} role={isManagerView ? 'manager' : 'chef'} otherPartyName={isManagerView ? chefName : kitchenName} timezone={booking.location?.timezone || 'America/St_Johns'} />

          {/* ── When & where ── */}
          <section className={sectionClass} aria-labelledby="booking-when-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="booking-when-title" className={headingClass}>{t('bdhWhenWhere')}</h2>
              {visitBounds && !['cancelled'].includes(phase) && !visitOver && (
                <Button type="button" variant="outline" size="sm" onClick={addToCalendar}><CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />{t('bdhAddToCalendar')}</Button>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('bdDate')}</dt>
                <dd className="mt-0.5 font-medium">{formatDate(booking.bookingDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('bdTime')}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {bookingTimeSlots.slice(0, 2).map((slot, index) => <div key={`${slot}-${index}`}>{slot}</div>)}
                  {bookingTimeSlots.length > 2 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="mt-1 text-xs font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t('bdShowAllTimes', { defaultValue: 'Show all times' })}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="max-h-64 w-64 overflow-y-auto text-sm">
                        <p className="mb-2 font-semibold">{t('bdBookedTimes', { defaultValue: 'Booked times' })}</p>
                        <div className="space-y-1">{bookingTimeSlots.map((slot, index) => <div key={`${slot}-${index}`} className="whitespace-nowrap">{slot}</div>)}</div>
                      </PopoverContent>
                    </Popover>
                  )}
                  <span className="block text-xs font-normal text-muted-foreground">{t('bdHours', { count: calculateDuration() })}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('bdhPlace')}</dt>
                <dd className="mt-0.5 font-medium">{kitchenName}{booking.location?.name && booking.location.name !== kitchenName && <span className="block text-xs font-normal text-muted-foreground">{booking.location.name}</span>}</dd>
              </div>
              {booking.location?.address && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('bdhAddress')}</dt>
                  <dd className="mt-0.5">
                    <a href={mapsHref!} target="_blank" rel="noopener noreferrer" className="break-words font-medium underline underline-offset-4">{booking.location.address}</a>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* ── The other party ── */}
          <section className={sectionClass} aria-labelledby="booking-person-title" data-testid="person-card">
            <div className="flex items-start gap-3">
              <Avatar className="h-12 w-12 shrink-0"><AvatarFallback className="bg-muted text-sm font-semibold">{initials(isManagerView ? chefName : kitchenName)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{isManagerView ? t('bdhChefLabel') : t('bdhKitchenLabel')}</p>
                <h2 id="booking-person-title" className={`${headingClass} break-words`}>{isManagerView ? chefName : kitchenName}</h2>
                {!isManagerView && booking.location?.name && booking.location.name !== kitchenName && <p className="text-sm text-muted-foreground">{booking.location.name}</p>}
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {messageButton('w-full sm:w-auto')}
              {(() => {
                const phone = isManagerView ? booking.chef?.phone : booking.kitchenContact?.phone;
                return phone && contactVisible(booking.status) ? (
                  <div data-testid="contact-phone">
                    <a href={`tel:${phone}`} className="text-sm font-medium underline underline-offset-4">{formatContactPhone(phone)}</a>
                    <p className="mt-1 text-xs text-muted-foreground">{t('bdhSafetyHelper')}</p>
                  </div>
                ) : null;
              })()}
              {(() => {
                const email = isManagerView ? booking.chef?.username : booking.kitchenContact?.email;
                return email ? <a href={`mailto:${email}`} className="block break-all text-xs text-muted-foreground underline-offset-4 hover:underline">{email}</a> : null;
              })()}
            </div>
          </section>

          {/* ── Add-ons ── */}
          {(allStorageBookings.length > 0 || allEquipmentBookings.length > 0) && (
            <section className={`${sectionClass} space-y-4`} aria-labelledby="booking-addons-title">
              <h2 id="booking-addons-title" className={headingClass}>{t('bdhAddOns')}</h2>
              {allStorageBookings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-medium"><Package className="h-3.5 w-3.5 text-muted-foreground" />{t('bdStorageSection')}</h3>
                  {allStorageBookings.map((storage) => {
                    const voided = isItemVoided(storage);
                    const refunded = isItemRefunded(storage);
                    const cancelled = voided || refunded || storage.status === 'cancelled';
                    return (
                      <div key={storage.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 ${cancelled ? 'bg-muted/40 opacity-60' : ''}`}>
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${cancelled ? 'text-muted-foreground line-through' : ''}`}>{storage.storageListing?.name || `Storage #${storage.storageListingId}`}</p>
                          <p className="text-xs text-muted-foreground">
                            {storage.storageListing?.storageType}
                            {storage.startDate && ` · ${formatShortDate(storage.pricingModel === 'hourly' ? storage.startDate : storage.startDate.slice(0, 10))} – ${formatShortDate(storage.pricingModel === 'hourly' ? storage.endDate : storage.endDate.slice(0, 10))}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className={`font-mono text-sm tabular-nums ${cancelled ? 'text-muted-foreground line-through' : ''}`}>{formatCurrency(storage.totalPrice)}</span>
                          {itemChip(storage, true)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {allEquipmentBookings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-medium"><Wrench className="h-3.5 w-3.5 text-muted-foreground" />{t('bdEquipmentSection')}</h3>
                  {allEquipmentBookings.map((equipment) => {
                    const voided = isItemVoided(equipment);
                    const refunded = isItemRefunded(equipment);
                    const cancelled = voided || refunded || equipment.status === 'cancelled';
                    return (
                      <div key={equipment.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 ${cancelled ? 'bg-muted/40 opacity-60' : ''}`}>
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${cancelled ? 'text-muted-foreground line-through' : ''}`}>{equipment.equipmentListing?.equipmentType || `Equipment #${equipment.equipmentListingId}`}</p>
                          {equipment.equipmentListing?.brand && <p className="text-xs text-muted-foreground">{equipment.equipmentListing.brand}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {isManagerView && booking.paymentDecision?.state !== 'pending' && equipment.status === 'cancellation_requested' && booking.status === 'confirmed' && <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" disabled={itemCancellationPending} onClick={() => void reviewEquipmentCancellation(equipment.id, true)}>{t('bdAcceptCancellation', { defaultValue: 'Accept cancellation' })}</Button>
                            <Button variant="outline" size="sm" disabled={itemCancellationPending} onClick={() => void reviewEquipmentCancellation(equipment.id, false)}>{t('bdDeclineCancellation', { defaultValue: 'Decline cancellation' })}</Button>
                          </div>}
                          <span className={`font-mono text-sm tabular-nums ${cancelled ? 'text-muted-foreground line-through' : ''}`}>{formatCurrency(equipment.totalPrice)}</span>
                          {itemChip(equipment, false)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── Note ── */}
          {booking.specialNotes && (
            <section className={sectionClass} aria-labelledby="booking-note-title">
              <h2 id="booking-note-title" className={`${headingClass} mb-3`}>{isManagerView ? t('bdhNoteFrom', { name: chefName }) : t('bdhYourNote')}</h2>
              <blockquote className="whitespace-pre-wrap border-l-2 pl-4 text-sm leading-relaxed text-foreground/80">{booking.specialNotes}</blockquote>
            </section>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="min-w-0 space-y-6">
          <section className={sectionClass} aria-labelledby="booking-payment-title" data-testid="payment-card">
            {isManagerView && <div className="mb-4"><RefundRequestStatus request={booking.paymentTransaction?.metadata?.fullRefundRequest} /></div>}
            <h2 id="booking-payment-title" className={headingClass}>{t('bdPaymentSection')}</h2>
            {paymentHeadline && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{paymentHeadline.label}</p>
                <p className={`text-2xl font-semibold tabular-nums ${paymentHeadline.struck ? 'text-muted-foreground line-through' : ''}`} data-testid="payment-headline">{formatCurrency(paymentHeadline.cents)}</p>
              </div>
            )}
            {paymentMessage && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs">
                <span className="min-w-0 flex-1 text-muted-foreground">{paymentMessage.summary}</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('bdPaymentMoreInfo', { defaultValue: 'More about payment status' })}>
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="top" className="w-64 max-w-[calc(100vw-2rem)] text-xs leading-relaxed">{paymentMessage.detail}</PopoverContent>
                </Popover>
              </div>
            )}

            {booking.paymentDecision?.state === 'pending' ? <p className="mt-4 text-sm">{t('bdRecordedDecisionAmount', { amount: formatCurrency(booking.paymentDecision.amount || 0) })}</p> : (
            <details className="group mt-4" data-testid="payment-breakdown" open={!paymentHeadline || undefined}>
              <summary className="cursor-pointer list-none text-sm font-medium underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{t('bdhShowBreakdown')}</span><span className="hidden group-open:inline">{t('bdhHideBreakdown')}</span>
              </summary>
            <div className="mt-3 space-y-2.5">
              {booking.paymentStatus === 'failed' && booking.status === 'cancelled' ? (
                <div className="flex justify-between text-sm" data-testid="not-charged-line">
                  <span className="text-muted-foreground">{cap(t('bdStatusNotCharged'))}</span>
                  <span className="font-mono tabular-nums text-muted-foreground line-through">{formatCurrency(booking.paymentTransaction?.amount || totals.subtotal)}</span>
                </div>
              ) : (<>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{ct('sweepLabel34')}</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(totals.kitchen > 0 ? totals.kitchen : booking.totalPrice)}
                </span>
              </div>

              {allStorageTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("bdStorageLine")}</span>
                  <div className="text-right">
                    {rejectedStorageTotal > 0 && rejectedStorageTotal < allStorageTotal && (
                      <span className="mr-2 font-mono text-xs text-muted-foreground line-through">{formatCurrency(allStorageTotal)}</span>
                    )}
                    <span className={`font-mono tabular-nums ${rejectedStorageTotal > 0 && rejectedStorageTotal === allStorageTotal ? "text-muted-foreground line-through" : ""}`}>
                      {rejectedStorageTotal === allStorageTotal ? formatCurrency(allStorageTotal) : formatCurrency(totals.storage)}
                    </span>
                  </div>
                </div>
              )}

              {allEquipmentTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("bdEquipmentLine")}</span>
                  <div className="text-right">
                    {rejectedEquipmentTotal > 0 && rejectedEquipmentTotal < allEquipmentTotal && (
                      <span className="mr-2 font-mono text-xs text-muted-foreground line-through">{formatCurrency(allEquipmentTotal)}</span>
                    )}
                    <span className={`font-mono tabular-nums ${rejectedEquipmentTotal > 0 && rejectedEquipmentTotal === allEquipmentTotal ? "text-muted-foreground line-through" : ""}`}>
                      {rejectedEquipmentTotal === allEquipmentTotal ? formatCurrency(allEquipmentTotal) : formatCurrency(totals.equipment)}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {booking.paymentStatus === 'failed' && booking.status === 'cancelled'
                    ? t("bdOriginalQuote")
                    : isRefunded || isPartiallyRefunded
                      ? t("bdAmountCharged")
                      : t("bdSubtotal")}
                </span>
                <span className={`font-mono tabular-nums ${
                  (booking.paymentStatus === 'failed' && booking.status === 'cancelled') || isRefunded
                    ? 'text-muted-foreground line-through'
                    : ''
                }`}>
                  {formatCurrency(totals.subtotal)}
                </span>
              </div>

              {/* Taxes, fees and total continue the same list. Voided authorization: nothing was captured. */}
              {booking.paymentTransaction && pricingBreakdownInput && !(booking.paymentStatus === 'failed' && booking.status === 'cancelled') && (
                isManagerView ? (
                  <KitchenPayoutStatementBreakdown
                    {...pricingBreakdownInput}
                    currency={booking.currency || "CAD"}
                    title={payoutTitle}
                    showProcessorFee={pricingBreakdownInput.showPaymentProcessorFee}
                    chargeLabel={t("bdTotalCharged", { defaultValue: "Total charged" })}
                    processingFeeLabel={
                      pricingBreakdownInput.paymentProcessorFeeIsEstimate
                        ? t("bdEstProcessingFee", { defaultValue: "Est. processing fee" })
                        : t("bdProcessingFee")
                    }
                    platformFeeLabel={t("bdLocalCooksServiceFee", {
                      percent: Math.round((pricingBreakdownInput.platformFeeRate || 0) * 100),
                      defaultValue: "Service fee ({percent}%)",
                    })}
                    platformFeeChefPaidLabel={t("bdLocalCooksFeePaidByChef", { defaultValue: "Service fee" })}
                    platformFeeInfo={<ServiceFeeInfoPopover iconClassName="h-3 w-3" />}
                    refundLabel={t("bdRefund")}
                    hstLabel={t("bdHstPercent", { percent: pricingBreakdownInput.kitchenHstRatePercent ?? 0 })}
                    hstCollectedLabel={t("bdHstCollectedLine")}
                  />
                ) : (
                  <ChefBookingReceiptBreakdown
                    {...pricingBreakdownInput}
                    currency={booking.currency || "CAD"}
                    totalLabel={chefTotalLabel}
                    platformFeeLabel={t("bdLocalCooksServiceFee", {
                      percent: Math.round((pricingBreakdownInput.platformFeeRate || 0) * 100),
                      defaultValue: "Service fee ({percent}%)",
                    })}
                  />
                )
              )}

              </>)}

              {!isManagerView && refundAmount > 0 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1 text-warning">
                    {t("bdRefundedLine")}
                    <StripeProcessingFeeRefundInfo iconClassName="h-3 w-3" beforeConfirmation={booking.status === 'pending'} />
                  </span>
                  <span className="font-mono tabular-nums text-warning">−{formatCurrency(refundAmount)}</span>
                </div>
              )}
            </div>
            </details>
            )}

            {(canDownload || showRefundReview) && (
              <div className="mt-5 flex flex-col gap-2">
                {canDownload && (
                  <Button onClick={handleDownloadInvoice} disabled={isDownloading} variant="outline" className="w-full" size="sm">
                    {isDownloading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t("bdGenerating")}</>
                      : <><Download className="mr-1.5 h-3.5 w-3.5" />{isManagerView ? t("bdDownloadPayoutStatement") : t("bdDownloadReceipt")}</>}
                  </Button>
                )}
                {showRefundReview && (
                  <Button variant="link" size="sm" className="h-auto justify-start px-0 text-foreground underline" onClick={() => { setCancellationRefundScope(undefined); setCancellationRefundOpen(true); }}>{t('detailsCopy17')}</Button>
                )}
              </div>
            )}
          </section>

          {!isManagerView && (chefCanCancel || booking.status === 'cancellation_requested') && (
            <section className={sectionClass} aria-labelledby="booking-cancellation-title" data-testid="cancellation-card">
              <h2 id="booking-cancellation-title" className={`${headingClass} mb-2`}>{t('bdhCancellationTitle')}</h2>
              <div className="text-sm text-muted-foreground">
                {booking.status === 'pending' ? <BookingRefundPolicyNotice single />
                  : booking.status === 'cancellation_requested' ? <p>{t('cancelCopy07')}</p>
                  : paidCancellationAvailable && cancellationDeadlineText ? <p>{sentence(t('bdhCancelUntil', { time: cancellationDeadlineText }))}</p>
                  : <p>{t('bdhCancelPassed')}</p>}
              </div>
              {chefCanCancel && <Button variant="link" size="sm" className="mt-2 h-auto px-0 text-foreground underline" onClick={() => setCancelOpen(true)}>{t('bdhCancelOrChangeShort')}</Button>}
            </section>
          )}
          {!isManagerView && (
            <BookingCancellationChooser hideTrigger open={cancelOpen} onOpenChange={setCancelOpen} visitActive={visitActive} bookingId={booking.id} status={booking.status} paymentStatus={booking.paymentStatus}
              summary={{ kitchenName, reference: booking.referenceCode || undefined,
                schedule: `${formatDate(booking.bookingDate)}\n${bookingTimeSlots.join(', ')} · ${friendlyTimezoneName(booking.location?.timezone, i18n.language)}`,
                amount: booking.paymentTransaction ? formatCurrency(booking.paymentTransaction.amount) : undefined }}
              cancellationDeadline={cancellationDeadlineText}
              decisionPending={booking.paymentDecision?.state === 'pending'} declined={!!booking.cancellationRequestDeclinedAt}
              paidCancellationAvailable={paidCancellationAvailable}
              items={[...(booking.storageBookings || []).map(item => ({ id: item.id, kind: 'storage' as const,
                name: item.storageListing?.name || `Storage #${item.id}`, status: item.status, dates: `${formatShortDate(item.startDate)} – ${formatShortDate(item.endDate)}` })),
                ...(booking.equipmentBookings || []).map(item => ({ id: item.id, kind: 'equipment' as const,
                  name: item.equipmentListing?.equipmentType || `Equipment #${item.id}`, status: item.status }))]}
              onChanged={async () => { await reloadBookingDetails(); await queryClient.invalidateQueries(); }} />
          )}

          <BookingHistoryPanel timezone={booking.location?.timezone} id={booking.id} reference={booking.referenceCode} role={isManagerView ? 'manager' : 'chef'} cancelCause={cancelCause} version={booking.updatedAt || booking.createdAt} limit={3} />

          <Card id="booking-support" className="scroll-mt-24 rounded-2xl border-border shadow-none">
            <CardContent className="p-5 sm:p-6">
              <h2 className={`${headingClass} mb-2`}>{t('bdContactSupport', { defaultValue: 'Contact Local Cooks' })}</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('bdContactSupportHint', { defaultValue: 'Need help with your booking or payment?' })}</p>
              <div className="mt-4 space-y-3 text-sm">
                <a className="flex min-w-0 items-center gap-2 text-foreground underline-offset-4 hover:underline" href="mailto:support@localcooks.ca"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-all">support@localcooks.ca</span></a>
                <a className="flex items-center gap-2 text-foreground underline-offset-4 hover:underline" href="tel:+17096318480"><Phone className="h-4 w-4 shrink-0 text-muted-foreground" />+1 (709) 631-8480</a>
              </div>
              <CommitmentProblems kind="booking" id={booking.id} role={isManagerView ? 'manager' : 'chef'} canReport embedded />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Mobile: primary + Message stay in reach ── */}
      {hasBottomBar && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur sm:hidden" role="region" aria-label={t('bdhMobileActions')} data-testid="mobile-action-bar">
          <div className="mx-auto flex max-w-md gap-2">
            {messageButton('min-h-11 flex-1')}
            {primaryButton('mobile-primary-action', 'min-h-11 flex-1')}
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
